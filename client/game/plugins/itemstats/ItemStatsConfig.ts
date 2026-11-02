import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

export const ItemStatsConfig = ConfigGroup("itemstatsplugin", {
    equipmentStats: ConfigItem({ name: "Equipment stats", description: "Show combat bonuses and equipment changes.", section: "display", position: 0, default: true }),
    showWeight: ConfigItem({ name: "Weight", description: "Show the hovered item's weight.", section: "display", position: 1, default: true }),
    alwaysShowBaseStats: ConfigItem({ name: "Show base stats", description: "Show each item's bonus beside its change when comparing equipment.", section: "display", position: 2, default: false }),
}, { sections: { display: { name: "Display", position: 0 } } });
