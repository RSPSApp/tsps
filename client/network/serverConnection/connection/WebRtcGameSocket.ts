import type { GameSocket, WebRtcConnectionConfig } from "./GameSocket";
import { resolveIceServers, shouldPreferWebRtcRelay } from "../../../config/clientEnv";

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;
const CONNECT_TIMEOUT_MS = 30_000;

function signallingEndpoint(raw: string): string {
    const url = new URL(raw);
    if (url.pathname === "/") url.pathname = "/signal";
    return url.toString();
}

async function selectedCandidate(pc: RTCPeerConnection): Promise<{
    localType?: string;
    localAddress?: string;
    remoteType?: string;
    remoteAddress?: string;
}> {
    const stats = await pc.getStats();
    let pair: any;
    stats.forEach((entry) => {
        if (entry.type === "transport" && entry.selectedCandidatePairId) {
            pair = stats.get(entry.selectedCandidatePairId);
        }
    });
    if (!pair) {
        stats.forEach((entry) => {
            if (entry.type === "candidate-pair" && entry.state === "succeeded" && entry.nominated) {
                pair = entry;
            }
        });
    }
    const local = pair ? stats.get(pair.localCandidateId) : undefined;
    const remote = pair ? stats.get(pair.remoteCandidateId) : undefined;
    return {
        localType: local?.candidateType,
        localAddress: local?.address ?? local?.ip,
        remoteType: remote?.candidateType,
        remoteAddress: remote?.address ?? remote?.ip,
    };
}

export class WebRtcGameSocket extends EventTarget implements GameSocket {
    public binaryType: BinaryType = "arraybuffer";
    public readonly url: string;
    private state = CONNECTING;
    private peer!: RTCPeerConnection;
    private channel!: RTCDataChannel;
    private contentChannel!: RTCDataChannel;
    private nextContentId = 0;
    private readonly contentRequests = new Map<number, {
        body: string;
        resolve: (value: unknown) => void;
        reject: (error: Error) => void;
        timeout: ReturnType<typeof setTimeout>;
    }>();
    private signal?: WebSocket;
    private readonly sessionId = typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : Array.from(crypto.getRandomValues(new Uint32Array(4)), (part) => part.toString(16)).join("-");
    private readonly pendingLocalCandidates: RTCIceCandidateInit[] = [];
    private readonly pendingRemoteCandidates: RTCIceCandidateInit[] = [];
    private remoteDescriptionSet = false;
    private sessionReady = false;
    private readonly timeout: ReturnType<typeof setTimeout>;

    constructor(private readonly config: WebRtcConnectionConfig) {
        super();
        this.url = signallingEndpoint(config.signalUrl);
        this.timeout = setTimeout(
            () => this.state === CONNECTING && this.fail(`WebRTC connection to world ${config.worldId} timed out`, true),
            CONNECT_TIMEOUT_MS,
        );
        void this.start();
    }

    /**
     * Resolve ICE servers (including short-lived TURN credentials from the relay)
     * before creating the peer, so symmetric-NAT clients can fall back to relaying.
     */
    private async start(): Promise<void> {
        if (this.state >= CLOSING) return;
        let iceServers = this.config.iceServers;
        try {
            iceServers = await resolveIceServers(this.config.signalUrl, this.config.iceServers);
        } catch {}
        if (this.state >= CLOSING) return;
        // After a direct connection fails, force the TURN relay so symmetric-NAT
        // clients are not stuck on an unusable direct candidate pair.
        const urlsOf = (server: RTCIceServer) => (Array.isArray(server.urls) ? server.urls : [server.urls]);
        const hasTurn = iceServers.some((server) =>
            urlsOf(server).some((url) => typeof url === "string" && url.startsWith("turn")),
        );
        const relayOnly = hasTurn && shouldPreferWebRtcRelay();
        this.peer = new RTCPeerConnection({
            iceServers,
            ...(relayOnly ? { iceTransportPolicy: "relay" as RTCIceTransportPolicy } : {}),
        });
        this.channel = this.peer.createDataChannel("game", { ordered: true });
        this.channel.binaryType = "arraybuffer";
        // Content requests use their own channel, never the binary game protocol.
        this.contentChannel = this.peer.createDataChannel("content", { ordered: true });
        this.contentChannel.addEventListener("message", (event) => this.receiveContent(event.data));
        this.signal = new WebSocket(this.url);
        this.bindPeer();
        this.bindSignal();
    }

