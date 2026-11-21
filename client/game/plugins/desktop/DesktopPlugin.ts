import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { getDesktopProfile, type ConfiguredServer } from "../../../config/clientEnv";

export class DesktopPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Desktop",
        hidden: true,
        required: true,
        configKey: "desktopplugin",
    };

    private runningVersion?: Promise<string>;

    async beforeWorldConnect(world: DesktopWorld): Promise<void> {
        if (!getDesktopProfile()) return;
        this.runningVersion ??= this.loadRunningVersion();
        const [required, running] = await Promise.all([getWorldClientVersion(world), this.runningVersion]);
        if (required !== running) {
            throw new Error("This world requires a different client version. Open its matching downloadable client to play.");
        }
    }

    private async loadRunningVersion(): Promise<string> {
        const publicUrl = (process.env.PUBLIC_URL ?? "").replace(/\/$/, "");
        const response = await fetch(`${publicUrl}/client-release.json`, { cache: "no-store" });
        if (!response.ok) throw new Error("This desktop client is missing its release information");
        const version = readClientVersion(await response.json());
        if (!version) throw new Error("Invalid desktop client release information");
        return version;
    }

    async clientReady(signal: AbortSignal): Promise<void> {
        const profile = getDesktopProfile();
        if (!profile) return;
        await this.beforeWorldConnect(profile);
        // A successfully initialized frame must reach the screen before accepting an update.
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        if (signal.aborted) return;
        try {
            await window.__TAURI__?.core.invoke("plugin:hot-update|notify_app_ready");
        } catch (error) {
            console.warn("Could not confirm client startup", error);
        }
    }
}

export type DesktopWorld = Omit<ConfiguredServer, "name" | "maxPlayers">;

async function getWorldClientVersion(world: DesktopWorld): Promise<string> {
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
    const version = await getWorldClientVersion(world);
    return `https://github.com/RSPSApp/tsps/releases/download/client-${version}/manifest.json`;
}

function readClientVersion(metadata: unknown): string | undefined {
    if (!metadata || typeof metadata !== "object" || !("clientVersion" in metadata)) return;
    const version = metadata.clientVersion;
    return typeof version === "string" && /^[a-f0-9]{64}$/.test(version) ? version : undefined;
}
