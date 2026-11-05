import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

export const TimersConfig = ConfigGroup("timers", {
    showAttackTimer: ConfigItem({
        name: "Attack timer overhead",
        description: "Show the attack countdown above your player instead of in a timer box.",
        position: 0,
        default: false,
    }),
});
