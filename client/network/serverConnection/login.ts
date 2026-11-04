import { WS_SUPPRESS_RECONNECT_KEY, LOGIN_CONNECT_RETRY_DELAY_MS } from "./constants";
import { clearLoginConnectRetryTimer } from "./connection/loginHelpers";
import { initServerConnection } from "./connection/init";
import { send } from "./connection/send";
import { state } from "./state";
import type { GameSocket } from "./connection/GameSocket";
import { resolveServerTransport } from "./outgoing/connectionInfo";
import { encodeClientMessage } from "../packet/ClientBinaryEncoder";

export function setAutoSendHandshake(auto: boolean): void {
    state.autoSendHandshake = auto;
}

export function subscribeLoginResponse(
    cb: (info: {
        success: boolean;
        error?: string;
        errorCode?: number;
        displayName?: string;
        loginToken?: string;
    }) => void,
): () => void {
    state.loginResponseListeners.add(cb);
    return () => state.loginResponseListeners.delete(cb);
}

/**
 * Subscribe to logout response events from server.
 */
export function subscribeLogoutResponse(
    cb: (info: { success: boolean; reason?: string }) => void,
): () => void {
    state.logoutResponseListeners.add(cb);
    return () => state.logoutResponseListeners.delete(cb);
}

/**
 * Send login credentials to server.
 * If the state.socket isn't open (e.g., after logout), this will reconnect first.
 * `password` is the "Stay logged in" token when `flags` has LOGIN_FLAG_TOKEN.
 */
export async function sendLogin(
    username: string,
    password: string,
    revision: number = 0,
    flags: number = 0,
): Promise<void> {
    // Store credentials for session resumption on reconnect
    state.sessionUsername = username;
    state.sessionPassword = password;
    state.sessionRevision = revision;
    state.sessionLoginFlags = flags;
    const attemptId = ++state.loginConnectAttemptId;
    if (state.webRtcConfig && !await resolveServerTransport()) return;
    if (attemptId !== state.loginConnectAttemptId) return;

    // Clear suppress flag - user is intentionally logging in
    try {
        const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
        g[WS_SUPPRESS_RECONNECT_KEY] = false;
    } catch {}

    const sendLoginPayload = () => {
        send({
            type: "login",
            payload: { username, password, revision, flags },
        } as any);
    };

    const attachLoginOnOpen = (targetSocket: GameSocket) => {
        const sendLoginOnOpen = () => {
            targetSocket.removeEventListener("open", sendLoginOnOpen);
            if (attemptId !== state.loginConnectAttemptId) return;
            if (state.socket !== targetSocket || targetSocket.readyState !== WebSocket.OPEN) return;
            clearLoginConnectRetryTimer();
            sendLoginPayload();
        };

        targetSocket.addEventListener("open", sendLoginOnOpen);
    };

    const connectForLogin = (url: string, forceFreshSocket: boolean) => {
        const currentSocket = state.socket;
        if (
            forceFreshSocket &&
            currentSocket &&
            (currentSocket.readyState === WebSocket.OPEN ||
                currentSocket.readyState === WebSocket.CONNECTING)
        ) {
            state.socket = null;
            try {
                currentSocket.close(1000, "login retry");
            } catch {}
        }

        initServerConnection(url);
        if (state.socket) {
            if (state.socket.readyState === WebSocket.OPEN) {
                if (attemptId === state.loginConnectAttemptId) {
                    clearLoginConnectRetryTimer();
                    sendLoginPayload();
                }
            } else {
                attachLoginOnOpen(state.socket);
            }
        }
    };

    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
        // Socket not open - need to reconnect first
        console.log("[ws] Socket not open, reconnecting before login...");
        clearLoginConnectRetryTimer();
        connectForLogin(state.lastUrl, false);

        // WebRTC owns its ICE timeout and reports a terminal connect failure to the login UI.
        if (state.webRtcConfig) return;

        state.loginConnectRetryTimer = setTimeout(() => {
            state.loginConnectRetryTimer = null;
            if (attemptId !== state.loginConnectAttemptId) return;
            if (state.socket && state.socket.readyState === WebSocket.OPEN) return;

            console.log(
                `[ws] Login connect not established after ${LOGIN_CONNECT_RETRY_DELAY_MS}ms, retrying direct websocket connect...`,
            );
            connectForLogin(state.lastUrl, true);
        }, LOGIN_CONNECT_RETRY_DELAY_MS);
        return;
    }

    clearLoginConnectRetryTimer();
    sendLoginPayload();
}

/**
 * Ask the server to drop a remembered-login token. Uses a short-lived socket of its own so it
 * works from the login screen whether or not the game socket is open. A WebRTC world has no
 * plain socket to reach, so its token is left to expire.
 */
export function forgetRememberedLogin(username: string, token: string): void {
    if (typeof WebSocket === "undefined" || state.webRtcConfig) return;
    let socket: WebSocket;
    try {
        socket = new WebSocket(state.lastUrl);
    } catch {
        return;
    }
    socket.binaryType = "arraybuffer";
    const closeTimer = setTimeout(() => socket.close(), 5000);
    socket.addEventListener("open", () => {
        socket.send(encodeClientMessage({ type: "login_forget", payload: { username, token } }) as any);
        // close() still delivers the queued packet before the closing handshake.
        socket.close(1000, "login forget");
        clearTimeout(closeTimer);
    });
    socket.addEventListener("error", () => clearTimeout(closeTimer));
}

/**
 * Send logout request to server.
 * Server will check if player can logout (not in combat, etc.) and respond.
 * If approved, server saves player state and closes connection.
 * Use subscribeLogoutResponse to handle the server's response.
 */
export function sendLogout(): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
        console.warn("[ws] Cannot send logout - state.socket not open");
        return;
    }
    send({ type: "logout", payload: {} });
}

/**
 * Suppress reconnection after server-approved logout.
 * Called by the client when logout is confirmed.
 */
export function suppressReconnection(): void {
    // Clear session credentials - user logged out intentionally
    state.sessionUsername = null;
    state.sessionPassword = null;
    state.sessionLoginFlags = 0;
    clearLoginConnectRetryTimer();
    try {
        const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
        g[WS_SUPPRESS_RECONNECT_KEY] = true;
        if (state.reconnectTimer) {
            clearTimeout(state.reconnectTimer);
            state.reconnectTimer = null;
        }
    } catch {}
}

/**
 * Manually send handshake (used after login success when state.autoSendHandshake is false).
 */
export function sendHandshake(name?: string): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
        console.warn("[ws] Cannot send handshake - state.socket not open");
        return;
    }
    const { prefersMobileGameframe } = require("../../common/utils/DeviceUtil");
    const clientType = prefersMobileGameframe() ? 1 : 0;
    send({
        type: "handshake",
        payload: { clientType, name: name || "Player" },
    });
}
