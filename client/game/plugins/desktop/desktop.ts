import { getDesktopProfile } from "../../../config/clientEnv";
import type { ConfiguredServer } from "../../../config/clientEnv";

/** Called after the desktop game's cache and renderer have initialized. */
export async function notifyDesktopAppReady(): Promise<void> {
    if (!getDesktopProfile()) return;
    try {
        await window.__TAURI__?.core.invoke("plugin:hot-update|notify_app_ready");
    } catch (error) {
        console.warn("Could not confirm client startup", error);
    }
}

export type DesktopWorld = Omit<ConfiguredServer, "name" | "maxPlayers">;

export async function requiredDesktopClientVersion(world: DesktopWorld): Promise<string> {
    const signal = AbortSignal.timeout(10000);
    let metadata: unknown;
    if (world.transport === "webrtc") {
        if (!world.signalUrl || !world.worldId) {
            throw new Error("Hosted world connection is incomplete");
        }
        const { WebRtcGameSocket } = await import("../../../network/serverConnection/connection/WebRtcGameSocket");
        signal.throwIfAborted();
        const socket = new WebRtcGameSocket({
            signalUrl: world.signalUrl,
            worldId: world.worldId,
            iceServers: world.iceServers ?? [],
        });
        const close = () => socket.close();
        signal.addEventListener("abort", close, { once: true });
        try {
            metadata = await socket.fetchContent("/api/world-info");
        } finally {
            signal.removeEventListener("abort", close);
            close();
        }
    } else {
        const url = new URL(`${world.secure ? "https" : "http"}://${world.address}`);
        url.pathname = "/api/world-info";
        url.search = "";
        url.hash = "";
        const response = await fetch(url, { signal, cache: "no-store" });
        if (!response.ok) {
            throw new Error("Could not check this world's required client version");
        }
        metadata = await response.json();
    }
    const version = readClientVersion(metadata);
    if (!version) {
        throw new Error("This world does not advertise a supported desktop client version. Update the world before using the desktop client.");
    }
    return version;
}

export async function desktopClientManifestUrl(world: DesktopWorld): Promise<string> {
    const version = await requiredDesktopClientVersion(world);
    return `https://github.com/RSPSApp/tsps/releases/download/client-${version}/manifest.json`;
}

function readClientVersion(metadata: unknown): string | undefined {
    if (!metadata || typeof metadata !== "object" || !("clientVersion" in metadata)) return;
    const version = metadata.clientVersion;
    return typeof version === "string" && /^[a-f0-9]{64}$/.test(version) ? version : undefined;
}

async function loadRunningVersion(): Promise<string> {
    const publicUrl = (process.env.PUBLIC_URL ?? "").replace(/\/$/, "");
    const response = await fetch(`${publicUrl}/client-release.json`, { cache: "no-store" });
    if (!response.ok) throw new Error("This desktop client is missing its release information");
    const version = readClientVersion(await response.json());
    if (!version) throw new Error("Invalid desktop client release information");
    return version;
}

let runningVersion: Promise<string> | undefined;

export async function assertDesktopWorldCompatible(world: DesktopWorld): Promise<void> {
    if (!getDesktopProfile()) return;
    runningVersion ??= loadRunningVersion();
    const [required, running] = await Promise.all([requiredDesktopClientVersion(world), runningVersion]);
    if (required !== running) {
        throw new Error("This world requires a different client version. Open its matching downloadable client to play.");
    }
}
