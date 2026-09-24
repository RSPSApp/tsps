/**
 * Build-time client config from CRA `REACT_APP_*` env vars.
 * IMPORTANT: CRA only inlines env vars referenced as static property access
 * (`process.env.REACT_APP_FOO`). Dynamic `process.env[key]` is left undefined.
 */

function read(value: string | undefined): string | undefined {
    // Strip BOM + whitespace; Windows/PowerShell env writes often include U+FEFF.
    const trimmed = value?.replace(/^\uFEFF/, "").trim();
    return trimmed ? trimmed : undefined;
}

export type ConfiguredServer = {
    name: string;
    address: string;
    secure: boolean;
    maxPlayers: number;
    transport?: "websocket" | "webrtc";
    signalUrl?: string;
    worldId?: string;
    iceServers?: RTCIceServer[];
};

export type WebRtcRelayConfig = {
    signalUrl: string;
    iceServers: RTCIceServer[];
};

export type BrowserHostWorldConfig = WebRtcRelayConfig & { worldId: string };

const DEFAULT_WEBRTC_SIGNAL_URL = "wss://worlds.rsps.app";
const DEFAULT_WEBRTC_ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.rsps.app:3478" }];

function readBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true" || normalized === "1") return true;
        if (normalized === "false" || normalized === "0") return false;
    }
    return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isIceServer(value: unknown): value is RTCIceServer {
    if (!isRecord(value)) return false;
    return typeof value.urls === "string"
        || (Array.isArray(value.urls) && value.urls.every((url) => typeof url === "string"));
}

/** Base URL for OSRS cache files. Trailing slash always present. */
export function getCacheBaseUrl(): string {
    const fromEnv = read(process.env.REACT_APP_CACHE_BASE_URL);
    if (!fromEnv) {
        const publicUrl = (process.env.PUBLIC_URL ?? "").replace(/\/$/, "");
        return `${publicUrl}/caches/`;
    }
    return fromEnv.endsWith("/") ? fromEnv : `${fromEnv}/`;
}

/** Default WebSocket URL used before the player picks a server. */
export function getDefaultWsUrl(): string {
    return read(process.env.REACT_APP_DEFAULT_WS_URL) ?? "ws://localhost:43594";
}

export function getDefaultServerAddress(): string {
    return read(process.env.REACT_APP_DEFAULT_SERVER_ADDRESS) ?? "localhost:43594";
}

export function getDefaultServerName(): string {
    return read(process.env.REACT_APP_DEFAULT_SERVER_NAME) ?? "Local Development";
}

export function getDefaultServerSecure(): boolean {
    const raw = read(process.env.REACT_APP_DEFAULT_SERVER_SECURE)?.toLowerCase();
    if (raw === "true" || raw === "1") return true;
    if (raw === "false" || raw === "0") return false;
    return getDefaultWsUrl().startsWith("wss://");
}

/**
 * Optional full server list baked in at build time (JSON array).
 * When set, this takes precedence over fetching `/servers.json`.
 */
export function getConfiguredServers(): ConfiguredServer[] | undefined {
    const raw = read(process.env.REACT_APP_SERVERS_JSON);
    if (!raw) return undefined;
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return undefined;
        return parsed.map((entry): ConfiguredServer => {
            const server = isRecord(entry) ? entry : {};
            const transport = server.transport === "webrtc" ? "webrtc" : "websocket";
            const signalUrl = typeof server.signalUrl === "string" ? server.signalUrl : undefined;
            return {
                name: typeof server.name === "string" ? server.name : "Server",
                address:
                    typeof server.address === "string"
                        ? server.address
                        : transport === "webrtc" && signalUrl
                          ? new URL(signalUrl).host
                          : "localhost:43594",
                secure: readBoolean(server.secure, false),
                maxPlayers: typeof server.maxPlayers === "number" ? server.maxPlayers : 2047,
                transport,
                signalUrl,
                worldId: typeof server.worldId === "string" ? server.worldId : undefined,
                iceServers: Array.isArray(server.iceServers)
                    ? server.iceServers.filter(isIceServer)
                    : [],
            };
        });
    } catch {
        console.warn("[clientEnv] Failed to parse REACT_APP_SERVERS_JSON");
        return undefined;
    }
}

/** Public relay directory used to discover WebRTC worlds. */
export function getPublicWebRtcRelayConfig(): WebRtcRelayConfig {
    return { signalUrl: DEFAULT_WEBRTC_SIGNAL_URL, iceServers: DEFAULT_WEBRTC_ICE_SERVERS };
}

let iceCache: { signalUrl: string; iceServers: RTCIceServer[]; expiresAt: number } | undefined;

// Set after a direct (non-relay) WebRTC connection fails, so the next attempt
// forces TURN (iceTransportPolicy: "relay") for clients behind symmetric NAT.
let relayFallbackPreferred = false;

