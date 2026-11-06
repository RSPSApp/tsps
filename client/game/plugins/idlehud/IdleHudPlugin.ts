import { GameState } from "@runelite/api/GameState";
import { GameStateChanged } from "@runelite/api/events";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { ClientToolbar } from "@runelite/client/ui/ClientToolbar";
import type { NavigationButton } from "@runelite/client/ui/NavigationButton";
import { createElement, lazy, type ReactNode } from "react";
import type { OsrsClient } from "../../OsrsClient";
import { clearIdleState } from "./idleState";
import { createIdleNavigationButton } from "./IdlePanel";

const IdleHudOverlay = lazy(() =>
    import("./IdleHudOverlay").then((m) => ({ default: m.IdleHudOverlay })),
);

/**
 * Idle Mode's strip, always on screen while the mode is on.
 *
 * The state it draws is pushed by the server over the content-data channel and kept in
 * `idleState`; this plugin only mounts the overlay and drops the state when the account goes, so
 * the next login never sees the last one's work for a frame.
 *
 * It draws nothing at all on an account that is not idle, so a normal world is untouched.
 */
export class IdleHudPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Idle HUD",
        description: "Shows what your character is working on, and opens the Idle screen.",
        tags: ["idle"],
        configKey: "idlehudplugin",
    };

    private readonly toolbar = (() => {
        try {
            return inject(ClientToolbar);
        } catch {
            return undefined;
        }
    })();

    private navButton?: NavigationButton;

    protected async startUp(): Promise<void> {
        if (!this.toolbar) return;
        this.navButton = createIdleNavigationButton();
        this.toolbar.addNavigation(this.navButton);
    }

    protected async shutDown(): Promise<void> {
        if (this.navButton) this.toolbar?.removeNavigation(this.navButton);
        this.navButton = undefined;
    }

    onGameStateChanged(event: GameStateChanged): void {
        const state = event.getGameState();
        if (state === GameState.LOGIN_SCREEN || state === GameState.HOPPING) clearIdleState();
    }

    renderHud(_osrsClient: OsrsClient): ReactNode {
        return createElement(IdleHudOverlay);
    }
}
