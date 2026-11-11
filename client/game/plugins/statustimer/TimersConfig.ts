import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

/** The game view corner the timers sit in; other overlays in the same corner stack beside them. */
export enum TimersPosition {
    TOP_LEFT = "TOP_LEFT",
    TOP_RIGHT = "TOP_RIGHT",
    BOTTOM_LEFT = "BOTTOM_LEFT",
    BOTTOM_RIGHT = "BOTTOM_RIGHT",
}

export const TimersConfig = ConfigGroup("timers", {
    showAttackTimer: ConfigItem({
        name: "Attack timer overhead",
        description: "Show the attack countdown above your player instead of in a timer box.",
        position: 0,
        default: false,
    }),
    position: ConfigItem<TimersPosition>({
        name: "Position",
        description:
            "The corner of the game view the timers sit in. Top left goes below Opponent Information, " +
            "top right below the minimap, bottom left above the chatbox (beside the Slayer Tracker), " +
            "bottom right above the inventory. Hold Alt and drag them to move them elsewhere.",
        position: 1,
        enum: TimersPosition,
        default: TimersPosition.TOP_RIGHT,
    }),
    scale: ConfigItem({
        name: "Scale",
        description: "The size of the timer boxes and their numbers, in percent (100 is the original size).",
        position: 2,
        range: { min: 50, max: 400 },
        units: "%",
        default: 150,
    }),
});
