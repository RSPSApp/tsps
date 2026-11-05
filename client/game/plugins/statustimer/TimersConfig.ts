import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

export const TimersConfig = ConfigGroup("timers", {
    showAttackTimer: ConfigItem({
        name: "Overhead combat timer",
        description: "Show ticks until your next attack above your player.",
        position: 0,
        default: false,
    }),
});
