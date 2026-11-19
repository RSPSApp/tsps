import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { IncomingMessage, ServerResponse } from "http";
import { WebSocket } from "ws";
import { BinaryChannel, MAX_GAME_MESSAGE_BYTES } from "./BinaryChannel";

const POLL_TIMEOUT_MS = 10_000;
// WebContainer fetches occasionally drop (#559). The page retries for up to
// RETRY_MS, so an aborted poll only ends the session once that has passed.
const RETRY_MS = 15_000;
// The page runs in the same tab as this server, and a page that goes away sends
// DELETE first. One that stops polling has usually stalled, as both players' pages did
// together in #559, so give it minutes rather than seconds to come back.
const ABANDON_MS = 2 * 60_000;

export const BROWSER_HOST_BRIDGE_HTML = `<!doctype html><meta charset="utf-8"><script>
let sharedStream;
function sharedGameSocket(url) {
  if (!sharedStream || sharedStream.socket.readyState >= 2) {
    const endpoint = new URL("/browser-host/stream", url);
    const socket = new WebSocket(endpoint);
    socket.binaryType = "arraybuffer";
    const state = { socket, sessions: new Map(), nextId: 0 };
    sharedStream = state;
    socket.onopen = () => { for (const session of state.sessions.values()) session.attach(); };
    socket.onmessage = (event) => {
      if (typeof event.data === "string") {
        let message;
        try { message = JSON.parse(event.data); } catch { socket.close(); return; }
        const session = state.sessions.get(message.id);
        if (!session) return;
        if (message.type === "open") { session.readyState = 1; session.onopen?.(); }
        else if (message.type === "data") session.onmessage?.({ data: message.data });
        else if (message.type === "close") session.finish(message.code, message.reason);
      } else if (event.data instanceof ArrayBuffer && event.data.byteLength >= 8 && event.data.byteLength <= ${MAX_GAME_MESSAGE_BYTES + 8}) {
        const id = new DataView(event.data).getUint32(0);
        state.sessions.get(id)?.onmessage?.({ data: event.data.slice(4) });
      } else socket.close();
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (sharedStream === state) sharedStream = undefined;
      for (const session of [...state.sessions.values()]) session.finish(1006, "shared stream disconnected");
    };
  }
  const state = sharedStream;
  const id = ++state.nextId;
  const sessionId = url.pathname.split("/")[3];
  const session = {
    readyState: 0,
    attach() { if (state.sessions.has(id)) state.socket.send(JSON.stringify({ type: "attach", id, sessionId })); },
    send(data) {
      if (state.socket.readyState !== 1) { session.finish(1006, "shared stream unavailable"); throw new TypeError("Shared stream unavailable"); }
      if (typeof data === "string") state.socket.send(JSON.stringify({ type: "data", id, data }));
      else {
        const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        const frame = new Uint8Array(bytes.byteLength + 4);
        new DataView(frame.buffer).setUint32(0, id);
        frame.set(bytes, 4);
        state.socket.send(frame);
      }
    },
    finish(code, reason) {
      if (session.readyState === 3) return;
      session.readyState = 3;
      state.sessions.delete(id);
      session.onclose?.({ code, reason });
      if (state.sessions.size === 0 && state.socket.readyState < 2) state.socket.close();
    },
    close() {
      if (state.socket.readyState === 1) state.socket.send(JSON.stringify({ type: "detach", id }));
      session.finish(1006, "local stream closed");
    },
  };
  state.sessions.set(id, session);
  if (state.socket.readyState === 1) queueMicrotask(() => session.attach());
  return session;
}

addEventListener("message", function connect(event) {
  if (event.data !== "browser-host-connect" || !event.ports[0]) return;
  const port = event.ports[0];
  let sessionId;
  let closed = false;
  // One send in flight; frames that arrive meanwhile go out together in the next.
  // Keyboard movement sends every 20ms, so a send per frame fell behind whenever a
  // WebContainer request took longer than that, and the backlog grew with players.
  const outbox = [];
  let sending = false;
  let contentRequests = 0;
  // A slow peer pauses delivery, leaving unsent frames on the server where
  // outbound backpressure can see them.
  let paused;
  let resumePoll;
  // Both transports share sequences, so HTTP can recover an interrupted stream
  // without repeating player actions or losing server output.
  let sendSeq = 0;
  let ack = 0;
  let stream;
  let streamFrame;
  let pendingSend;
  const retrying = async (request) => {
    const deadline = Date.now() + ${RETRY_MS};
    for (let delay = 250; ; delay = Math.min(delay * 2, 2000)) {
      try {
        return await request();
      } catch (error) {
        // fetch() and body reads reject with a TypeError on network failure.
        if (closed || !(error instanceof TypeError) || Date.now() + delay > deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  };
  const fetchContent = async (request) => {
    const { id, path } = request;
    if (!Number.isSafeInteger(id) || typeof path !== "string" || path.length > 2048 ||
        !/^\\/api\\/[a-z0-9-]+(?:\\/[a-z0-9-]+)*(?:\\?[^#]*)?$/i.test(path)) return;
    if (contentRequests >= 16) {
      port.postMessage({ type: "content", id, error: "Too many content requests" });
      return;
    }
    contentRequests++;
    try {
      const response = await fetch(path, { signal: AbortSignal.timeout(8000), redirect: "error" });
      if (!response.ok) throw new Error("Content request failed: " + response.status);
      const body = await response.text();
      if (body.length > 2000000) throw new Error("Content response too large");
      port.postMessage({ type: "content", id, body });
    } catch (error) {
      port.postMessage({ type: "content", id, error: error.message });
    } finally {
      contentRequests--;
    }
  };
  const fail = (error) => {
    if (closed) return;
    closed = true;
    stream?.close();
    port.postMessage({ type: "error", message: error?.message || "WebContainer HTTP bridge failed" });
    if (sessionId) fetch("/browser-host/session/" + sessionId, { method: "DELETE", keepalive: true }).catch(() => {});
  };
  const pollOnce = async () => {
    const response = await fetch("/browser-host/session/" + sessionId + "/poll?ack=" + ack, { cache: "no-store" });
    if (response.status === 204) return;
    if (response.status === 404 || response.status === 410) {
      closed = true;
      port.postMessage({ type: "close", message: response.headers.get("X-Close-Reason") ||
        (response.status === 404 ? "game session not found" : "game session closed") });
      return;
    }
    if (!response.ok) throw new Error("WebContainer HTTP poll failed: " + response.status);
    const seq = Number(response.headers.get("X-Seq"));
    // The preview proxy can return its HTML error page with status 200.
    if (response.headers.get("Content-Type") !== "application/octet-stream" || seq !== ack + 1) {
      throw new TypeError("Invalid WebContainer HTTP poll response");
    }
    const data = await response.arrayBuffer();
    ack = seq;
    if (data.byteLength) port.postMessage({ type: "message", data }, [data]);
  };
  const poll = async () => {
    while (!closed) await (paused || retrying(pollOnce));
  };
  const flushStream = () => {
    if (closed || paused || !streamFrame || !stream) return;
    const { seq, data } = streamFrame;
    streamFrame = undefined;
    if (seq > ack) {
      if (seq !== ack + 1) throw new Error("WebContainer stream sequence gap");
      port.postMessage({ type: "message", data }, [data]);
      ack = seq;
    }
    stream.send(String(ack));
  };
  const dropStream = (socket) => {
    if (stream !== socket) return;
    stream = undefined;
    streamFrame = undefined;
    pendingSend?.reject(new TypeError("WebContainer stream disconnected"));
    pendingSend = undefined;
    if (!closed) poll().catch(fail);
  };
  const openStream = () => new Promise((resolve) => {
    if (typeof WebSocket !== "function") return resolve(false);
    const url = new URL("/browser-host/session/" + sessionId + "/stream", location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = sharedGameSocket(url);
    socket.binaryType = "arraybuffer";
    const timeout = setTimeout(() => { socket.close(); resolve(false); }, 1000);
    socket.onopen = () => { clearTimeout(timeout); stream = socket; resolve(true); };
    socket.onerror = () => socket.close();
    socket.onclose = (event) => {
      clearTimeout(timeout);
      resolve(false);
      if (stream !== socket) return;
      if (!closed && event.code === 1000) {
        closed = true;
        port.postMessage({ type: "close", message: event.reason || "game session closed" });
      }
      dropStream(socket);
    };
    socket.onmessage = (event) => {
      if (stream !== socket || closed) return;
      if (typeof event.data === "string") {
        if (pendingSend && event.data === String(pendingSend.seq)) {
          pendingSend.resolve();
          pendingSend = undefined;
        }
      } else {
        if (!(event.data instanceof ArrayBuffer) || event.data.byteLength < 4 || event.data.byteLength > ${MAX_GAME_MESSAGE_BYTES + 4}) {
          fail(new Error("Invalid WebContainer stream frame"));
          return;
        }
        streamFrame = { seq: new DataView(event.data).getUint32(0), data: event.data.slice(4) };
        try { flushStream(); } catch (error) { fail(error); }
      }
    };
  });
  const sendOutbox = async () => {
    sending = true;
    try {
      while (!closed && outbox.length) {
        // Client packets are self-delimiting, so the server decodes a batch as it does one frame.
        let count = 0;
        let bytes = 0;
        while (count < outbox.length && (count === 0 || bytes + outbox[count].byteLength <= ${MAX_GAME_MESSAGE_BYTES})) {
          bytes += outbox[count++].byteLength;
        }
        const body = new Uint8Array(bytes);
        let offset = 0;
        for (const frame of outbox.splice(0, count)) {
          body.set(new Uint8Array(frame), offset);
          offset += frame.byteLength;
        }
        // A retry repeats the same batch and seq, so the server can drop a duplicate.
        const seq = ++sendSeq;
        await retrying(async () => {
          if (stream?.readyState === 1) {
            const socket = stream;
            const frame = new Uint8Array(body.byteLength + 4);
            new DataView(frame.buffer).setUint32(0, seq);
            frame.set(body, 4);
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => { dropStream(socket); socket.close(); }, 1000);
              pendingSend = {
                seq,
                resolve: () => { clearTimeout(timeout); resolve(); },
                reject: (error) => { clearTimeout(timeout); reject(error); },
              };
              socket.send(frame);
            });
            return;
          }
          const response = await fetch("/browser-host/session/" + sessionId + "/send?seq=" + seq, { method: "POST", body });
          if (!response.ok) throw new Error("WebContainer HTTP send failed: " + response.status);
          if (response.status !== 204) throw new TypeError("Invalid WebContainer HTTP send response");
        });
        port.postMessage({ type: "sent", bytes });
      }
    } finally {
      sending = false;
    }
  };
  port.onmessage = (event) => {
    if (closed) return;
    if (event.data?.type === "content") {
      void fetchContent(event.data);
    } else if (event.data?.type === "message" && event.data.data instanceof ArrayBuffer) {
      outbox.push(event.data.data);
      if (!sending) sendOutbox().catch(fail);
    } else if (event.data?.type === "pause") {
      if (!paused) paused = new Promise((resolve) => { resumePoll = resolve; });
    } else if (event.data?.type === "resume") {
      paused = undefined;
      resumePoll?.();
      try { flushStream(); } catch (error) { fail(error); }
    } else if (event.data?.type === "close") {
      closed = true;
      stream?.close();
      fetch("/browser-host/session/" + sessionId, { method: "DELETE", keepalive: true })
        .catch(() => {})
        .finally(() => port.postMessage({ type: "close" }));
    }
  };
  port.start();
  fetch("/browser-host/session", { method: "POST" }).then(async (response) => {
    if (!response.ok) throw new Error("WebContainer HTTP session failed: " + response.status);
    sessionId = await response.text();
    const streaming = await openStream();
    port.postMessage({ type: "open" });
    if (!streaming) return poll();
  }).catch(fail);
});
parent.postMessage({ type: "browser-host-ready", multiplex: true }, "*");
parent.postMessage("browser-host-ready", "*");
</script>`;

