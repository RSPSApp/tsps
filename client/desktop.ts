/** Called after the desktop game's cache and renderer have initialized. */
export async function notifyDesktopAppReady(): Promise<void> {
    if (typeof window === "undefined" || !window.__RSPS_DESKTOP_PROFILE__) return;
    try {
        await window.__TAURI__?.core.invoke("plugin:hot-update|notify_app_ready");
    } catch (error) {
        console.warn("Could not confirm client startup", error);
    }
}

export type DesktopWorld = Pick<import("./config/clientEnv").ConfiguredServer,
    "address" | "secure" | "transport" | "signalUrl" | "worldId" | "iceServers">;

export async function requiredDesktopClientVersion(world: DesktopWorld): Promise<string> {
    const signal = AbortSignal.timeout(10000);
    let metadata: any;
    if (world.transport === "webrtc") {
        if (!world.signalUrl || !world.worldId) throw new Error("Hosted world connection is incomplete");
        const { WebRtcGameSocket } = await import("./network/serverConnection/connection/WebRtcGameSocket");
        signal.throwIfAborted();
        const socket = new WebRtcGameSocket({ signalUrl: world.signalUrl, worldId: world.worldId, iceServers: world.iceServers ?? [] });
        const close = () => socket.close();
        signal.addEventListener("abort", close, { once: true });
        try { metadata = await socket.fetchContent("/api/world-info"); }
        finally { signal.removeEventListener("abort", close); close(); }
    } else {
        const url = new URL(`${world.secure ? "https" : "http"}://${world.address}`);
        url.pathname = "/api/world-info"; url.search = ""; url.hash = "";
        const response = await fetch(url, { signal, cache: "no-store" });
        if (!response.ok) throw new Error("Could not check this world's required client version");
        metadata = await response.json();
    }
    if (typeof metadata?.clientVersion !== "string" || !/^[a-f0-9]{64}$/.test(metadata.clientVersion)) {
        throw new Error("This world does not advertise a supported desktop client version. Update the world before using the desktop client.");
    }
    return metadata.clientVersion;
}

export async function desktopClientManifestUrl(world: DesktopWorld): Promise<string> {
    const version = await requiredDesktopClientVersion(world);
    return `https://github.com/RSPSApp/tsps/releases/download/client-${version}/manifest.json`;
}

let runningVersion: Promise<string> | undefined;
export async function assertDesktopWorldCompatible(world: DesktopWorld): Promise<void> {
    if (typeof window === "undefined" || !window.__RSPS_DESKTOP_PROFILE__) return;
    runningVersion ??= fetch(`${(process.env.PUBLIC_URL ?? "").replace(/\/$/, "")}/client-release.json`, { cache: "no-store" })
        .then(async response => {
            if (!response.ok) throw new Error("This desktop client is missing its release information");
            const metadata = await response.json();
            if (typeof metadata?.clientVersion !== "string" || !/^[a-f0-9]{64}$/.test(metadata.clientVersion)) throw new Error("Invalid desktop client release information");
            return metadata.clientVersion;
        });
    const [required, running] = await Promise.all([requiredDesktopClientVersion(world), runningVersion]);
    if (required !== running) throw new Error("This world requires a different client version. Open its matching downloadable client to play.");
}
