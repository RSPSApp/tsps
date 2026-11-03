import { ConfigGroup, ConfigItem, ConfigSection } from "./ConfigItem";
import { FontType } from "./FontType";

export const SidebarMode = { Docked: "docked", Overlay: "overlay" } as const;
export type SidebarModeValue = (typeof SidebarMode)[keyof typeof SidebarMode];

/**
 * The client's own settings, RuneLite's `RuneLiteConfig` (group `runelite`, which also holds
 * each plugin's on/off key). The plugin hub opens them from its pinned client row.
 */
export const RuneLiteConfig = ConfigGroup("runelite", {
    sidebarMode: ConfigItem<SidebarModeValue>({
        keyName: "sidebarMode",
        name: "Sidebar panels",
        description:
            "Docked: panels open beside the game, which narrows to make room, as in RuneLite. Overlay: panels open over the game.",
        enum: SidebarMode,
        default: SidebarMode.Docked,
        position: 0,
    }),
    /** The plugin hub's starred plugins, by name, comma-separated (RuneLite's `pinnedPlugins`). */
    pinnedPlugins: ConfigItem<string>({
        keyName: "pinnedPlugins",
        name: "Pinned plugins",
        hidden: true,
        default: "",
    }),
    dynamicOverlayFont: ConfigItem<FontType>({
        keyName: "fontType",
        name: "Dynamic overlay font",
        description: "Configures what font is used for in-game overlays such as player name, ground items, etc.",
        fontType: true,
        default: FontType.SMALL,
        position: 30,
        section: "overlaySettings",
    }),
    tooltipFont: ConfigItem<FontType>({
        keyName: "tooltipFontType",
        name: "Tooltip font",
        description: "Configures what font is used for in-game tooltips such as food stats, NPC names, etc.",
        fontType: true,
        default: FontType.SMALL,
        position: 31,
        section: "overlaySettings",
    }),
    interfaceFont: ConfigItem<FontType>({
        keyName: "interfaceFontType",
        name: "Interface font",
        description:
            "Configures what font is used for in-game interface overlays such as panels, opponent info, clue scrolls etc.",
        fontType: true,
        default: FontType.REGULAR,
        position: 32,
        section: "overlaySettings",
    }),
    infoboxFont: ConfigItem<FontType>({
        keyName: "infoboxFontType",
        name: "Infobox font",
        description: "Configures what font is used for infoboxes.",
        fontType: true,
        default: FontType.REGULAR,
        position: 33,
        section: "overlaySettings",
    }),
}, {
    sections: {
        overlaySettings: ConfigSection({ name: "Overlay settings", position: 2 }),
    },
});