type GameStream = Pick<WebSocket, "send" | "close" | "terminate"> & EventEmitter & { readonly readyState: number };

type CloseHandler = (code?: number, reason?: Buffer | string) => void;

export class BrowserHostHttpChannel implements BinaryChannel {
  public readonly kind = "websocket" as const;
  public readonly binaryTransport = true as const;
  public readonly remoteAddress = "127.0.0.1";
  private readonly queued: Buffer[] = [];
  private queuedBytes = 0;
  private dataHandler?: (data: Buffer) => void;
  private readonly closeHandlers: CloseHandler[] = [];
  private readonly errorHandlers: Array<(error: Error) => void> = [];
  private poll?: ServerResponse;
  private pollTimeout?: NodeJS.Timeout;
  private abandonTimeout?: NodeJS.Timeout;
  private closed = false;
  private closeReason = "";
  /** The last batch sent to a poll, kept until the next poll acks it. */
  private unacked?: Buffer;
  private sentSeq = 0;
  private receivedSeq = 0;
  private lastPollAt = 0;
  private stream?: GameStream;
  private streamSentSeq = -1;

  public get bufferedAmount(): number {
    return this.queuedBytes;
  }

  public get readyState(): number {
    return this.closed ? 3 : 1;
  }

  public send(payload: Buffer): void {
    if (!this.isOpen()) throw new Error("Browser-host HTTP channel is closed");
    if (payload.length > MAX_GAME_MESSAGE_BYTES) {
      this.reject(new Error(`Browser-host HTTP message exceeds ${MAX_GAME_MESSAGE_BYTES} bytes`));
      return;
    }
    this.queued.push(Buffer.from(payload));
    this.queuedBytes += payload.length;
    this.flushPoll();
  }

