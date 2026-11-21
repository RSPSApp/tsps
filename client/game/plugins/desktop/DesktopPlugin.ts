import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { getDesktopProfile } from "../../../config/clientEnv";

export class DesktopPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Desktop",
        hidden: true,
        required: true,
        configKey: "desktopplugin",
    };

    async clientReady(signal: AbortSignal): Promise<void> {
        if (!getDesktopProfile()) return;
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
