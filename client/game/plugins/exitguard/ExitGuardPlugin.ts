import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import type { InputManager } from "../../InputManager";
import type { OsrsClient } from "../../OsrsClient";
import { BackButtonGuard, type ExitGuardHost } from "./exitGuard";
import { ExitConfirmDialog } from "./ExitConfirmDialog";

/** The dialog, as the plugin drives it; `holds` tells a key press aimed at it from one aimed at the game. */
export type LeaveDialogView = {
    show(blocked: boolean): void;
    hide(): void;
    destroy(): void;
    holds(target: EventTarget | Node | null): boolean;
};

type ExitGuardInput = Pick<InputManager, "addInputFilter">;

/** The browser side of the guard, built from the page's own window. */
function windowHost(): ExitGuardHost | undefined {
    if (typeof window === "undefined" || typeof document === "undefined") return undefined;
    return {
        history: window.history,
        addEventListener: (type, listener, capture) =>
            window.addEventListener(type, listener as EventListener, capture),
        removeEventListener: (type, listener, capture) =>
            window.removeEventListener(type, listener as EventListener, capture),
        close: () => window.close(),
        isVisible: () => document.visibilityState !== "hidden",
        after: (delayMs, run) => {
            setTimeout(run, delayMs);
        },
    };
}

function engineClient(): OsrsClient | undefined {
    try {
        return inject<OsrsClient>(CLIENT_TOKEN);
    } catch {
        // Constructed standalone (a test): everything the client would supply is injected instead.
        return undefined;
    }
}

/**
 * Stops the back button from dropping a player out of the game by accident.
 *
 * The client is one page with no in-app history, so browser back — the button, the swipe gesture
 * or the Android key — has always meant leaving the game mid-session. While this plugin runs, the
 * first press instead opens a Stay/Leave dialog (see `BackButtonGuard` for the history steps), and
 * a reload or tab close during a session raises the browser's own prompt. Not a RuneLite plugin:
 * a desktop client has no back button.
 */
export class ExitGuardPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Exit Guard",
        description: "Ask before the browser's back button leaves the game",
        tags: ["back", "exit", "leave", "disconnect", "navigation", "confirm", "accident"],
        enabledByDefault: true,
        configKey: "exitguardplugin",
    };

    private readonly host: ExitGuardHost | undefined;
    private readonly dialog: LeaveDialogView;
    private readonly guard: BackButtonGuard | undefined;
    private readonly input: ExitGuardInput;
    private readonly inSession: () => boolean;
    private removeFilter: (() => void) | undefined;

    constructor(
        host?: ExitGuardHost,
        dialog?: LeaveDialogView,
        input?: ExitGuardInput,
        inSession?: () => boolean,
    ) {
        super();
        this.host = host ?? windowHost();
        this.dialog = dialog ?? new ExitConfirmDialog({
            onStay: () => this.guard?.stay(),
            onLeave: () => this.guard?.leave(),
        });
        const client = engineClient();
        this.input = input ?? client?.inputManager ?? { addInputFilter: () => () => {} };
        this.inSession = inSession ?? (() => client?.isLoggedIn() ?? false);
        this.guard = this.host
            ? new BackButtonGuard(this.host, {
                  onDialog: (open, blocked) => {
                      if (open) this.dialog.show(blocked);
                      else this.dialog.hide();
                  },
                  // Only a live session is worth a prompt: reloading the login screen is normal.
                  shouldPromptOnUnload: () => this.inSession(),
              })
            : undefined;
    }

    /** The guard, for tests and for anything that wants to leave or stay programmatically. */
    getGuard(): BackButtonGuard | undefined {
        return this.guard;
    }

    protected async startUp(): Promise<void> {
        this.guard?.arm();
        if (!this.host) return;
        // The dialog is modal: neither the keyboard, which the game reads off the document, nor the
        // mouse, which it reads off the canvas, may answer for it while it is up.
        this.host.addEventListener("keydown", this.onKeyDown, true);
        this.removeFilter = this.input.addInputFilter(() => this.guard?.isDialogOpen() === true);
    }

    protected async shutDown(): Promise<void> {
        this.removeFilter?.();
        this.removeFilter = undefined;
        this.host?.removeEventListener("keydown", this.onKeyDown, true);
        this.guard?.disarm();
        this.dialog.destroy();
    }

    private readonly onKeyDown = (event: Event): void => {
        const key = (event as KeyboardEvent).key;
        const guard = this.guard;
        if (!guard?.isDialogOpen() || !key) return;
        // Tab stays the browser's, so the buttons remain reachable by keyboard, and Enter or Space
        // on the button holding focus is that button's own activation.
        if (key === "Tab") return;
        if (this.dialog.holds(event.target) && (key === "Enter" || key === " ")) return;
        event.preventDefault();
        // Capture on the window, ahead of the game's own capture listener on the document.
        event.stopImmediatePropagation();
        if (key === "Escape" || key === "Enter") guard.stay();
    };
}