  public receive(payload: Buffer, seq: number): void {
    if (!this.isOpen() || seq <= this.receivedSeq) return;
    this.receivedSeq = seq;
    if (payload.length > MAX_GAME_MESSAGE_BYTES) {
      this.reject(new Error(`Browser-host HTTP message exceeds ${MAX_GAME_MESSAGE_BYTES} bytes`));
      return;
    }
    this.dataHandler?.(payload);
  }

  public attachPoll(response: ServerResponse, ack: number): void {
    this.stream?.close(1001, "switching to HTTP polling");
    this.stream = undefined;
    const gap = Date.now() - this.lastPollAt;
    if (this.lastPollAt && gap > RETRY_MS) console.info(`[browser-host] poll resumed after ${Math.round(gap / 1000)}s`);
    this.lastPollAt = Date.now();
    if (ack === this.sentSeq) this.unacked = undefined;
    if (this.isDrained()) {
      response.statusCode = 410;
      response.setHeader("X-Close-Reason", this.closeReason);
      response.end();
      return;
    }
    clearTimeout(this.abandonTimeout);
    this.finishPoll(204);
    this.poll = response;
    response.on("close", () => {
      if (response.writableEnded || this.poll !== response) return;
      clearTimeout(this.pollTimeout);
      this.poll = undefined;
      this.abandonTimeout = setTimeout(() => this.close(1001, `no poll for ${ABANDON_MS / 1000}s`), ABANDON_MS);
      this.abandonTimeout.unref?.();
    });
    this.pollTimeout = setTimeout(() => this.finishPoll(204), POLL_TIMEOUT_MS);
    this.pollTimeout.unref?.();
    this.flushPoll();
  }

