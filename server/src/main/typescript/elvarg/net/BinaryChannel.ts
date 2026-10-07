import { isIP, Socket } from "net";
import type { IncomingMessage } from "http";
import { RawData, WebSocket } from "ws";

export const MAX_GAME_MESSAGE_BYTES = 64 * 1024;

export type BinaryChannelKind = "websocket" | "webrtc" | "tcp" | "headless";

export interface BinaryChannel {
  readonly kind: BinaryChannelKind;
  readonly binaryTransport: true;
  readonly remoteAddress: string;
  readonly bufferedAmount?: number;
  readonly readyState?: number;
  send(payload: Buffer): void;
  close(code?: number, reason?: string): void;
  onData(handler: (data: Buffer) => void): void;
  onClose(handler: (code?: number, reason?: Buffer | string) => void): void;
  onError(handler: (err: Error) => void): void;
  isOpen(): boolean;
}

export class WebSocketBinaryChannel implements BinaryChannel {
  public readonly kind = "websocket" as const;
  public readonly binaryTransport = true as const;

  constructor(private readonly socket: WebSocket, private readonly request?: IncomingMessage) {}

  public get remoteAddress(): string {
    const address = this.request?.socket.remoteAddress ?? (this.socket as any)?._socket?.remoteAddress ?? "";
    const realIp = this.request?.headers["x-real-ip"];
    // nginx overwrites this header; only a local proxy may supply player identity.
    if (["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address)
      && typeof realIp === "string" && isIP(realIp)) return realIp;
    return address;
  }

  public get bufferedAmount(): number {
    return this.socket.bufferedAmount;
  }

  public get readyState(): number {
    return this.socket.readyState;
  }

  public send(payload: Buffer): void {
    this.socket.send(payload);
  }

  public close(code?: number, reason?: string): void {
    this.socket.close(code, reason);
  }

  public onData(handler: (data: Buffer) => void): void {
    this.socket.on("message", (data: RawData) => {
      handler(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
    });
  }

  public onClose(handler: (code?: number, reason?: Buffer | string) => void): void {
    this.socket.on("close", handler);
  }

  public onError(handler: (err: Error) => void): void {
    this.socket.on("error", handler);
  }

  public isOpen(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }
}

export class TcpBinaryChannel implements BinaryChannel {
  public readonly kind = "tcp" as const;
  public readonly binaryTransport = true as const;

  constructor(private readonly socket: Socket) {
    this.socket.setNoDelay(true);
  }

  public get remoteAddress(): string {
    return this.socket.remoteAddress ?? "";
  }

  public get bufferedAmount(): number {
    return this.socket.writableLength;
  }

  public send(payload: Buffer): void {
    this.socket.write(payload);
  }

  public close(): void {
    this.socket.end();
  }

  public onData(handler: (data: Buffer) => void): void {
    this.socket.on("data", handler);
  }

  public onClose(handler: () => void): void {
    this.socket.on("close", handler);
  }

  public onError(handler: (err: Error) => void): void {
    this.socket.on("error", handler);
  }

  public isOpen(): boolean {
    return !this.socket.destroyed && this.socket.writable;
  }
}

/** A client with no socket: everything sent to it is dropped. Lets the server drive a login without a real client. */
export class HeadlessBinaryChannel implements BinaryChannel {
  public readonly kind = "headless" as const;
  public readonly binaryTransport = true as const;
  public readonly remoteAddress = "headless";
  private open = true;
  private readonly closeHandlers: Array<() => void> = [];

  public get readyState(): number {
    return this.open ? 1 : 3;
  }

  public send(): void {}

  public close(): void {
    if (!this.open) return;
    this.open = false;
    for (const handler of this.closeHandlers) handler();
  }

  public onData(): void {}

  public onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  public onError(): void {}

  public isOpen(): boolean {
    return this.open;
  }
}
