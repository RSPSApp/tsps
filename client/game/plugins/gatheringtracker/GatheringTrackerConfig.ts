import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

export const GatheringTrackerConfig = ConfigGroup("gatheringtracker", {
    showXpDrops: ConfigItem({ name: "Show XP drops", default: true }),
    showAverageXp: ConfigItem({ name: "Show average XP per drop", default: true }),
});
