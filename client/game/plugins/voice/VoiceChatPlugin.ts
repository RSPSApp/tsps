import { GameStateChanged, PluginMessage } from "@runelite/api/events";
import { GameState } from "@runelite/api/GameState";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { getWebRtcRelayConfig, getPublicWebRtcRelayConfig, resolveIceServers } from "../../../config/clientEnv";
import { send, isSocketOpen } from "../../../network/serverConnection/connection/send";
import type { OsrsClient } from "../../OsrsClient";
import type { WidgetNode } from "../../../widgets/WidgetNode";
import type { WidgetActionEvent } from "../../widgets/widgetActionPayload";
import { VoiceChatConfig } from "./VoiceChatConfig";
import { SPEAKER_HEAD_ICONS } from "./speakerIcon";
import type { IndexedSprite } from "../../../rs/sprite/IndexedSprite";

// Cache chatbox: report button (162:31), label (162:33).
const REPORT_BUTTON = (162 << 16) | 31;
const REPORT_LABEL = (162 << 16) | 33;
type VoiceMode = "listen" | "on" | "off";

type VoiceActivity = {
    source: MediaStreamAudioSourceNode;
    analyser: AnalyserNode;
    samples: Uint8Array<ArrayBuffer>;
    speakingUntil: number;
};

type VoicePeer = {
    connection: RTCPeerConnection;
    connectionId: string;
    gain: GainNode;
    audio: HTMLAudioElement;
    activity?: VoiceActivity;
    candidates: RTCIceCandidateInit[];
    outgoingCandidates: RTCIceCandidateInit[];
    descriptionSent: boolean;
    messages: Promise<void>;
    startedAt: number;
};

export function voiceVolume(distance: number): number {
    if (distance <= 1) return 1;
    if (distance >= 15) return 0;
    return 1 - ((distance - 1) / 14) ** 2;
}

