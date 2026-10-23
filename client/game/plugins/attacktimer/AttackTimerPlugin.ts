import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import type { WebGLOsrsRendererHost } from "../../../render/render/hostInterface";
import type { OverheadTextEntry } from "../../../ui/devoverlay/Overlay";
import { appendAttackTimerOverhead } from "./AttackTimerOverhead";

/** Shows the ticks until the local player's next attack over their head (attackTimerState). */
export class AttackTimerPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Attack Timer",
        description: "Shows the ticks until your next attack over your head.",
        tags: ["combat"],
        enabledByDefault: false,
        configKey: "attacktimerplugin",
    };

    appendLocalPlayerOverheads(
        host: WebGLOsrsRendererHost,
        index: number | undefined,
        output: OverheadTextEntry[],
        maxEntries: number,
        playerDefaultHeightTiles: number | undefined,
    ): void {
        if (this.isEnabled()) appendAttackTimerOverhead(host, index, output, maxEntries, playerDefaultHeightTiles);
    }
}
