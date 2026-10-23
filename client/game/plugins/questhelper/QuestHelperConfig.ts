import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";
export const QuestHelperConfig = ConfigGroup("questhelper", {
    selectedQuest: ConfigItem({ name: "Selected quest", description: "Last selected quest key.", default: "", hidden: true }),
    helperVariant: ConfigItem({ name: "Quest variant", default: "", hidden: true }),
    highlightTiles: ConfigItem({ name: "Highlight quest targets", description: "Highlight the active step's NPC, object, ground item and tile locations.", default: true }),
    highlightWidgets: ConfigItem({ name: "Highlight widgets and items", description: "Outline relevant visible widgets and inventory items.", default: true }),
    showOverlays: ConfigItem({ name: "Show puzzle overlays", description: "Display the helper's read-only puzzle hints.", default: true }),
    showDirections: ConfigItem({name:"Navigation arrows and directions",description:"Point to the active target in the world and minimap. Server hints take priority.",default:true}),
    highlightColor: ConfigItem({ name: "Highlight colour", default: 0x00ffff, color: true }),
});
