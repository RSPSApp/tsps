import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

export enum DisplayChangeMode {
    ALWAYS = "ALWAYS",
    BOOSTED = "BOOSTED",
    NEVER = "NEVER",
}

export enum DisplayBoosts {
    NONE = "NONE",
    COMBAT = "COMBAT",
    NON_COMBAT = "NON_COMBAT",
    BOTH = "BOTH",
}

/**
 * RuneLite 1.13.5 BoostsConfig: group, keys, names and defaults as in RuneLite. Its
 * Notification item is an on/off switch here.
 */
export const BoostsConfig = ConfigGroup("boosts", {
    displayBoosts: ConfigItem<DisplayBoosts>({
        name: "Display boosts",
        description: "Configures which skill boosts to display.",
        position: 1,
        enum: DisplayBoosts,
        default: DisplayBoosts.COMBAT,
    }),
    useRelativeBoost: ConfigItem({
        keyName: "relativeBoost",
        name: "Show relative boosts",
        description: "Configures whether or not relative boost is used.",
        position: 2,
        default: false,
    }),
    displayInfoboxes: ConfigItem({
        keyName: "displayIndicators",
        name: "Display infoboxes",
        description: "Configures whether to display boost infoboxes.",
        position: 3,
        default: true,
    }),
    displayPanel: ConfigItem({
        name: "Display panel",
        description: "Configures whether to display the boost panel.",
        position: 3,
        default: false,
    }),
    compactDisplay: ConfigItem({
        name: "Compact display",
        description: "Displays skill boosts in a more compact panel.",
        position: 4,
        default: false,
    }),
    displayNextBuffChange: ConfigItem<DisplayChangeMode>({
        name: "Next buff change",
        description: "Configures whether or not to display when the next buffed stat change will be.",
        position: 10,
        enum: DisplayChangeMode,
        default: DisplayChangeMode.BOOSTED,
    }),
    displayNextDebuffChange: ConfigItem<DisplayChangeMode>({
        name: "Next debuff change",
        description: "Configures whether or not to display when the next debuffed stat change will be.",
        position: 11,
        enum: DisplayChangeMode,
        default: DisplayChangeMode.NEVER,
    }),
    boostThreshold: ConfigItem({
        name: "Boost threshold",
        description:
            "Number of levels above your base level at which boosted levels will be displayed in a different color.",
        position: 12,
        default: 0,
    }),
    notifyOnBoost: ConfigItem({
        name: "Notify on boost threshold",
        description: "Configures whether or not a notification will be sent when boosted stats drain to the boost threshold.",
        position: 13,
        default: false,
    }),
});