export class VoiceChatPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Voice Chat",
        description: "Replace Report with voice controls. Starts listening; select On to use your microphone.",
        tags: ["voice", "proximity", "audio"],
        enabledByDefault: true,
        configKey: "voicechatplugin",
    };
    static config = VoiceChatConfig;

    private readonly client = inject<OsrsClient>(CLIENT_TOKEN);
    private readonly configManager = inject(ConfigManager);
    private readonly config = this.configManager.getConfig(VoiceChatConfig);
    private mode: VoiceMode = "listen";
    private reportButton?: {
        button: WidgetNode;
        label: WidgetNode;
        actions: WidgetNode["actions"];
        text: WidgetNode["text"];
        lineHeight: WidgetNode["lineHeight"];
    };
    private stream?: MediaStream;
    private microphoneActivity?: VoiceActivity;
    private audioContext?: AudioContext;
    private iceServers: RTCIceServer[] = [];
    private generation = 0;
    private acquiring = false;
    private microphoneGeneration = 0;
    private preparing?: Promise<void>;
    private unavailable = false;
    private joined = false;
    private joinedAt = 0;
    private ready = false;
    private readonly availablePeers = new Map<number, boolean>();
    private readonly peers = new Map<number, VoicePeer>();
    private readonly retryAt = new Map<number, number>();

    getPlayerHeadIcons(serverId: number): readonly IndexedSprite[] | undefined {
        if (!this.isEnabled() || !this.ready || this.audioContext?.state !== "running") return;
        const activity = serverId === this.client.controlledPlayerServerId
            ? this.microphoneActivity : this.peers.get(serverId)?.activity;
        if (!activity) return;
        activity.analyser.getByteTimeDomainData(activity.samples);
        let power = 0;
        for (const sample of activity.samples) power += ((sample - 128) / 128) ** 2;
        const now = Date.now();
        // Hold through brief gaps between words instead of flickering on every syllable.
        if (power / activity.samples.length > 0.02 ** 2) activity.speakingUntil = now + 350;
        return now < activity.speakingUntil ? SPEAKER_HEAD_ICONS : undefined;
    }

    private createActivity(stream: MediaStream): VoiceActivity {
        const source = this.audioContext!.createMediaStreamSource(stream);
        const analyser = this.audioContext!.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        return { source, analyser, samples: new Uint8Array(analyser.fftSize), speakingUntil: 0 };
    }

    private readonly resumeAudio = (): void => {
        if (this.audioContext?.state === "suspended") {
            void this.audioContext.resume().catch(error => this.reportError(error));
        }
    };

    protected override async startUp(): Promise<void> {
        this.mode = "listen";
        this.unavailable = false;
    }

    protected override async shutDown(): Promise<void> {
        if (this.joined) this.signal({ type: "voice-state", enabled: false });
        this.releaseSession();
        this.mode = "listen";
        this.restoreReportButton();
    }

    onPostClientTick(): void {
        if (!this.isEnabled() || this.unavailable || (!this.ready && this.mode !== "off")) {
            this.restoreReportButton();
            return;
        }
        const manager = this.client.widgetManager;
        const button = manager?.getWidgetByUid(REPORT_BUTTON);
        const label = manager?.getWidgetByUid(REPORT_LABEL);
        if (!button || !label) return;
        if (this.reportButton?.button !== button || this.reportButton?.label !== label) {
            this.restoreReportButton();
            this.reportButton = { button, label, actions: button.actions, text: label.text, lineHeight: label.lineHeight };
        }
        const status = this.acquiring ? "Wait" : this.mode === "on" ? "On" : this.mode === "off" ? "Off" : "Listen";
        const colour = this.acquiring ? "ffff00" : this.mode === "on" ? "00ff00" : this.mode === "off" ? "ff0000" : "00ffff";
        const text = `Voice<br><col=${colour}>${status}</col>`;
        if (label.text === text && button.actions?.[1] === "Cycle voice mode") return;
        // Keep the cache's enabled report op (2), so the existing hit area and hover stone work.
        button.actions = ["", "Cycle voice mode"];
        label.text = text;
        label.lineHeight = 10;
        manager.invalidateWidget(label);
        manager.invalidateWidget(button);
    }

    private restoreReportButton(): void {
        const saved = this.reportButton;
        if (!saved) return;
        saved.button.actions = saved.actions;
        saved.label.text = saved.text;
        saved.label.lineHeight = saved.lineHeight;
        this.client.widgetManager?.invalidateWidget(saved.button);
        this.client.widgetManager?.invalidateWidget(saved.label);
        this.reportButton = undefined;
    }

    handleWidgetAction(event: WidgetActionEvent): boolean {
        if (!this.isEnabled() || this.unavailable || !this.reportButton || event.widget?.uid !== REPORT_BUTTON) return false;
        const next = this.mode === "listen" ? "on" : this.mode === "on" ? "off" : "listen";
        void this.setMode(next);
        return true;
    }

    private async setMode(mode: VoiceMode): Promise<void> {
        this.releaseMicrophone();
        this.mode = mode;
        if (mode === "off") {
            if (this.joined) this.signal({ type: "voice-state", enabled: false });
            this.releaseSession();
        } else if (mode === "on") {
            try {
                await this.acquireMicrophone();
            } catch (error) {
                this.fail(error);
            }
        } else {
            this.updateVoiceState();
        }
        this.onPostClientTick();
    }

    private prepareAudio(): Promise<void> {
        if (this.preparing) return this.preparing;
        if (this.audioContext) return Promise.resolve();
        const generation = this.generation;
        this.audioContext = new AudioContext();
        document.addEventListener("pointerdown", this.resumeAudio);
        document.addEventListener("keydown", this.resumeAudio);
        this.resumeAudio();
        const relay = getWebRtcRelayConfig() ?? getPublicWebRtcRelayConfig();
        const pending = resolveIceServers(relay.signalUrl, relay.iceServers).then(servers => {
            if (generation === this.generation) this.iceServers = servers;
        }).finally(() => {
            if (generation === this.generation) this.preparing = undefined;
        });
        this.preparing = pending;
        return pending;
    }

    private updateVoiceState(): void {
        for (const id of this.peers.keys()) this.closePeer(id);
        this.retryAt.clear();
        if (this.joined) this.signal({ type: "voice-state", enabled: true, broadcasting: !!this.stream });
    }

    private async acquireMicrophone(): Promise<void> {
        if (this.acquiring || this.stream || !this.isEnabled() || this.mode !== "on") return;
        if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
            throw new Error("Voice chat needs a browser with microphone support on HTTPS or localhost.");
        }
        const generation = this.microphoneGeneration;
        this.acquiring = true;
        try {
            const audioReady = this.prepareAudio();
            // Request immediately in the voice button's user gesture, before ICE discovery.
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
                video: false,
            });
            if (generation !== this.microphoneGeneration || !this.isEnabled() || this.mode !== "on") {
                stream.getTracks().forEach(track => track.stop());
                return;
            }
            this.stream = stream;
            for (const track of stream.getAudioTracks()) {
                track.onended = () => this.fail("Microphone disconnected. Select On again to reconnect.");
            }
            await audioReady;
            if (generation === this.microphoneGeneration) {
                this.microphoneActivity = this.createActivity(stream);
                this.updateVoiceState();
            }
        } catch (error) {
            if (generation !== this.microphoneGeneration) return;
            this.releaseMicrophone();
            throw error;
        } finally {
            if (generation === this.microphoneGeneration) this.acquiring = false;
        }
    }

    onGameStateChanged(event: GameStateChanged): void {
        const state = event.getGameState();
        if ([GameState.LOGIN_SCREEN, GameState.CONNECTION_LOST, GameState.HOPPING, GameState.STARTING].includes(state)) {
            if (this.joined) this.signal({ type: "voice-state", enabled: false });
            this.releaseSession();
            if (this.mode === "on") this.mode = "listen";
            this.unavailable = false;
            this.restoreReportButton();
        }
    }

    onClientTick(): void {
        if (!this.isEnabled() || this.mode === "off" || this.unavailable || !this.client.isLoggedIn() || !isSocketOpen()) return;
        if (!this.joined) {
            this.joined = true;
            this.joinedAt = Date.now();
            this.signal({ type: "voice-state", enabled: true, broadcasting: !!this.stream });
        }
        if (!this.ready && Date.now() - this.joinedAt > 10_000) {
            this.worldUnavailable("The server did not enable voice chat.");
            return;
        }
        if (!this.ready || this.preparing || !this.audioContext) return;
        const ownId = this.client.controlledPlayerServerId;
        for (const id of this.availablePeers.keys()) {
            // One offerer per pair avoids simultaneous-offer negotiation races.
            if (ownId < id && !this.peers.has(id) && Date.now() >= (this.retryAt.get(id) ?? 0)) {
                const peer = this.createPeer(id, crypto.randomUUID());
                void this.offer(id, peer).catch(error => this.peerFailed(id, peer, error));
            }
        }
        for (const [id, peer] of this.peers) {
            if (peer.connection.connectionState !== "connected" && Date.now() - peer.startedAt > 15_000) {
                this.closePeer(id);
                continue;
            }
            const target = this.peerVolume(id);
            peer.gain.gain.value += (target - peer.gain.gain.value) * 0.2;
        }
    }

    onPluginMessage(event: PluginMessage): void {
        if (event.channel !== "voice" || !this.isEnabled() || !this.joined) return;
        const data = event.data;
        if (data.type === "unavailable") {
            this.worldUnavailable("Voice chat is unavailable on this world.");
            return;
        }
        if (data.type === "peers" && Array.isArray(data.peers)) {
            this.ready = true;
            if (!this.audioContext) {
                if (typeof AudioContext === "undefined" || typeof RTCPeerConnection === "undefined") {
                    this.worldUnavailable("Voice chat needs a browser with WebRTC audio support.");
                    return;
                }
                void this.prepareAudio().catch(error => this.worldUnavailable(error));
            }
            const previous = new Map(this.availablePeers);
            this.availablePeers.clear();
            for (const peer of data.peers) {
                if (peer && Number.isInteger(peer.id) && peer.id >= 0 && peer.id < 2048
                    && peer.id !== this.client.controlledPlayerServerId) {
                    this.availablePeers.set(peer.id, peer.broadcasting === true);
                    if (previous.get(peer.id) !== (peer.broadcasting === true)) this.closePeer(peer.id);
                }
            }
            for (const id of this.peers.keys()) if (!this.availablePeers.has(id)) this.closePeer(id);
            for (const id of this.retryAt.keys()) if (!this.availablePeers.has(id)) this.retryAt.delete(id);
            return;
        }
        if (this.preparing) {
            const generation = this.generation;
            void this.preparing.then(() => {
                if (generation === this.generation) this.onPluginMessage(event);
            }).catch(error => this.worldUnavailable(error));
            return;
        }
        if (!this.audioContext) return;
        const id = data.from;
        if (typeof id !== "number" || !this.availablePeers.has(id) || typeof data.connectionId !== "string") return;
        let peer = this.peers.get(id);
        if (data.type === "offer" && id < this.client.controlledPlayerServerId) {
            if (peer?.connectionId !== data.connectionId) {
                this.closePeer(id);
                peer = this.createPeer(id, data.connectionId);
            }
        }
        if (!peer || peer.connectionId !== data.connectionId) return;
        const current = peer;
        if ((data.type === "offer" && id >= this.client.controlledPlayerServerId)
            || (data.type === "answer" && id <= this.client.controlledPlayerServerId)) return;
        current.messages = current.messages.then(async () => {
            if (this.peers.get(id) !== current) return;
            if (data.type === "offer" || data.type === "answer") {
                const description = data.description as RTCSessionDescriptionInit;
                if (!description || description.type !== data.type || typeof description.sdp !== "string") return;
                await current.connection.setRemoteDescription(description);
                for (const candidate of current.candidates.splice(0)) await current.connection.addIceCandidate(candidate);
                if (data.type === "offer") {
                    await current.connection.setLocalDescription(await current.connection.createAnswer());
                    this.sendDescription(id, current, "answer");
                }
            } else if (data.type === "ice-candidate" && data.candidate) {
                const candidate = data.candidate as RTCIceCandidateInit;
                if (current.connection.remoteDescription) await current.connection.addIceCandidate(candidate);
                else if (current.candidates.length < 64) current.candidates.push(candidate);
            }
        }).catch(error => this.peerFailed(id, current, error));
    }

    private createPeer(id: number, connectionId: string): VoicePeer {
        const connection = new RTCPeerConnection({ iceServers: this.iceServers });
        const gain = this.audioContext!.createGain();
        gain.gain.value = 0;
        gain.connect(this.audioContext!.destination);
        const audio = document.createElement("audio");
        audio.muted = true;
        audio.autoplay = true;
        audio.hidden = true;
        audio.setAttribute("playsinline", "");
        document.body.appendChild(audio);
        const peer: VoicePeer = { connection, connectionId, gain, audio, candidates: [], outgoingCandidates: [],
            descriptionSent: false, messages: Promise.resolve(), startedAt: Date.now() };
        this.peers.set(id, peer);
        if (this.stream) {
            for (const track of this.stream.getAudioTracks()) connection.addTrack(track, this.stream);
        } else {
            connection.addTransceiver("audio", { direction: "recvonly" });
        }
        connection.onicecandidate = event => {
            if (!event.candidate || this.peers.get(id) !== peer) return;
            const candidate = event.candidate.toJSON();
            if (peer.descriptionSent) this.signal({ type: "ice-candidate", target: id, connectionId, candidate });
            else peer.outgoingCandidates.push(candidate);
        };
        connection.ontrack = event => {
            if (this.peers.get(id) !== peer || event.track.kind !== "audio") return;
            peer.activity?.source.disconnect();
            peer.activity?.analyser.disconnect();
            const stream = new MediaStream([event.track]);
            // Chromium needs a playing media element to feed remote RTC audio into Web Audio.
            audio.srcObject = stream;
            void audio.play().catch(error => this.reportError(error));
            peer.activity = this.createActivity(stream);
            peer.activity.source.connect(gain);
        };
        connection.onconnectionstatechange = () => {
            if (this.peers.get(id) === peer && ["failed", "closed"].includes(connection.connectionState)) this.closePeer(id);
        };
        return peer;
    }

    private async offer(id: number, peer: VoicePeer): Promise<void> {
        await peer.connection.setLocalDescription(await peer.connection.createOffer());
        this.sendDescription(id, peer, "offer");
    }

    private sendDescription(id: number, peer: VoicePeer, type: "offer" | "answer"): void {
        if (this.peers.get(id) !== peer) return;
        this.signal({ type, target: id, connectionId: peer.connectionId, description: peer.connection.localDescription?.toJSON() });
        peer.descriptionSent = true;
        for (const candidate of peer.outgoingCandidates.splice(0)) {
            this.signal({ type: "ice-candidate", target: id, connectionId: peer.connectionId, candidate });
        }
    }

    private peerVolume(id: number): number {
        const ecs = this.client.playerEcs;
        const own = ecs.getIndexForServerId(this.client.controlledPlayerServerId);
        const other = ecs.getIndexForServerId(id);
        if (own === undefined || other === undefined || ecs.getLevel(own) !== ecs.getLevel(other)
            || ecs.getWorldViewId(own) !== ecs.getWorldViewId(other)) return 0;
        const distance = Math.max(Math.abs(ecs.getX(own) - ecs.getX(other)), Math.abs(ecs.getY(own) - ecs.getY(other))) / 128;
        const configured = this.config.volume();
        const volume = Number.isFinite(configured) ? Math.max(0, Math.min(100, configured)) / 100 : 1;
        return voiceVolume(distance) * volume;
    }

    private closePeer(id: number): void {
        const peer = this.peers.get(id);
        if (!peer) return;
        this.peers.delete(id);
        peer.connection.ontrack = null;
        peer.connection.onicecandidate = null;
        peer.connection.onconnectionstatechange = null;
        peer.connection.close();
        peer.audio.pause();
        peer.audio.srcObject = null;
        peer.audio.remove();
        peer.activity?.source.disconnect();
        peer.activity?.analyser.disconnect();
        peer.gain.disconnect();
        this.retryAt.set(id, Date.now() + 2000);
    }

    private releaseSession(): void {
        this.generation++;
        this.acquiring = false;
        this.joined = false;
        this.ready = false;
        this.availablePeers.clear();
        for (const id of this.peers.keys()) this.closePeer(id);
        this.retryAt.clear();
        this.releaseMicrophone();
        this.preparing = undefined;
        if (this.audioContext) void this.audioContext.close().catch(error => console.warn("[voice-chat] audio cleanup failed", error));
        this.audioContext = undefined;
        document.removeEventListener("pointerdown", this.resumeAudio);
        document.removeEventListener("keydown", this.resumeAudio);
    }

    private releaseMicrophone(): void {
        this.microphoneGeneration++;
        this.acquiring = false;
        this.microphoneActivity?.source.disconnect();
        this.microphoneActivity?.analyser.disconnect();
        this.microphoneActivity = undefined;
        for (const track of this.stream?.getTracks() ?? []) {
            track.onended = null;
            track.stop();
        }
        this.stream = undefined;
    }

    private worldUnavailable(error: unknown): void {
        this.unavailable = true;
        if (this.joined) this.signal({ type: "voice-state", enabled: false });
        this.joined = false;
        if (this.mode === "on") this.reportError(error);
        this.mode = "listen";
        this.releaseSession();
        this.restoreReportButton();
    }

    private signal(data: Record<string, unknown>): void {
        send({ type: "plugin_message", payload: { channel: "voice", data } });
    }

    private peerFailed(id: number, peer: VoicePeer, error: unknown): void {
        if (this.peers.get(id) !== peer) return;
        console.warn("[voice-chat] peer negotiation failed", id, error);
        this.closePeer(id);
    }

    private reportError(error: unknown): void {
        this.client.addGameMessage(`Voice chat: ${error instanceof Error ? error.message : String(error)}`);
    }

    private fail(error: unknown): void {
        this.reportError(error);
        this.releaseMicrophone();
        this.mode = "listen";
        this.updateVoiceState();
        this.onPostClientTick();
    }
}
