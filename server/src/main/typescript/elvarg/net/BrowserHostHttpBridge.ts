import { randomUUID } from "crypto";
import { IncomingMessage, ServerResponse } from "http";
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
addEventListener("message", function connect(event) {
  if (event.data !== "browser-host-connect" || !event.ports[0]) return;
  removeEventListener("message", connect);
  const port = event.ports[0];
  let sessionId;
  let closed = false;
  // One send in flight; frames that arrive meanwhile go out together in the next.
  // Keyboard movement sends every 20ms, so a send per frame fell behind whenever a
  // WebContainer request took longer than that, and the backlog grew with players.
  const outbox = [];
  let sending = false;
  let contentRequests = 0;
  // The host pauses polling while its peer drains slowly, so unsent frames stay
  // queued on the server, where outbound backpressure can see them.
  let paused;
  let resumePoll;
  // Sends carry a sequence number and polls ack the last batch they got, so
  // the server can drop repeated sends and repeat a batch whose poll was lost.
  let sendSeq = 0;
  let ack = 0;
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
    const data = await response.arrayBuffer();
    ack = Number(response.headers.get("X-Seq"));
    if (data.byteLength) port.postMessage({ type: "message", data }, [data]);
  };
  const poll = async () => {
    while (!closed) await (paused || retrying(pollOnce));
  };
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
          const response = await fetch("/browser-host/session/" + sessionId + "/send?seq=" + seq, { method: "POST", body });
          if (!response.ok) throw new Error("WebContainer HTTP send failed: " + response.status);
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
    } else if (event.data?.type === "close") {
      closed = true;
      fetch("/browser-host/session/" + sessionId, { method: "DELETE", keepalive: true })
        .catch(() => {})
        .finally(() => port.postMessage({ type: "close" }));
    }
  };
  port.start();
  fetch("/browser-host/session", { method: "POST" }).then(async (response) => {
    if (!response.ok) throw new Error("WebContainer HTTP session failed: " + response.status);
    sessionId = await response.text();
    port.postMessage({ type: "open" });
    return poll();
  }).catch(fail);
});
parent.postMessage("browser-host-ready", "*");
</script>`;

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

  public close(code?: number, reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    // Header-safe, as the page reads it from the poll that ends the session.
    this.closeReason = (reason || "closed by the game server").replace(/[^\x20-\x7e]/g, "?");
    console.info(`[browser-host] game session closed: ${this.closeReason}`);
    clearTimeout(this.abandonTimeout);
    if (this.queued.length > 0) this.flushPoll();
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
    if (!this.poll || (!this.unacked && this.queued.length === 0)) return;
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
    this.finishPoll(200, this.unacked);
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

export class BrowserHostHttpBridge {
  private readonly sessions = new Map<string, BrowserHostHttpChannel>();

  constructor(private readonly accept: (channel: BinaryChannel) => void) {}

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
