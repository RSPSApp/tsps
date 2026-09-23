import { send } from "../connection/send";
import { getBrowserHostWorldConfig } from "../../../config/clientEnv";
import { state } from "../state";
import type { WebRtcConnectionConfig } from "../connection/GameSocket";

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

export function setServerUrl(url: string, webRtcConfig?: WebRtcConnectionConfig): void {
    // A world in the URL path (e.g. /play/browser-77xv4c) only applies when the
    // caller has not explicitly chosen a server, so the in-client world list can
    // still switch away from it.
    if (!webRtcConfig) {
        const browserHostWorld = getBrowserHostWorldConfig();
        if (browserHostWorld) {
            url = browserHostWorld.signalUrl;
            webRtcConfig = browserHostWorld;
        }
    }
    const changed = state.lastUrl !== url
        || JSON.stringify(state.webRtcConfig) !== JSON.stringify(webRtcConfig);
    if (changed && state.socket) {
        const previous = state.socket;
        state.socket = null;
        try { previous.close(1000, "server change"); } catch {}
    }
    state.lastUrl = url;
    state.webRtcConfig = webRtcConfig;
}
