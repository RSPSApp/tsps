import { clearLoginConnectRetryTimer } from "../connection/loginHelpers";
import { resetProtocolCompatibility } from "../protocolCompatibility";
import { send } from "../connection/send";
import { getBrowserHostWorldConfig } from "../../../config/clientEnv";
import { state } from "../state";
import type { WebRtcConnectionConfig } from "../connection/GameSocket";
import { discoverRelayWorlds } from "../../../game/login/renderer/serverList";

export function sendTeleport(to: { x: number; y: number }, level?: number): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    send({ type: "teleport", payload: { to: { x: to.x | 0, y: to.y | 0 }, level } } as any);
}

export function isServerConnected(): boolean {
    return !!state.socket && state.socket.readyState === WebSocket.OPEN;
}

export function getLastUrl(): string {
    return state.lastUrl;
}

export function setServerUrl(url: string, webRtcConfig?: WebRtcConnectionConfig | null): void {
    // A world in the URL path (e.g. /play/browser-77xv4c) only applies when the
    // caller has not explicitly chosen a server, so the in-client world list can
    // still switch away from it.
    if (webRtcConfig === undefined) {
        const browserHostWorld = getBrowserHostWorldConfig();
        if (browserHostWorld) {
            url = browserHostWorld.signalUrl;
            webRtcConfig = browserHostWorld;
        }
    }
    applyServerUrl(url, webRtcConfig ?? undefined, false);
}

function applyServerUrl(url: string, config: WebRtcConnectionConfig | undefined, preserveLogin: boolean): void {
    const changed = state.lastUrl !== url
        || JSON.stringify(state.webRtcConfig) !== JSON.stringify(config);
    if (changed) {
        clearLoginConnectRetryTimer();
        if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
        state.isReconnecting = false;
        state.reconnectAttempts = 0;
        state.loginOnWelcome = null;
        state.lastWelcome = undefined;
        resetProtocolCompatibility();
        if (!preserveLogin) {
            state.loginConnectAttemptId++;
            state.sessionUsername = null;
            state.sessionPassword = null;
            state.sessionLoginFlags = 0;
            state.hasLoggedIn = false;
        }
    }
    if (changed && state.socket) {
        const previous = state.socket;
        state.socket = null;
        try { previous.close(1000, "server change"); } catch {}
    }
    state.lastUrl = url;
    state.webRtcConfig = config;
}

/** Resolve deep links and saved WebRTC choices before any ICE/TURN request. */
export async function resolveServerTransport(): Promise<boolean> {
    const config = state.webRtcConfig;
    const url = state.lastUrl;
    if (!config) return true;
    const worlds = await discoverRelayWorlds(config);
    if (state.webRtcConfig !== config || state.lastUrl !== url) return false;
    const world = worlds.find((entry) => entry.worldId === config.worldId);
    if (world?.transport === "websocket") {
        applyServerUrl(`${world.secure ? "wss" : "ws"}://${world.address}`, undefined, true);
    }
    return true;
}