export function preferWebRtcRelay(): void {
    relayFallbackPreferred = true;
}

export function shouldPreferWebRtcRelay(): boolean {
    return relayFallbackPreferred;
}

/**
 * ICE servers for connecting to a relay, including short-lived TURN credentials
 * fetched from the relay's `/turn` endpoint. Falls back to `fallback` (STUN)
 * when TURN is unavailable, so P2P still works on non-symmetric NATs.
 */
export async function resolveIceServers(signalUrl: string, fallback: RTCIceServer[]): Promise<RTCIceServer[]> {
    const now = Date.now();
    if (iceCache && iceCache.signalUrl === signalUrl && iceCache.expiresAt > now + 30_000) {
        return iceCache.iceServers;
    }
    try {
        const url = new URL(signalUrl);
        url.protocol = url.protocol === "wss:" ? "https:" : "http:";
        url.pathname = "/turn";
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (response.ok) {
            const data = await response.json();
            const iceServers = Array.isArray(data?.iceServers) ? data.iceServers.filter(isIceServer) : [];
            if (iceServers.length > 0) {
                const ttlSeconds = Number.isFinite(data?.ttlSeconds) ? data.ttlSeconds : 0;
                iceCache = { signalUrl, iceServers, expiresAt: now + Math.max(60, ttlSeconds) * 1000 };
                return iceServers;
            }
        }
    } catch {
        // TURN is optional; fall back to the configured ICE servers.
    }
    return fallback;
}

// The live client is mounted at /play (package.json homepage). The dev server is
// served from the root (PUBLIC_URL "/"), but host links still carry the /play mount.
const WORLD_PATH_MOUNT = "/play";

/** Strip the app mount from a pathname, then take the next segment as the world id. */
export function parseWorldIdFromPath(pathname: string, publicUrl: string): string | undefined {
    const base = publicUrl.replace(/\/+$/, "");
    let path = pathname;
    const mount = base || WORLD_PATH_MOUNT;
    if (path === mount) path = "/";
    else if (path.startsWith(`${mount}/`)) path = path.slice(mount.length);
    const segment = path.replace(/^\/+/, "").split("/")[0];
    return segment && /^[A-Za-z0-9._-]{1,64}$/.test(segment) ? segment : undefined;
}

/** World id from the URL path, e.g. /play/world-1 -> "world-1". */
function worldIdFromPath(): string | undefined {
    if (typeof window === "undefined") return undefined;
    return parseWorldIdFromPath(window.location.pathname ?? "", process.env.PUBLIC_URL ?? "");
}

/**
 * True when the client was launched by a browser host (the /host page) and may
 * use the host control channel. Signalled by `browser-host-origin`, with the
 * legacy `browser-host-client=1` still accepted.
 */
export function isBrowserHostClient(): boolean {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    return params.get("browser-host-client") === "1" || params.has("browser-host-origin");
}

export function getBrowserHostWorldConfig(): BrowserHostWorldConfig | undefined {
    if (typeof window === "undefined") return undefined;
    const params = new URLSearchParams(window.location.search);
    const worldId = worldIdFromPath() ?? params.get("browser-host-world");
    if (!worldId || !/^[A-Za-z0-9._-]{1,64}$/.test(worldId)) return undefined;
    return { ...getPublicWebRtcRelayConfig(), worldId };
}

/** Public relay directory used to discover WebRTC worlds. */
export function getWebRtcRelayConfig(): WebRtcRelayConfig | undefined {
    if (typeof window !== "undefined" && (isBrowserHostClient() || worldIdFromPath())) {
        return getPublicWebRtcRelayConfig();
    }

    const signalUrl = read(process.env.REACT_APP_WEBRTC_SIGNAL_URL) ?? DEFAULT_WEBRTC_SIGNAL_URL;

    const rawIceServers = read(process.env.REACT_APP_WEBRTC_ICE_SERVERS);
    if (!rawIceServers) return { signalUrl, iceServers: DEFAULT_WEBRTC_ICE_SERVERS };
    try {
        const parsed = JSON.parse(rawIceServers);
        return {
            signalUrl,
            iceServers: Array.isArray(parsed) ? parsed.filter(isIceServer) : [],
        };
    } catch {
        console.warn("[clientEnv] Failed to parse REACT_APP_WEBRTC_ICE_SERVERS");
        return { signalUrl, iceServers: DEFAULT_WEBRTC_ICE_SERVERS };
    }
}

/** Optional override for the remote server-list URL. */
export function getServerListUrl(): string {
    const publicUrl = (process.env.PUBLIC_URL ?? "").replace(/\/$/, "");
    return (
        read(process.env.REACT_APP_SERVER_LIST_URL) ??
        `${publicUrl}/servers.json`
    );
}
