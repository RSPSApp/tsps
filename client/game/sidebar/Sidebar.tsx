import { useCallback, useEffect, useSyncExternalStore } from "react";

import type { ConfigManager } from "@runelite/client/config/ConfigManager";
import type { ClientToolbar } from "@runelite/client/ui/ClientToolbar";
import type { NavigationButton } from "@runelite/client/ui/NavigationButton";
import "./Sidebar.css";
import "./SidebarPanels.css";
import "./PluginHub.css";
import { SidebarPanel } from "./SidebarPanel";
import { SidebarRail } from "./SidebarRail";
import type { SidebarStore } from "./SidebarStore";
import { useSidebarMode } from "./useSidebarMode";

/**
 * The RuneLite-style sidebar beside the game: an icon rail that's always there, and the
 * selected button's panel, docked beside the game (which narrows) or over it. The buttons are
 * whatever enabled plugins added to `ClientToolbar`.
 */
export function Sidebar({
    toolbar,
    store,
    configManager,
    mobile = false,
}: {
    toolbar: ClientToolbar;
    store: SidebarStore;
    configManager: ConfigManager;
    mobile?: boolean;
}): JSX.Element {
    const buttons = useSyncExternalStore(
        useCallback((listener: () => void) => toolbar.subscribe(listener), [toolbar]),
        () => toolbar.getNavigations(),
    );
    const { selected } = useSyncExternalStore(
        useCallback((listener: () => void) => store.subscribe(listener), [store]),
        () => store.getState(),
    );
    const mode = useSidebarMode(configManager, mobile);
    const open = buttons.find((button) => button.tooltip === selected && button.panel);

    useEffect(
        () => toolbar.onOpenPanel((button) => store.select(button.tooltip)),
        [toolbar, store],
    );
    useEffect(() => {
        if (!open) return;
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === "Escape") store.select(null);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [open, store]);

    const onRailClick = (button: NavigationButton): void => {
        button.onClick?.();
        if (button.panel) store.toggle(button.tooltip);
    };

    return (
        <div className={`rl-sidebar ${mode}${open ? " open" : ""}${mobile ? " mobile" : ""}`}>
            {open ? <SidebarPanel button={open} onClose={() => store.select(null)} /> : null}
            <SidebarRail
                buttons={buttons}
                selected={open ? open.tooltip : null}
                onClick={onRailClick}
            />
        </div>
    );
}