  public attachStream(socket: GameStream): void {
    this.stream?.close(1001, "stream replaced");
    this.stream = socket;
    this.streamSentSeq = -1;
    clearTimeout(this.abandonTimeout);
    this.finishPoll(204);
    socket.on("message", (raw, binary) => {
      if (this.stream !== socket) return;
      if (!binary) {
        if (raw.toString() === String(this.sentSeq)) {
          this.unacked = undefined;
          this.flushPoll();
        }
      } else {
        const frame = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
        if (frame.length < 4 || frame.length > MAX_GAME_MESSAGE_BYTES + 4) {
          socket.close(1009, "invalid game stream frame");
          return;
        }
        const seq = frame.readUInt32BE(0);
        this.receive(frame.subarray(4), seq);
        if (socket.readyState === WebSocket.OPEN) socket.send(String(seq));
      }
    });
    socket.on("error", () => socket.terminate());
    socket.on("close", () => {
      if (this.stream !== socket) return;
      this.stream = undefined;
      if (this.closed) return;
      this.abandonTimeout = setTimeout(() => this.close(1001, "no stream or poll for 120s"), ABANDON_MS);
      this.abandonTimeout.unref?.();
    });
    this.flushPoll();
  }

  public close(code?: number, reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    // Header-safe, as the page reads it from the poll that ends the session.
    this.closeReason = (reason || "closed by the game server").replace(/[^\x20-\x7e]/g, "?");
    console.info(`[browser-host] game session closed: ${this.closeReason}`);
    clearTimeout(this.abandonTimeout);
    if (this.stream || this.queued.length > 0) this.flushPoll();
    else this.finishPoll(410);
    for (const handler of this.closeHandlers) handler(code, reason);
  }

