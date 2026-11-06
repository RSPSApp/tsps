import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

export const SlayerTrackerConfig = ConfigGroup("slayertracker", {
    highlightTargets: ConfigItem({ name: "Highlight task NPCs", default: true }),
    showPoints: ConfigItem({ name: "Show Slayer points", default: true }),
    showStreak: ConfigItem({ name: "Show task streaks", default: true }),
});
