import { strict as assert } from "node:assert";
import { ClientTick, GameStateChanged, PluginMessage, PostClientTick } from "@runelite/api/events";
import { GameState } from "@runelite/api/GameState";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { EventBus } from "@runelite/client/eventbus/EventBus";
import { PluginManager } from "@runelite/client/plugins/PluginManager";
import { CLIENT_TOKEN } from "@runelite/client/plugins/PluginInjector";
import { ClientPluginManager } from "../game/plugins/ClientPluginManager";
import { deriveMenuEntriesForWidget } from "../widgets/menu/utils";
import { VoiceChatPlugin, voiceVolume } from "../game/plugins/voice/VoiceChatPlugin";
import { encodeClientMessage } from "../network/packet/ClientBinaryEncoder";
import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import { parsePluginMessage } from "../common/network/PluginMessage";
import { state } from "../network/serverConnection/state";

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

async function main(): Promise<void> {
    const envelope = { channel: "voice", data: { text: "héllo 🎤" } };
    const wire = encodeClientMessage({ type: "plugin_message", payload: envelope });
    assert.deepEqual(parsePluginMessage(wire.subarray(3)), envelope);
    wire[0] = 6;
    assert.deepEqual(decodeServerPacket(wire), { type: "plugin_message", payload: envelope });
    assert.throws(() => encodeClientMessage({ type: "plugin_message", payload: { channel: "voice", data: { text: "x".repeat(16384) } } }));
    assert.equal(voiceVolume(1), 1);
    assert.equal(voiceVolume(15), 0);
    assert.ok(voiceVolume(5) > voiceVolume(10));

    let requests = 0;
    let resolveMicrophone: (stream: any) => void = () => {};
    let rejectMicrophone: (error: Error) => void = () => {};
    const domListeners = new Set<unknown>();
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: {
        getUserMedia: () => {
            requests++;
            return new Promise((resolve, reject) => { resolveMicrophone = resolve; rejectMicrophone = reject; });
        },
    } } });
    Object.assign(globalThis, {
        document: { addEventListener: (_: string, listener: unknown) => domListeners.add(listener),
            removeEventListener: (_: string, listener: unknown) => domListeners.delete(listener),
            body: { appendChild() {} },
            createElement: () => ({ setAttribute() {}, pause() {}, remove() {}, play: async () => {} }) },
        WebSocket: { OPEN: 1 },
        MediaStream: class { constructor(readonly tracks: unknown[]) {} },
        AudioContext: class {
            state = "running";
            destination = {};
            close(): Promise<void> { this.state = "closed"; return Promise.resolve(); }
            resume(): Promise<void> { return Promise.resolve(); }
            createMediaStreamSource(): any { return { connect() {}, disconnect() {} }; }
            createAnalyser(): any { return { fftSize: 512, sample: 128, disconnect() {},
                getByteTimeDomainData(samples: Uint8Array) { samples.fill(this.sample); } }; }
            createGain(): any { return { gain: { value: 0 }, connect() {}, disconnect() {} }; }
        },
        RTCPeerConnection: class {
            connectionState = "new";
            closed = false;
            localDescription: any;
            remoteDescription: any;
            tracks = 0;
            direction?: string;
            addTrack(): void { this.tracks++; }
            addTransceiver(_: string, init: any): void { this.direction = init.direction; }
            async setRemoteDescription(description: any): Promise<void> { this.remoteDescription = description; }
            async addIceCandidate(): Promise<void> {}
            async createAnswer(): Promise<any> { return { type: "answer", sdp: "test" }; }
            close(): void { this.closed = true; }
            async createOffer(): Promise<any> { return { type: "offer", sdp: "test" }; }
            async setLocalDescription(description: any): Promise<void> {
                this.localDescription = { toJSON: () => description };
            }
        },
        fetch: async () => ({ ok: false }),
    });
    const microphone = () => {
        const track = { enabled: true, stops: 0, onended: null, stop() { this.stops++; } };
        return { track, getTracks: () => [track], getAudioTracks: () => [track] };
    };
    const packets: any[] = [];
    state.socket = { readyState: 1, send: (bytes: Uint8Array) => packets.push(parsePluginMessage(bytes.subarray(3))) } as any;
    const messages: string[] = [];
    const bus = new EventBus();
    const config = new ConfigManager(bus);
    const manager = new PluginManager(bus, config);
    const originalActions = ["", "Report abuse", "", "Report game bug"];
    const button: any = { uid: (162 << 16) | 31, type: 0, flags: 20, isIf3: true, actions: originalActions };
    const label: any = { uid: (162 << 16) | 33, text: "Report", lineHeight: 0 };
    const client = { controlledPlayerServerId: 1, isLoggedIn: () => true,
        widgetManager: { getWidgetByUid: (uid: number) => uid === button.uid ? button : uid === label.uid ? label : undefined,
            invalidateWidget() {} },
        playerEcs: { getIndexForServerId: (id: number) => id, getX: (id: number) => id * 128,
            getY: () => 0, getLevel: () => 0, getWorldViewId: () => -1 },
        addGameMessage: (message: string) => messages.push(message) };
    manager.getInjector().provide(CLIENT_TOKEN, client);
    manager.loadCorePlugins([VoiceChatPlugin]);
    const plugin = manager.getPlugin(VoiceChatPlugin)!;
    assert.equal(manager.isEnabled(VoiceChatPlugin), true, "voice chat is on by default");
    await manager.setPluginEnabled(VoiceChatPlugin, false);
    const enginePlugins = new ClientPluginManager();
    enginePlugins.add(plugin);
    const click = () => enginePlugins.handleWidgetAction({ widget: button, option: "Cycle voice mode", opIndex: 2, source: "primary" });
    const peerSnapshot = () => bus.post(new PluginMessage("voice", { type: "peers", peers: [{ id: 2, name: "Other", broadcasting: true }] }));
    const tick = () => { bus.post(new ClientTick()); bus.post(new PostClientTick()); };

    tick();
    assert.equal(requests, 0);
    assert.equal(packets.length, 0, "disabled plugin neither listens nor joins voice");
    assert.equal(label.text, "Report");
    assert.equal(click(), false, "disabled plugin leaves report actions alone");
    await manager.setPluginEnabled(VoiceChatPlugin, true);
    assert.equal(requests, 0, "enabling the feature does not request the microphone");
    tick();
    assert.deepEqual(packets.at(-1), { channel: "voice", data: { type: "voice-state", enabled: true, broadcasting: false } });
    peerSnapshot();
    await flush();
    tick();
    await flush();
    assert.equal(label.text, "Voice<br><col=00ffff>Listen</col>");
    assert.equal(enginePlugins.handleWidgetAction({ widget: { uid: 123 } }), false, "other widgets still route normally");
    const menu = deriveMenuEntriesForWidget(button, false, widget => widget.flags ?? 0);
    assert.equal(menu.filter(entry => entry.option === "Cycle voice mode").length, 1, "the cache report op stays clickable");
    assert.ok(!menu.some(entry => entry.option.includes("Report")));
    const listener = (plugin as any).peers.get(2);
    assert.equal(listener.connection.direction, "recvonly");
    assert.equal(listener.connection.tracks, 0);
    listener.connection.ontrack({ track: { kind: "audio" } });
    assert.ok(listener.activity.source, "Listen plays incoming audio without a microphone");
    assert.deepEqual(enginePlugins.playerHeadIcons(2), [], "silence has no speaking icon");
    assert.deepEqual(enginePlugins.playerHeadIcons(1), [], "Listen has no local microphone icon");
    const realNow = Date.now;
    let now = realNow();
    Date.now = () => now;
    try {
        listener.activity.analyser.sample = 129;
        assert.deepEqual(enginePlugins.playerHeadIcons(2), [], "low background noise stays below the threshold");
        listener.activity.analyser.sample = 145;
        const icons = enginePlugins.playerHeadIcons(2);
        assert.equal(icons.length, 1, "received audio adds a speaker headicon");
        assert.equal(icons[0].subWidth, 24);
        assert.equal(icons[0].pixels.length, 24 * 24);
        listener.activity.analyser.sample = 128;
        now += 250;
        assert.equal(enginePlugins.playerHeadIcons(2)[0], icons[0], "short pauses keep the same sprite");
        now += 101;
        assert.deepEqual(enginePlugins.playerHeadIcons(2), [], "silence clears the speaking icon");
        listener.activity.analyser.sample = 145;
        (plugin as any).audioContext.state = "suspended";
        assert.deepEqual(enginePlugins.playerHeadIcons(2), [], "suspended audio cannot mark a player speaking");
        (plugin as any).audioContext.state = "running";
    } finally {
        Date.now = realNow;
    }

    assert.equal(click(), true);
    assert.equal(requests, 1, "Listen -> On requests permission synchronously");
    tick();
    assert.ok(label.text.includes("Wait"));
    const stream = microphone();
    resolveMicrophone(stream);
    await flush();
    assert.equal(label.text, "Voice<br><col=00ff00>On</col>");
    assert.equal(packets.at(-1).data.broadcasting, true);
    tick();
    await flush();
    const peer = (plugin as any).peers.get(2);
    assert.equal(peer.connection.tracks, 1);
    (plugin as any).microphoneActivity.analyser.sample = 145;
    assert.equal(enginePlugins.playerHeadIcons(1).length, 1, "local microphone audio adds the same speaker icon");
    config.setConfiguration("voicechat", "volume", "50");
    assert.equal((plugin as any).peerVolume(2), 0.5);
    assert.equal(click(), true);
    assert.equal(label.text, "Voice<br><col=ff0000>Off</col>");
    assert.equal(stream.track.stops, 1, "On -> Off releases the microphone");
    assert.equal(peer.connection.closed, true, "Off closes listening connections too");
    assert.equal((plugin as any).audioContext, undefined);
    assert.deepEqual(enginePlugins.playerHeadIcons(1), [], "Off removes the local speaking icon");
    assert.deepEqual(enginePlugins.playerHeadIcons(2), [], "Off removes remote speaking icons");
    assert.equal((plugin as any).microphoneActivity, undefined);
    assert.deepEqual(packets.at(-1).data, { type: "voice-state", enabled: false });
    const packetCount = packets.length;
    tick();
    peerSnapshot();
    assert.equal(packets.length, packetCount, "Off stays disconnected");
    assert.equal(domListeners.size, 0);

    assert.equal(click(), true, "Off retains the voice control");
    tick();
    assert.equal(packets.at(-1).data.broadcasting, false);
    peerSnapshot();
    await flush();
    tick();
    await flush();
    assert.equal(label.text, "Voice<br><col=00ffff>Listen</col>");
    assert.equal(requests, 1, "Off -> Listen does not request a microphone");

    // A listener with a higher player id answers the speaker's offer.
    client.controlledPlayerServerId = 3;
    bus.post(new PluginMessage("voice", { type: "offer", from: 2, connectionId: "speaker-2",
        description: { type: "offer", sdp: "test" } }));
    await flush();
    assert.equal(packets.at(-1).data.type, "answer");
    assert.equal((plugin as any).peers.get(2).connection.direction, "recvonly");
    client.controlledPlayerServerId = 1;

    // Cancelling permission must release a late stream without rejoining or sending audio.
    click();
    click();
    const cancelledStream = microphone();
    resolveMicrophone(cancelledStream);
    await flush();
    assert.equal(cancelledStream.track.stops, 1);
    assert.equal((plugin as any).mode, "off");
    assert.equal((plugin as any).audioContext, undefined);
    click();
    tick();
    peerSnapshot();
    await flush();
    tick();
    await flush();

    click();
    rejectMicrophone(new Error("Microphone permission denied"));
    await flush();
    assert.ok(messages.at(-1)?.includes("permission denied"));
    assert.equal((plugin as any).mode, "listen", "denied microphone permission returns to Listen");
    assert.equal(manager.isEnabled(VoiceChatPlugin), true);
    assert.ok((plugin as any).audioContext);
    tick();
    await flush();
    assert.equal((plugin as any).peers.get(2).connection.direction, "recvonly");

    click();
    const reconnectStream = microphone();
    resolveMicrophone(reconnectStream);
    await flush();
    bus.post(new GameStateChanged(GameState.CONNECTION_LOST));
    assert.equal(reconnectStream.track.stops, 1);
    assert.equal((plugin as any).audioContext, undefined);
    assert.equal(label.text, "Report");
    const requestsBeforeReconnect = requests;
    bus.post(new GameStateChanged(GameState.LOGGED_IN));
    tick();
    peerSnapshot();
    await flush();
    tick();
    assert.equal(requests, requestsBeforeReconnect, "reconnecting returns to Listen without microphone permission");
    assert.ok(label.text.includes("Listen"));

    click();
    await manager.setPluginEnabled(VoiceChatPlugin, false);
    const disabledStream = microphone();
    resolveMicrophone(disabledStream);
    await flush();
    assert.equal(disabledStream.track.stops, 1, "disabling during permission releases late streams");
    assert.equal(label.text, "Report");
    assert.equal(label.lineHeight, 0);
    assert.equal(button.actions, originalActions, "disabling restores report options");
    assert.equal((plugin as any).audioContext, undefined);
    assert.equal((plugin as any).peers.size, 0);
    const disabledPackets = packets.length;
    tick();
    peerSnapshot();
    assert.equal(packets.length, disabledPackets, "disabling leaves all voice audio off");
    assert.equal(click(), false);

    await manager.setPluginEnabled(VoiceChatPlugin, true);
    assert.equal(requests, requestsBeforeReconnect + 1, "re-enabling never starts the microphone");
    tick();
    const messageCount = messages.length;
    bus.post(new PluginMessage("voice", { type: "unavailable" }));
    tick();
    assert.equal(messages.length, messageCount, "worlds without voice do not warn listeners");
    assert.equal(label.text, "Report");
    assert.equal((plugin as any).audioContext, undefined);
    assert.equal(domListeners.size, 0);
    await manager.setPluginEnabled(VoiceChatPlugin, false);
    state.socket = undefined;
    console.log("voice chat plugin tests passed");
}

void main();