  public onData(handler: (data: Buffer) => void): void {
    this.dataHandler = handler;
  }

  public onClose(handler: CloseHandler): void {
    this.closeHandlers.push(handler);
  }

  public onError(handler: (error: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  public isOpen(): boolean {
    return !this.closed;
  }

  public isDrained(): boolean {
    return this.closed && this.queued.length === 0 && !this.unacked;
  }

  private flushPoll(): void {
    if (this.stream && this.isDrained()) {
      this.stream.close(1000, this.closeReason.slice(0, 123));
      return;
    }
    if ((!this.poll && !this.stream) || (!this.unacked && this.queued.length === 0)) return;
    if (!this.unacked) {
      const frames: Buffer[] = [];
      let bytes = 0;
      while (this.queued.length > 0 && bytes + this.queued[0].length <= MAX_GAME_MESSAGE_BYTES) {
        const frame = this.queued.shift()!;
        frames.push(frame);
        bytes += frame.length;
        this.queuedBytes -= frame.length;
      }
      this.unacked = Buffer.concat(frames, bytes);
      this.sentSeq++;
    }
    if (this.stream) {
      if (this.streamSentSeq === this.sentSeq || this.stream.readyState !== WebSocket.OPEN) return;
      const header = Buffer.alloc(4);
      header.writeUInt32BE(this.sentSeq);
      this.streamSentSeq = this.sentSeq;
      this.stream.send(Buffer.concat([header, this.unacked]));
    } else this.finishPoll(200, this.unacked);
  }

  private finishPoll(status: number, body?: Buffer): void {
    if (this.pollTimeout) clearTimeout(this.pollTimeout);
    this.pollTimeout = undefined;
    const response = this.poll;
    this.poll = undefined;
    if (!response || response.writableEnded) return;
    response.statusCode = status;
    if (status === 410) response.setHeader("X-Close-Reason", this.closeReason);
    if (body) {
      response.setHeader("Content-Type", "application/octet-stream");
      response.setHeader("Content-Length", body.length);
      response.setHeader("X-Seq", this.sentSeq);
    }
    response.end(body);
  }

  private reject(error: Error): void {
    for (const handler of this.errorHandlers) handler(error);
    this.close(1009, error.message);
  }
}

class SharedGameStream extends EventEmitter {
  public readyState: number = WebSocket.OPEN;
  constructor(private readonly socket: WebSocket, private readonly id: number, private readonly release: () => void) { super(); }

  public send(data: Buffer | string): void {
    if (this.readyState !== WebSocket.OPEN) return;
    if (typeof data === "string") this.socket.send(JSON.stringify({ type: "data", id: this.id, data }));
    else {
      const header = Buffer.alloc(4);
      header.writeUInt32BE(this.id);
      this.socket.send(Buffer.concat([header, data]));
    }
  }

  public close(code = 1000, reason = ""): void {
    if (this.readyState === WebSocket.CLOSED) return;
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: "close", id: this.id, code, reason }));
    this.disconnect();
  }

  public terminate(): void { this.close(1006, "logical stream disconnected"); }

  public disconnect(): void {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.release();
    this.emit("close");
  }
}

export class BrowserHostHttpBridge {
  private readonly sessions = new Map<string, BrowserHostHttpChannel>();

  constructor(private readonly accept: (channel: BinaryChannel) => void) {}

