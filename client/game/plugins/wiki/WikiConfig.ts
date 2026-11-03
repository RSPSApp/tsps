import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

/**
 * RuneLite 1.13.5 WikiConfig: group, key, name and default as in RuneLite. Its "Left-click
 * search" isn't here: the game's button transmits only its Search op (op 10), which the menu
 * lists after the Lookup target, and moving it in front needs event flags only the server sets.
 */
export const WikiConfig = ConfigGroup("wiki", {
    showWikiMinimapButton: ConfigItem({
        name: "Show wiki button under minimap",
        description: "Shows the wiki lookup button under the minimap.",
        position: 2,
        default: true,
    }),
});
