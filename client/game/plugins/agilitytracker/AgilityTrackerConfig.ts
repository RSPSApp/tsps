import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

export const AgilityTrackerConfig = ConfigGroup("agilitytracker", {
    showLapsPerHour: ConfigItem({ name: "Show laps per hour", default: true }),
    showLapsUntilLevel: ConfigItem({ name: "Show laps until level", default: true }),
    showXpGained: ConfigItem({ name: "Show XP gained", default: true }),
});
