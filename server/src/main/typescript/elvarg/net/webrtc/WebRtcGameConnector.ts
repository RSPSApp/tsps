import { RTCDataChannel, RTCPeerConnection } from "node-datachannel/polyfill";
import { WebSocket } from "ws";
import { getWorldDefinition } from "../../game/definition/WorldDefinition";
import type { BinaryChannel } from "../BinaryChannel";
import { DataChannelBinaryChannel } from "./DataChannelBinaryChannel";

type SignalDescription = { type: "offer" | "answer"; sdp: string };
type SignalCandidate = {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
};
type PeerState = {
  peer: RTCPeerConnection;
  channel?: RTCDataChannel;
  pendingCandidates: SignalCandidate[];
  remoteDescriptionSet: boolean;
  timeout: ReturnType<typeof setTimeout>;
};

const DEFAULT_SIGNAL_URL = "wss://worlds.rsps.app";
// Never give up: the relay only evicts a stale registration of ours after ~30s of
// missed status checks, so retries must outlast that window.
const MAX_RECONNECT_DELAY_MS = 30_000;
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.rsps.app:3478" }];

function parseIceServers(raw: string | undefined): RTCIceServer[] {
  if (!raw) return DEFAULT_ICE_SERVERS;
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("WEBRTC_ICE_SERVERS must be a JSON array");
  return parsed.map((entry) => {
    if (!entry || (typeof entry.urls !== "string" && !Array.isArray(entry.urls))) {
      throw new Error("Each WEBRTC_ICE_SERVERS entry requires urls");
    }
    return entry as RTCIceServer;
  });
}

function signallingEndpoint(raw: string): string {
  const url = new URL(raw);
  if (url.pathname === "/") url.pathname = "/signal";
  return url.toString();
}

export class WebRtcGameConnector {
  private socket?: WebSocket;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private registrationAttempts = 0;
  private readonly peers = new Map<string, PeerState>();

