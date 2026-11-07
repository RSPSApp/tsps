import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

export const TickCounterConfig = ConfigGroup("tickcounter", {
    ticksPerCycle: ConfigItem({
        name: "Ticks per cycle",
        description: "Number of game ticks to count before returning to 1.",
        position: 0,
        range: { min: 1, max: 99 },
        default: 4,
    }),
});
