import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

export enum TimersPosition {
    COMBAT_ROW = "Combat row",
    TOP_LEFT = "Upper left",
    TOP_RIGHT = "Upper right",
    BOTTOM_LEFT = "Lower left",
    BOTTOM_RIGHT = "Lower right",
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
        description: "Place the timer boxes within the game view on desktop and mobile.",
        position: 1,
        enum: TimersPosition,
        enumLabels: TimersPosition,
        default: TimersPosition.COMBAT_ROW,
    }),
    scale: ConfigItem({
        name: "Scale",
        description: "Timer box and text size on desktop and mobile. Boxes wrap or shrink to fit small game views.",
        position: 2,
        range: { min: 75, max: 200 },
        units: "%",
        default: 100,
    }),
});