  public static startFromEnv(
    accept: (channel: BinaryChannel) => void,
    playerCount: () => number = () => 0
  ): WebRtcGameConnector | undefined {
    const signalUrl = process.env.WEBRTC_SIGNAL_URL?.trim() || DEFAULT_SIGNAL_URL;
    const worldId = process.env.WEBRTC_WORLD_ID?.trim();
    const worldName = process.env.WEBRTC_WORLD_NAME?.trim() || worldId;
    const token = process.env.WEBRTC_WORLD_TOKEN?.trim();
    if (!worldId && !token) return undefined;
    if (!worldId || !token) {
      console.warn("[webrtc] WEBRTC_WORLD_ID and WEBRTC_WORLD_TOKEN are both required");
      return undefined;
    }
    try {
      const webSocketUrl = process.env.WORLD_WEBSOCKET_URL?.trim();
      if (webSocketUrl) {
        const url = new URL(webSocketUrl);
        if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password || url.hash) {
          throw new Error("WORLD_WEBSOCKET_URL must be a public ws:// or wss:// URL without credentials or a fragment");
        }
      }
      const connector = new WebRtcGameConnector(
        signallingEndpoint(signalUrl),
        worldId,
        worldName,
        token,
        parseIceServers(process.env.WEBRTC_ICE_SERVERS),
        accept,
        playerCount,
        webSocketUrl
      );
      connector.connect();
      return connector;
    } catch (error) {
      console.error("[webrtc] connector configuration rejected", (error as Error).message);
      return undefined;
    }
  }

  constructor(
    private readonly signalUrl: string,
    private readonly worldId: string,
    private readonly worldName: string,
    private readonly token: string,
    private readonly iceServers: RTCIceServer[],
    private readonly accept: (channel: BinaryChannel) => void,
    private readonly playerCount: () => number,
    private readonly webSocketUrl?: string
  ) {}

  public connect(): void {
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return;
    this.registrationAttempts++;
    const socket = new WebSocket(this.signalUrl, { maxPayload: 64 * 1024 });
    this.socket = socket;
    socket.on("open", () => {
      this.send({
        type: "register",
        worldId: this.worldId,
        name: this.worldName,
        playerCount: this.playerCount(),
        ...(this.webSocketUrl ? { webSocketUrl: this.webSocketUrl } : {}),
        token: this.token,
      });
    });
    socket.on("message", (raw, isBinary) => {
      if (socket !== this.socket || isBinary) return;
      try {
        this.handle(JSON.parse(raw.toString("utf8")));
      } catch (error) {
        console.warn("[webrtc] invalid signalling message", (error as Error).message);
      }
    });
    socket.on("close", () => {
      if (socket !== this.socket) return;
      this.socket = undefined;
      for (const [sessionId, state] of this.peers) {
        if (!state.channel) this.closePeer(sessionId);
      }
      const delay = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * 2 ** (this.registrationAttempts - 1));
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
      this.reconnectTimer.unref?.();
    });
    socket.on("error", (error) => console.warn("[webrtc] signalling error", error.message));
  }

  private handle(message: any): void {
    if (!message || typeof message.type !== "string") return;
    if (message.type === "registered") {
      this.registrationAttempts = 0;
      console.info(`[webrtc] registered world ${this.worldId} with signalling relay`);
      // The world list details /host sends; it also renders a spawn minimap preview, which a home server cannot.
      const { description, spawn } = getWorldDefinition();
      this.send({ type: "world-manifest", manifest: { description, maxPlayers: null, spawn } });
      return;
    }
    // A bad listing only loses the world list details; a relay from before world-manifest answers invalid_signal.
    if (message.type === "error" && (message.message === "invalid_world_manifest" || message.message === "invalid_signal")) {
      console.warn("[webrtc] signalling relay rejected the world list details");
      return;
    }
    if (message.type === "status-request") {
      this.send({ type: "world-status", playerCount: this.playerCount() });
      return;
    }
    if (message.type === "error" && typeof message.sessionId !== "string"
      && typeof message.message === "string") {
      console.warn(`[webrtc] signalling relay rejected registration: ${message.message}`);
      return;
    }
    const sessionId = typeof message.sessionId === "string" ? message.sessionId : "";
    if (!sessionId) return;
    if (message.type === "session-open") {
      if (this.webSocketUrl) {
        this.failSession(sessionId, "websocket_required");
        return;
      }
      this.openPeer(sessionId);
      return;
    }
    const state = this.peers.get(sessionId);
    if (!state) return;
    if (message.type === "offer") {
      void this.acceptOffer(sessionId, state, message.description as SignalDescription);
      return;
    }
    if (message.type === "ice-candidate" && message.candidate) {
      const candidate = message.candidate as SignalCandidate;
      if (state.remoteDescriptionSet) void state.peer.addIceCandidate(candidate);
      else state.pendingCandidates.push(candidate);
      return;
    }
    if (message.type === "session-close") {
      // The browser drops signalling as soon as its channel opens, and that can reach us before
      // the channel does. Once answered, a session that never opens ends on the negotiation timeout.
      const signallingDone = state.remoteDescriptionSet && message.message === "browser_signalling_disconnected";
      if (!state.channel && !signallingDone) this.closePeer(sessionId);
      return;
    }
    if (message.type === "session-error") {
      this.closePeer(sessionId);
    }
  }

  private openPeer(sessionId: string): void {
    this.closePeer(sessionId);
    const peer = new RTCPeerConnection({ iceServers: this.iceServers });
    const state: PeerState = {
      peer,
      pendingCandidates: [],
      remoteDescriptionSet: false,
      timeout: setTimeout(() => this.closePeer(sessionId), 30_000),
    };
    state.timeout.unref?.();
    this.peers.set(sessionId, state);
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        this.send({
          type: "ice-candidate",
          sessionId,
          candidate: event.candidate.toJSON(),
        });
      }
    };
    peer.ondatachannel = (event) => this.acceptDataChannel(sessionId, state, event.channel);
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed" || peer.connectionState === "closed") {
        this.closePeer(sessionId);
      }
    };
  }

  private async acceptOffer(sessionId: string, state: PeerState, description: SignalDescription): Promise<void> {
    if (!description || description.type !== "offer" || typeof description.sdp !== "string") {
      this.failSession(sessionId, "invalid_offer");
      return;
    }
    try {
      await state.peer.setRemoteDescription(description);
      state.remoteDescriptionSet = true;
      for (const candidate of state.pendingCandidates.splice(0)) {
        await state.peer.addIceCandidate(candidate);
      }
      const answer = await state.peer.createAnswer();
      this.send({ type: "answer", sessionId, description: answer });
    } catch (error) {
      console.warn(`[webrtc] session ${sessionId} negotiation failed`, (error as Error).message);
      this.failSession(sessionId, "negotiation_failed");
    }
  }

  private acceptDataChannel(sessionId: string, state: PeerState, channel: RTCDataChannel): void {
    if (channel.label !== "game") {
      // Browsers open auxiliary channels (e.g. "content") that this dedicated
      // server does not use. They must never tear down the game session.
      try { channel.close(); } catch {}
      return;
    }
    if (!channel.ordered || channel.maxRetransmits !== null || channel.maxPacketLifeTime !== null) {
      channel.close();
      this.failSession(sessionId, "invalid_game_channel");
      return;
    }
    state.channel = channel;
    channel.binaryType = "arraybuffer";
    const open = () => {
      clearTimeout(state.timeout);
      const pair = state.peer.selectedCandidatePair();
      console.info(`[webrtc] session ${sessionId} ICE selected`, pair ? {
        localType: pair.local.type,
        localAddress: pair.local.address,
        remoteType: pair.remote.type,
        remoteAddress: pair.remote.address,
      } : { candidate: "unknown" });
      const wrapped = new DataChannelBinaryChannel(channel, state.peer);
      if (!wrapped.remoteAddress) {
        console.warn(`[webrtc] session ${sessionId} remote player IP is unavailable; IP identity is not trusted`);
      }
      channel.addEventListener("close", () => this.closePeer(sessionId));
      this.accept(wrapped);
    };
    if (channel.readyState === "open") open();
    else channel.addEventListener("open", open, { once: true });
  }

  private failSession(sessionId: string, message: string): void {
    this.send({ type: "session-error", sessionId, message });
    this.closePeer(sessionId);
  }

  private closePeer(sessionId: string): void {
    const state = this.peers.get(sessionId);
    if (!state) return;
    this.peers.delete(sessionId);
    clearTimeout(state.timeout);
    // Closing the peer before the channel's close reaches the browser aborts SCTP, so the player
    // sees an error and is pinned to the TURN relay. The channel closes once its buffer is sent.
    const closeConnection = () => { try { state.peer.close(); } catch {} };
    const channel = state.channel;
    if (channel && channel.readyState !== "closed") {
      channel.addEventListener("close", closeConnection, { once: true });
      setTimeout(closeConnection, 10_000).unref?.();
      try { channel.close(); } catch {}
    } else closeConnection();
  }

  private send(message: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }
}
