import { ConfigGroup, ConfigItem } from "./ConfigItem";

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
            "Docked: panels open beside the game, which narrows to make room. Overlay: panels open over the game.",
        enum: SidebarMode,
        default: SidebarMode.Docked,
        position: 0,
    }),
});