  public attachStream(socket: WebSocket, request: IncomingMessage): void {
    if (request.url === "/browser-host/stream") {
      const streams = new Map<number, SharedGameStream>();
      socket.on("message", (raw, binary) => {
        const frame = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
        if (binary) {
          if (frame.length < 8 || frame.length > MAX_GAME_MESSAGE_BYTES + 8) { socket.close(1009, "invalid shared game frame"); return; }
          streams.get(frame.readUInt32BE(0))?.emit("message", frame.subarray(4), true);
          return;
        }
        if (frame.length > 4096) { socket.close(1009, "invalid stream control"); return; }
        let message;
        try { message = JSON.parse(frame.toString()); } catch { socket.close(1008, "invalid stream control"); return; }
        if (!Number.isInteger(message?.id) || message.id < 1 || message.id > 0xffffffff) { socket.close(1008, "invalid stream id"); return; }
        if (message.type === "attach") {
          const channel = typeof message.sessionId === "string" && this.sessions.get(message.sessionId);
          if (!channel || streams.has(message.id)) { socket.send(JSON.stringify({ type: "close", id: message.id, code: 1008, reason: "unknown game session" })); return; }
          const stream = new SharedGameStream(socket, message.id, () => streams.delete(message.id));
          streams.set(message.id, stream);
          socket.send(JSON.stringify({ type: "open", id: message.id }));
          channel.attachStream(stream);
        } else if (message.type === "data" && typeof message.data === "string" && /^\d{1,10}$/.test(message.data)) {
          streams.get(message.id)?.emit("message", Buffer.from(message.data), false);
        } else if (message.type === "detach") streams.get(message.id)?.disconnect();
        else socket.close(1008, "invalid stream control");
      });
      socket.on("close", () => { for (const stream of [...streams.values()]) stream.disconnect(); });
      socket.on("error", () => socket.terminate());
      return;
    }
    const match = /^\/browser-host\/session\/([0-9a-f-]+)\/stream$/.exec(request.url ?? "");
    const channel = match && this.sessions.get(match[1]);
    if (channel) channel.attachStream(socket);
    else socket.close(1008, "unknown game session");
  }

  public handle(request: IncomingMessage, response: ServerResponse): boolean {
    if (request.method === "POST" && request.url === "/browser-host/session") {
      const id = randomUUID();
      const channel = new BrowserHostHttpChannel();
      this.sessions.set(id, channel);
      channel.onClose(() => {
        const timeout = setTimeout(() => {
          if (this.sessions.get(id) === channel) this.sessions.delete(id);
        }, 30_000);
        timeout.unref?.();
      });
      this.accept(channel);
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.end(id);
      return true;
    }

    const match = /^\/browser-host\/session\/([0-9a-f-]+)(?:\/(poll|send)\?(?:ack|seq)=(\d+))?$/.exec(request.url ?? "");
    if (!match) return false;
    const channel = this.sessions.get(match[1]);
    if (!channel) {
      response.statusCode = 404;
      response.end();
      return true;
    }
    if (request.method === "GET" && match[2] === "poll") {
      channel.attachPoll(response, Number(match[3]));
      if (channel.isDrained()) this.sessions.delete(match[1]);
      return true;
    }
    if (request.method === "POST" && match[2] === "send") {
      void this.receive(request, response, channel, Number(match[3])).catch((error) => {
        channel.close(1011, `send failed: ${(error as Error).message}`);
        if (!response.headersSent) response.statusCode = 400;
        if (!response.writableEnded) response.end();
      });
      return true;
    }
    if (request.method === "DELETE" && !match[2]) {
      channel.close(1000, "browser host closed the session");
      this.sessions.delete(match[1]);
      response.statusCode = 204;
      response.end();
      return true;
    }
    response.statusCode = 405;
    response.end();
    return true;
  }

  private async receive(
    request: IncomingMessage,
    response: ServerResponse,
    channel: BrowserHostHttpChannel,
    seq: number
  ): Promise<void> {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_GAME_MESSAGE_BYTES) {
        response.statusCode = 413;
        response.end();
        channel.close(1009, `message over ${MAX_GAME_MESSAGE_BYTES} bytes`);
        return;
      }
      chunks.push(buffer);
    }
    channel.receive(Buffer.concat(chunks, bytes), seq);
    response.statusCode = 204;
    response.end();
  }
}
