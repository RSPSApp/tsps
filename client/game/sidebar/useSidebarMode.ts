import { useEffect, useState } from "react";

import type { ConfigManager } from "@runelite/client/config/ConfigManager";
import {
    RuneLiteConfig,
    SidebarMode,
    type SidebarModeValue,
} from "@runelite/client/config/RuneLiteConfig";

/** The game view's minimum width (GameContainer.css), the rail and a docked panel. */
const MIN_GAME_WIDTH = 765;
const RAIL_WIDTH = 36;
const PANEL_WIDTH = 250;

function windowWidth(): number {
    return typeof window === "undefined" ? Infinity : window.innerWidth;
}

/**
 * How panels open: the "Sidebar panels" setting, except that a window too narrow to fit the game
 * beside a docked panel, and mobile, always overlay.
 */
export function useSidebarMode(configManager: ConfigManager, mobile: boolean): SidebarModeValue {
    const config = configManager.getConfig(RuneLiteConfig);
    const [setting, setSetting] = useState<SidebarModeValue>(() => config.sidebarMode());
    const [width, setWidth] = useState(windowWidth);

    useEffect(
        () =>
            configManager.addListener((event) => {
                if (event.getGroup() === RuneLiteConfig.group) setSetting(config.sidebarMode());
            }),
        [configManager, config],
    );
    useEffect(() => {
        const onResize = (): void => setWidth(windowWidth());
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    if (mobile || width < MIN_GAME_WIDTH + RAIL_WIDTH + PANEL_WIDTH) return SidebarMode.Overlay;
    return setting;
}
