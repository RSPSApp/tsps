import { PlayerSyncContext } from "../../../game/sync/PlayerSyncContext";
import { PlayerUpdateDecoder } from "../../../game/sync/PlayerUpdateDecoder";
import { setPacketSocket } from "../../packet";
import { DEFAULT_URL, WS_GLOBAL_KEY, WS_SUPPRESS_RECONNECT_KEY, getEnv } from "../constants";
import { processServerMessage } from "../handlers/dispatch";
import { state } from "../state";
import { clearLoginConnectRetryTimer } from "./loginHelpers";
import { initSocketCloseHandler } from "./closeHandler";
import type { GameSocket } from "./GameSocket";
import { send } from "./send";
import { WebRtcGameSocket } from "./WebRtcGameSocket";
import { CustomItemRegistry } from "../../../custom/items/CustomItemRegistry";
import { CustomModelRegistry } from "../../../custom/items/CustomModelRegistry";

export function initServerConnection(url: string = DEFAULT_URL): void {
    state.lastUrl = url;
    // On HMR refresh, proactively close any previous live state.socket stored globally
    try {
        const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
        const existing: GameSocket | null | undefined = g[WS_GLOBAL_KEY];
        // If a prior cycle marked suppression (HMR), respect it until re-init is called
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _sup: boolean = !!g[WS_SUPPRESS_RECONNECT_KEY];
        if (
            existing &&
            (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)
        ) {
            try {
                existing.close(1000, "refresh");
            } catch {}
        }
    } catch {}

    if (
        state.socket &&
        (state.socket.readyState === WebSocket.OPEN || state.socket.readyState === WebSocket.CONNECTING)
    )
        return;

    try {
        CustomItemRegistry.clear();
        CustomModelRegistry.clear();
        state.playerSyncContext = new PlayerSyncContext();
        state.playerUpdateDecoder = new PlayerUpdateDecoder();
        state.socket = state.webRtcConfig
            ? new WebRtcGameSocket(state.webRtcConfig)
            : new WebSocket(url);
        const ws = state.socket;
        try {
            ws.binaryType = "arraybuffer";
        } catch {}

        ws.addEventListener("open", () => {
            if (state.socket !== ws) return;

            // Capture reconnecting state before resetting
            const wasReconnecting = state.isReconnecting;
            // Reset reconnect backoff, attempts counter, and clear any timers
            try {
                if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
            } catch {}
            state.reconnectTimer = null;
            state.reconnectDelayMs = 250;
            state.reconnectAttempts = 0;
            state.isReconnecting = false;
            clearLoginConnectRetryTimer();
            try {
                const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
                g[WS_SUPPRESS_RECONNECT_KEY] = false;
            } catch {}
            // Wire up the packet writer for binary protocol
            setPacketSocket(ws);
            send({
                type: "hello",
                payload: { client: "osrs-typescript", version: getEnv("REACT_APP_VERSION") },
            });

            // If reconnecting with stored credentials, automatically re-login
            if (wasReconnecting && state.sessionUsername && state.sessionPassword) {
                console.log("[ws] Reconnected - attempting session resumption...");
                send({
                    type: "login",
                    payload: {
                        username: state.sessionUsername,
                        password: state.sessionPassword,
                        revision: state.sessionRevision,
                    },
                } as any);
            }
            // Only auto-send handshake if flag is set (for backwards compatibility)
            // When using login screen, handshake should be sent after login success
            else if (state.autoSendHandshake) {
                // Send handshake request with client type (mobile=1, desktop=0)
                // Server uses this to decide which root interface to send (601 mobile, 161 desktop)
                // isMobileMode combines actual touch detection + ?mobile=1 URL param override
                const { isMobileMode } = require("../../../common/utils/DeviceUtil");
                const clientType = isMobileMode ? 1 : 0;
                // Send a default name so chat scripts work (server echoes it back)
                send({ type: "handshake", payload: { clientType, name: "Player" } });
            }
            // eslint-disable-next-line no-console
            console.log(`[ws] connected to ${url}`);
            // Track as global singleton so subsequent refreshes can close it before re-init
            try {
                const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
                g[WS_GLOBAL_KEY] = ws;
            } catch {}
        });

        ws.addEventListener("message", (evt) => {
            if (state.socket !== ws) return;

            try {
                const raw = (evt as MessageEvent).data;
                let messages: any[] = [];

                // Handle binary packets (ArrayBuffer) or JSON strings
                if (raw instanceof ArrayBuffer) {
                    // Binary protocol - may contain batched packets
                    const { decodeBatchedServerPackets } = require("../../packet/ServerBinaryDecoder");
                    const { messages: decoded, stalled } = decodeBatchedServerPackets(raw);
                    if (stalled) {
                        // Stream desynced (client/server packet tables out of lockstep,
                        // or a corrupted frame). Keeping the socket open leaves every
                        // later batch corrupt, so force a reconnect: the close handler
                        // re-auths and the server resends full state on login.
                        // 4002 = private-use code; unlike 4000 it still reconnects.
                        // eslint-disable-next-line no-console
                        console.error("[ws] server packet stream stalled; forcing reconnect to resync");
                        try {
                            ws.close(4002, "packet stream desync");
                        } catch {}
                        return;
                    }
                    if (!decoded || decoded.length === 0) {
                        console.warn("[ws] Failed to decode binary packet(s)");
                        return;
                    }
                    messages = decoded;
                } else if (typeof raw === "string") {
                    // JSON protocol (legacy/fallback)
                    messages = [JSON.parse(raw) as any];
                } else {
                    return;
                }

                // Process all messages (may be multiple from batching)
                for (const msg of messages) {
                    processServerMessage(msg);
                }
            } catch (e) {
                // eslint-disable-next-line no-console
                console.warn("[ws] parse error:", e);
            }
        });

        // Set up close handler
        initSocketCloseHandler(ws, initServerConnection);

        // Set up error handler
        ws.addEventListener("error", (e) => {
            if (state.socket !== ws) return;
            // eslint-disable-next-line no-console
            console.warn("[ws] error", e);
        });

        // Close gracefully before page reload/navigation
        try {
            if (typeof window !== "undefined") {
                const onBeforeUnload = () => {
                    try {
                        const g: any = window as any;
                        g[WS_SUPPRESS_RECONNECT_KEY] = true;
                        state.socket?.close(1000, "page unload");
                    } catch {}
                };
                // Attach once per page lifetime using a global guard
                const g: any = window as any;
                if (!g.__OSRS_CLIENT_WS_UNLOAD_BOUND__) {
                    window.addEventListener("beforeunload", onBeforeUnload);
                    g.__OSRS_CLIENT_WS_UNLOAD_BOUND__ = true;
                }
            }
        } catch {}
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("Failed to create WebSocket:", e);
        return;
    }
}
