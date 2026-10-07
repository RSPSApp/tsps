import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";

/** Shows the ticks until the local player's next attack over their head (attackTimerState). */
export class AttackTimerPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Attack Timer",
        description: "Shows the ticks until your next attack over your head.",
        tags: ["combat"],
        enabledByDefault: false,
        configKey: "attacktimerplugin",
    };
}
