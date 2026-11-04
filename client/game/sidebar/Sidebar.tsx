import { useCallback, useEffect, useSyncExternalStore } from "react";

import type { ConfigManager } from "@runelite/client/config/ConfigManager";
import type { ClientToolbar } from "@runelite/client/ui/ClientToolbar";
import type { NavigationButton } from "@runelite/client/ui/NavigationButton";
import "./Sidebar.css";
import "./SidebarPanels.css";
import "./PluginHub.css";
import { PortraitHandednessButton } from "../plugins/portraitmode/PortraitHandednessButton";
import { SidebarPanel } from "./SidebarPanel";
import { SidebarRail } from "./SidebarRail";
import type { SidebarStore } from "./SidebarStore";
import { useSidebarMode } from "./useSidebarMode";
import { sidebarShortcut, togglePanel } from "./sidebarShortcuts";

/**
 * The RuneLite-style sidebar beside the game: an icon strip that's always there unless hidden
 * (Ctrl+F11), and the selected button's panel, docked beside the game (which narrows) or over
 * it. The buttons are whatever enabled plugins added to `ClientToolbar`.
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
}): JSX.Element | null {
    const buttons = useSyncExternalStore(
        useCallback((listener: () => void) => toolbar.subscribe(listener), [toolbar]),
        () => toolbar.getNavigations(),
    );
    const { selected, collapsed } = useSyncExternalStore(
        useCallback((listener: () => void) => store.subscribe(listener), [store]),
        () => store.getState(),
    );
    const mode = useSidebarMode(configManager, mobile);
    const open = buttons.find((button) => button.tooltip === selected && button.panel);

    useEffect(
        () =>
            toolbar.onOpenPanel((button) => {
                store.setCollapsed(false);
                store.select(button.tooltip);
            }),
        [toolbar, store],
    );

    // The shortcuts work whatever has focus, so they listen on window in the capture phase and
    // stop there, before the game reads F11/F12 as its own keys.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent): void => {
            const shortcut = sidebarShortcut(event);
            if (shortcut) {
                event.preventDefault();
                event.stopPropagation();
                if (shortcut === "toggleSidebar") store.toggleCollapsed();
                else togglePanel(store, toolbar.getNavigations());
            }
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [store, toolbar]);

    // Escape closes the open panel, unless something in it used the key first (a search field
    // clearing itself stops it).
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent): void => {
            const state = store.getState();
            if (event.key === "Escape" && state.selected !== null && !state.collapsed) {
                store.select(null);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [store]);

    if (collapsed) return null;

    const onRailClick = (button: NavigationButton): void => {
        button.onClick?.();
        if (button.panel) store.toggle(button.tooltip);
    };

    return (
        <div className={`rl-sidebar ${mode}${open ? " open" : ""}${mobile ? " mobile" : ""}`}>
            {open ? <SidebarPanel button={open} /> : null}
            <SidebarRail
                buttons={buttons}
                selected={open ? open.tooltip : null}
                onClick={onRailClick}
            >
                <PortraitHandednessButton configManager={configManager} />
            </SidebarRail>
        </div>
    );
}
