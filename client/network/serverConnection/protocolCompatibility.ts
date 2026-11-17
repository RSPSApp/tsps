import { state } from "./state";
import { clearLoginConnectRetryTimer } from "./connection/loginHelpers";
import type { GameSocket } from "./connection/GameSocket";

// Wire contract, not a source/cache/build revision. Keep in step with the server's
// net/protocol/WireProtocolVersion.ts; bump only for incompatible wire changes.
export const WIRE_PROTOCOL_VERSION = 1;
export const WIRE_PROTOCOL_CHANNEL = "protocol:version";
export const WELCOME_TIMEOUT_MS = 10000;

function isValidWelcome(msg: any): boolean {
    return msg?.type === "welcome" && Number.isSafeInteger(msg.payload?.tickMs)
        && msg.payload.tickMs > 0 && Number.isSafeInteger(msg.payload?.serverTime);
}

export class ProtocolGreeting {
    version: number | undefined;
    complete = false;
    mismatch = false;
    receive(msg: any): void {
        if (this.complete || this.mismatch) return;
        if (msg?.type === "plugin_message" && msg.payload?.channel === WIRE_PROTOCOL_CHANNEL) {
            const version = msg.payload.data?.version;
            if (typeof version === "number" && Number.isSafeInteger(version) && version > 0) {
                this.version = version;
                this.mismatch = version !== WIRE_PROTOCOL_VERSION;
            }
        } else if (isValidWelcome(msg)) this.complete = true;
    }
}

export type ProtocolNotice = { kind: "warning" | "error"; message: string } | undefined;
let notice: ProtocolNotice;
const listeners = new Set<(value: ProtocolNotice) => void>();
let greeting = new ProtocolGreeting();
let welcomeTimer: ReturnType<typeof setTimeout> | undefined;

function setNotice(value: ProtocolNotice): void {
    notice = value;
    for (const listener of listeners) listener(value);
}
export function subscribeProtocolNotice(listener: (value: ProtocolNotice) => void): () => void {
    listeners.add(listener);
    listener(notice);
    return () => { listeners.delete(listener); };
}
export function clearWelcomeTimer(): void {
    if (welcomeTimer) clearTimeout(welcomeTimer);
    welcomeTimer = undefined;
}
export function resetProtocolCompatibility(): void {
    clearWelcomeTimer();
    greeting = new ProtocolGreeting();
    setNotice(undefined);
}
function failGreeting(message: string, code: number): void {
    clearWelcomeTimer();
    clearLoginConnectRetryTimer();
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
    state.loginConnectAttemptId++;
    state.loginOnWelcome = null;
    state.sessionUsername = null;
    state.sessionPassword = null;
    state.sessionLoginFlags = 0;
    state.hasLoggedIn = false;
    state.isReconnecting = false;
    setNotice({ kind: "error", message });
    for (const listener of state.loginResponseListeners) {
        try { listener({ success: false, error: code === 4003 ? "World protocol is incompatible." : "World did not send a login greeting." }); } catch {}
    }
    try { state.socket?.close(code, code === 4003 ? "protocol mismatch" : "welcome timeout"); } catch {}
}
export function startWelcomeTimer(socket: GameSocket): void {
    clearWelcomeTimer();
    welcomeTimer = setTimeout(() => {
        if (state.socket === socket && !greeting.complete) {
            failGreeting("This world did not send its login greeting. Please try again or choose another world.", 4004);
        }
    }, WELCOME_TIMEOUT_MS);
}
/** Runs before login extensions and before any queued credential is encoded. */
export function receiveProtocolGreeting(msg: any): boolean {
    if (msg?.type === "welcome" && !isValidWelcome(msg)) return false;
    greeting.receive(msg);
    if (greeting.mismatch) {
        if (notice?.kind !== "error") {
            failGreeting(`This client uses protocol ${WIRE_PROTOCOL_VERSION}; this world uses protocol ${greeting.version}. Refresh the client or update the world before logging in.`, 4003);
        }
        return false;
    }
    if (msg?.type === "welcome") {
        clearWelcomeTimer();
        if (greeting.version === undefined) setNotice({
            kind: "warning",
            message: "This world has not announced a supported protocol version. Compatibility is unknown; you can still play.",
        });
    }
    return true;
}
export function isProtocolRejected(): boolean { return greeting.mismatch; }
