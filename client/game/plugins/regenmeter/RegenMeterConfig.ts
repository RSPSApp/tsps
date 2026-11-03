import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

/** RuneLite 1.13.5 RegenMeterConfig: group, keys, names and defaults as in RuneLite. */
export const RegenMeterConfig = ConfigGroup("regenmeter", {
    showHitpoints: ConfigItem({
        name: "Show hitpoints regen",
        description: "Show a ring around the hitpoints orb.",
        default: true,
    }),
    showSpecial: ConfigItem({
        name: "Show spec. attack regen",
        description: "Show a ring around the special attack orb.",
        default: true,
    }),
    showWhenNoChange: ConfigItem({
        name: "Show at full hitpoints",
        description: "Always show the hitpoints regen orb, even if there will be no stat change.",
        default: false,
    }),
    getNotifyBeforeHpRegenSeconds: ConfigItem({
        keyName: "notifyBeforeHpRegenDuration",
        name: "Hitpoint notification",
        description: "Notify approximately when your next hitpoint is about to regen. A value of 0 will disable notification.",
        units: "s",
        default: 0,
    }),
});
