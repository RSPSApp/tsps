import { LoginErrorCode } from "../../../game/login/LoginNetworkState";
import { WS_SUPPRESS_RECONNECT_KEY } from "../constants";
import { state } from "../state";
import { clearLoginConnectRetryTimer } from "./loginHelpers";
import { send } from "./send";

/** The existing plugin-message envelope stays readable even when game packet layouts change. */
export function acceptProtocolMessage(msg: any): boolean {
    if (state.protocolRejected) return false;
    if (msg.type === "plugin_message" && msg.payload?.channel === "system:protocol") {
        state.protocolVersion = msg.payload.data?.version;
        return false;
    }
    if (msg.type !== "welcome") return true;
    const expected = process.env.REACT_APP_GAME_PROTOCOL_VERSION;
    if (expected && state.protocolVersion === expected) {
        state.protocolReady = true;
        const pending = state.pendingAuthentication;
        state.pendingAuthentication = null;
        if (pending) send(pending);
        return true;
    }

    // A legacy world's welcome has no preceding version announcement: refuse it too.
    state.protocolRejected = true;
    state.pendingAuthentication = null;
    state.sessionUsername = null;
    state.sessionPassword = null;
    state.sessionLoginFlags = 0;
    state.isReconnecting = false;
    state.loginConnectAttemptId++;
    clearLoginConnectRetryTimer();
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
    const global = typeof window !== "undefined" ? window : globalThis;
    (global as any)[WS_SUPPRESS_RECONNECT_KEY] = true;
    state.socket?.close(4003, "incompatible world protocol");
    for (const listener of state.loginResponseListeners) {
        try { listener({ success: false, errorCode: LoginErrorCode.PROTOCOL_MISMATCH }); }
        catch (error) { console.warn("[ws] login response listener error:", error); }
    }
    return false;
}
