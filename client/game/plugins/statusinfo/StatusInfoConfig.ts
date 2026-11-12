import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

/** The game view corner the boxes sit in; other overlays in the same corner stack beside them. */
export enum StatusInfoPosition {
    TOP_LEFT = "TOP_LEFT",
    TOP_RIGHT = "TOP_RIGHT",
    BOTTOM_LEFT = "BOTTOM_LEFT",
    BOTTOM_RIGHT = "BOTTOM_RIGHT",
}

export const StatusInfoConfig = ConfigGroup("statusinfo", {
    position: ConfigItem<StatusInfoPosition>({
        name: "Position",
        description:
            "The corner of the game view the boxes sit in. Top left goes below Opponent Information, " +
            "top right below the minimap, bottom left above the chatbox (beside the Slayer Tracker), " +
            "bottom right above the inventory. Hold Alt and drag them to move them elsewhere.",
        position: 0,
        enum: StatusInfoPosition,
        default: StatusInfoPosition.TOP_RIGHT,
    }),
    scale: ConfigItem({
        name: "Scale",
        description: "The size of the boxes and their numbers, in percent (100 is the game's own buff bar size).",
        position: 1,
        range: { min: 50, max: 400 },
        units: "%",
        default: 100,
    }),
    showTimers: ConfigItem({
        name: "Timers",
        description:
            "Poison, freeze, antifire, teleblock, stamina and vengeance, and the server's other timed effects " +
            "(divine and other timed potions, the imbued heart, hunter meat's second heal...).",
        position: 2,
        default: true,
    }),
    showAttackTimer: ConfigItem({
        name: "Attack timer",
        description: "The ticks until your next attack, while it counts down.",
        position: 3,
        default: true,
    }),
    showBoosts: ConfigItem({
        name: "Stat boosts",
        description:
            "A box for each boosted stat, with its boosted level. The bars beside it show the time to the " +
            "next stat restore (red) and how much of the boost is left, out of the most it reached (green).",
        position: 4,
        default: true,
    }),
    showAmmo: ConfigItem({
        name: "Ammo remaining",
        description: "A box with the ammunition you have equipped and how much is left (thrown weapons too).",
        position: 5,
        default: true,
    }),
});
