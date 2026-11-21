import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { getDesktopProfile } from "../../../config/clientEnv";
import { assertDesktopWorldCompatible, notifyDesktopAppReady, type DesktopWorld } from "./desktop";

export class DesktopPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Desktop",
        hidden: true,
        required: true,
        configKey: "desktopplugin",
    };

    async beforeWorldConnect(world: DesktopWorld): Promise<void> {
        await assertDesktopWorldCompatible(world);
    }

    async clientReady(signal: AbortSignal): Promise<void> {
        const profile = getDesktopProfile();
        if (!profile) return;
        await assertDesktopWorldCompatible(profile);
        // A successfully initialized frame must reach the screen before accepting an update.
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        if (!signal.aborted) await notifyDesktopAppReady();
    }
}