    public get readyState(): number {
        return this.state;
    }

    public get bufferedAmount(): number {
        return this.channel.bufferedAmount;
    }

    public send(data: ArrayBuffer | ArrayBufferView<ArrayBuffer>): void {
        if (this.state !== OPEN) throw new DOMException("WebRTC game socket is not open", "InvalidStateError");
        if (data instanceof ArrayBuffer) this.channel.send(data);
        else this.channel.send(data);
    }

    public close(code = 1000, reason = ""): void {
        if (this.state >= CLOSING) return;
        this.state = CLOSING;
        clearTimeout(this.timeout);
        this.sendSignal({ type: "session-close", sessionId: this.sessionId, message: reason });
        this.finishClose(code, reason, code === 1000);
        try { this.signal?.close(1000, "game channel closed"); } catch {}
        try { this.channel?.close(); } catch {}
        try { this.peer?.close(); } catch {}
    }

    public async fetchContent(path: string): Promise<unknown> {
        if (path.length > 2048 || !/^\/api\/[a-z0-9-]+(?:\/[a-z0-9-]+)*(?:\?[^#]*)?$/i.test(path)) {
            throw new Error("Invalid content path");
        }
        if (!this.contentChannel) throw new Error("Content channel unavailable");
        if (this.contentChannel.readyState === "connecting") {
            await new Promise<void>((resolve, reject) => {
                const done = () => {
                    clearTimeout(timer);
                    this.contentChannel.removeEventListener("open", done);
                    this.contentChannel.removeEventListener("close", done);
                    this.contentChannel.readyState === "open" ? resolve() : reject(new Error("Content channel unavailable"));
                };
                const timer = setTimeout(done, 10_000);
                this.contentChannel.addEventListener("open", done);
                this.contentChannel.addEventListener("close", done);
            });
        }
        if (this.contentChannel.readyState !== "open") throw new Error("Content channel unavailable");
        if (this.contentRequests.size >= 16) throw new Error("Too many content requests");
        const id = ++this.nextContentId;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.contentRequests.delete(id);
                reject(new Error("Content request timed out"));
            }, 10_000);
            this.contentRequests.set(id, { body: "", resolve, reject, timeout });
            try { this.contentChannel.send(JSON.stringify({ id, path })); }
            catch (error) {
                clearTimeout(timeout);
                this.contentRequests.delete(id);
                reject(error);
            }
        });
    }

    private receiveContent(raw: unknown): void {
        if (typeof raw !== "string" || raw.length > 32_768) return;
        let message;
        try { message = JSON.parse(raw); } catch { return; }
        const request = this.contentRequests.get(message?.id);
        if (!request) return;
        try {
            if (message.error) throw new Error(String(message.error));
            if (typeof message.chunk !== "string") throw new Error("Invalid content response");
            request.body += message.chunk;
            if (request.body.length > 2_000_000) throw new Error("Content response too large");
            if (!message.done) return;
            request.resolve(JSON.parse(request.body));
        } catch (error) {
            request.reject(error as Error);
        }
        clearTimeout(request.timeout);
        this.contentRequests.delete(message.id);
    }

    private bindPeer(): void {
        this.peer.onicecandidate = (event) => {
            if (!event.candidate) return;
            const candidate = event.candidate.toJSON();
            if (this.sessionReady) {
                this.sendSignal({ type: "ice-candidate", sessionId: this.sessionId, candidate });
            } else {
                this.pendingLocalCandidates.push(candidate);
            }
        };
        this.peer.onconnectionstatechange = () => {
            if (this.peer.connectionState === "failed") this.fail("WebRTC ICE negotiation failed", true);
        };
        this.channel.addEventListener("message", (event) => {
            const data = event.data;
            if (typeof data === "string") {
                this.fail("WebRTC game channel received a non-binary message");
                return;
            }
            this.dispatchEvent(new MessageEvent("message", { data }));
        });
        this.channel.addEventListener("open", () => void this.open());
        this.channel.addEventListener("close", () => this.finishClose(1006, "DataChannel closed", false));
        this.channel.addEventListener("error", () => this.fail("WebRTC DataChannel failed", true));
    }

    private bindSignal(): void {
        this.signal.addEventListener("open", () => {
            this.sendSignal({
                type: "connect",
                worldId: this.config.worldId,
                sessionId: this.sessionId,
            });
        });
        this.signal.addEventListener("message", (event) => {
            void this.handleSignal(event.data).catch((error) => {
                this.fail(`WebRTC negotiation failed: ${(error as Error).message}`);
            });
        });
        this.signal.addEventListener("error", () => {
            if (this.state !== OPEN) this.fail("Could not connect to the WebRTC signalling relay");
        });
        this.signal.addEventListener("close", () => {
            if (this.state === CONNECTING && !this.remoteDescriptionSet) {
                this.fail("WebRTC signalling closed before negotiation completed");
            }
        });
    }

    private async handleSignal(raw: unknown): Promise<void> {
        if (typeof raw !== "string") return;
        let message: any;
        try {
            message = JSON.parse(raw);
        } catch {
            this.fail("WebRTC relay returned invalid signalling data");
            return;
        }
        if (message.type === "session-ready" && message.sessionId === this.sessionId) {
            this.sessionReady = true;
            const offer = await this.peer.createOffer();
            await this.peer.setLocalDescription(offer);
            this.sendSignal({
                type: "offer",
                sessionId: this.sessionId,
                description: this.peer.localDescription,
            });
            for (const candidate of this.pendingLocalCandidates.splice(0)) {
                this.sendSignal({ type: "ice-candidate", sessionId: this.sessionId, candidate });
            }
            return;
        }
        if (message.type === "error") {
            this.fail(`WebRTC signalling failed: ${message.message ?? "unknown error"}`);
            return;
        }
        if (message.sessionId !== this.sessionId) return;
        if (message.type === "answer") {
            await this.peer.setRemoteDescription(message.description);
            this.remoteDescriptionSet = true;
            for (const candidate of this.pendingRemoteCandidates.splice(0)) {
                await this.peer.addIceCandidate(candidate);
            }
            return;
        }
        if (message.type === "ice-candidate" && message.candidate) {
            if (this.remoteDescriptionSet) await this.peer.addIceCandidate(message.candidate);
            else this.pendingRemoteCandidates.push(message.candidate);
            return;
        }
        if (message.type === "session-close") {
            if (this.state !== OPEN) this.fail(`WebRTC signalling closed: ${message.message ?? "session closed"}`);
            return;
        }
        if (message.type === "session-error") {
            this.fail(`WebRTC signalling failed: ${message.message ?? "unknown error"}`);
        }
    }

    private async open(): Promise<void> {
        if (this.state !== CONNECTING) return;
        this.state = OPEN;
        clearTimeout(this.timeout);
        try {
            console.info("[webrtc] selected ICE candidate", await selectedCandidate(this.peer));
        } catch {
            console.info("[webrtc] selected ICE candidate unavailable");
        }
        this.dispatchEvent(new Event("open"));
        // Signalling is no longer on the gameplay path after SCTP opens.
        try { this.signal.close(1000, "DataChannel established"); } catch {}
    }

    private fail(message: string, retryable = false): void {
        if (this.state >= CLOSING) return;
        console.warn(`[webrtc] ${message}`);
        const event = new Event("error") as Event & { error?: Error };
        event.error = new Error(message);
        this.dispatchEvent(event);
        // 4001 = connectivity failure (retry once via TURN); 4000 = terminal.
        this.close(retryable ? 4001 : 4000, message);
    }

    private finishClose(code: number, reason: string, wasClean: boolean): void {
        if (this.state === CLOSED) return;
        this.state = CLOSED;
        clearTimeout(this.timeout);
        for (const request of this.contentRequests.values()) {
            clearTimeout(request.timeout);
            request.reject(new Error("World disconnected"));
        }
        this.contentRequests.clear();
        this.dispatchEvent(new CloseEvent("close", { code, reason, wasClean }));
    }

    private sendSignal(payload: Record<string, unknown>): void {
        if (this.signal?.readyState === WebSocket.OPEN) this.signal.send(JSON.stringify(payload));
    }
}
