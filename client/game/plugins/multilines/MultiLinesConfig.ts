import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

/** RuneLite's Multi-Lines (MultiIndicatorsPlugin) options: scene and minimap lines, and the Wilderness level lines. */
export const MultiLinesConfig = ConfigGroup("multiindicators", {
    showInScene: ConfigItem({
        name: "Show in scene",
        description: "Draws the borders of multicombat areas on the ground.",
        default: true,
    }),
    showOnMinimap: ConfigItem({
        name: "Show on minimap",
        description: "Draws the borders of multicombat areas on the minimap.",
        default: true,
    }),
    multicombatColor: ConfigItem({
        name: "Multicombat colour",
        description: "The colour of the multicombat borders.",
        color: true,
        alpha: true,
        default: 0xffff0000,
    }),
    showWildernessLines: ConfigItem({
        name: "Wilderness level lines",
        description: "Draws the Wilderness level 20 and 30 lines.",
        default: true,
    }),
    wildernessLineColor: ConfigItem({
        name: "Wilderness line colour",
        description: "The colour of the Wilderness level lines.",
        color: true,
        alpha: true,
        default: 0xffffa500,
    }),
    borderWidth: ConfigItem({
        name: "Line width",
        description: "Width of the lines.",
        step: 0.1,
        default: 2,
    }),
});
