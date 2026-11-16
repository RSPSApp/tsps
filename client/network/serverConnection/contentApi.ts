import { state } from "./state";
import { WebRtcGameSocket } from "./connection/WebRtcGameSocket";
import { resolveServerTransport } from "./outgoing/connectionInfo";

/**
 * Base URL for the game server's read-only JSON endpoints. They are served by the same
 * process and port as the game socket, so the address is derived from the live connection
 * rather than configured separately.
 */
export function getContentApiBase(): string | undefined {
    if (state.webRtcConfig) {
        return undefined;
    }
    const url = state.lastUrl;
    if (typeof url !== "string" || url.length === 0) {
        return undefined;
    }
    try {
        const parsed = new URL(url);
        parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
        parsed.pathname = "";
        parsed.search = "";
        parsed.hash = "";
        return parsed.toString().replace(/\/$/, "");
    } catch {
        return undefined;
    }
}

/** Read the same server resources over HTTP or the browser world's content channel. */
export async function fetchContent(path: string): Promise<any> {
    if (state.webRtcConfig) {
        if (!state.socket?.fetchContent) throw new Error("World content connection is unavailable");
        return state.socket.fetchContent(path);
    }
    const base = getContentApiBase();
    if (!base) throw new Error("World content connection is unavailable");
    const response = await fetch(`${base}${path}`);
    if (!response.ok) throw new Error(`Content request failed: ${response.status}`);
    return response.json();
}

/** Login art is available from the selected world before an authenticated game session. */
type LoginScreenAppearance = { jpg?: string; showFlames?: boolean; showLogo?: boolean };

export async function fetchLoginScreenAppearance(signal: AbortSignal): Promise<LoginScreenAppearance | undefined> {
    const path = "/api/login-screen";
    if (!await resolveServerTransport() || signal.aborted) return;
    if (state.webRtcConfig) {
        const socket = new WebRtcGameSocket(state.webRtcConfig);
        const close = () => socket.close();
        signal.addEventListener("abort", close, { once: true });
        try {
            return await socket.fetchContent(path) as LoginScreenAppearance;
        } finally {
            signal.removeEventListener("abort", close);
            close();
        }
    }
    const base = getContentApiBase();
    if (!base) return;
    const response = await fetch(base + path, { signal, cache: "no-cache" });
    if (response.ok) return response.json();
}

/** Prefer the connected world's definition; static files support older browser hosts. */
export async function fetchInterfaceDefinition(groupId: number): Promise<any | undefined> {
    try {
        return await fetchContent(`/api/interfaces/${groupId | 0}`);
    } catch (error) {
        console.warn("[content-api] live interface fetch failed; trying static definition", error);
    }
    const publicUrl = (process.env.PUBLIC_URL ?? "").replace(/\/$/, "");
    const urls = [
        // Browser-host definitions are deployed as static files. A timestamp avoids a
        // stale CDN entry from a prior deployment being treated as a valid 200 response.
        `${publicUrl}/browser-host/interfaces/${groupId | 0}.json?v=${Date.now()}`,
    ];
    for (const url of urls) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                if (response.status !== 404) console.warn(`[content-api] ${url} -> ${response.status}`);
                continue;
            }
            const definition = await response.json();
            console.log(
                `[content-api] loaded interface ${groupId} (${
                    Array.isArray(definition?.widgets) ? definition.widgets.length : 0
                } widgets)`,
            );
            return definition;
        } catch (error) {
            console.warn(`[content-api] ${url} failed`, error);
        }
    }
    return undefined;
}
