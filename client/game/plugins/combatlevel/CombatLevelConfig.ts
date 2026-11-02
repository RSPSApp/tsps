import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

export const CombatLevelConfig = ConfigGroup("combatlevel", {
    showLevelsUntil: ConfigItem({ name: "Calculate next level", description: "Show skill levels that would raise your combat level.", default: true }),
    showPreciseCombatLevel: ConfigItem({ name: "Show precise combat level", description: "Show the decimal combat level in Combat Options.", default: true }),
});
