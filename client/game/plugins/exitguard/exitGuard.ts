/**
 * The navigation half of Exit Guard: it takes the browser's back button for itself, asks before
 * leaving, and does the real navigation when the player confirms. No DOM here, so the sequence
 * the browser puts through it — popstate, then the go() that either works or doesn't — is testable
 * against a fake history.
 */

/** Marks the history entry this guard added, so a pop that lands below it is recognised. */
export const EXIT_GUARD_STATE_KEY = "tspsExitGuard";

/** How long to give `history.go` before deciding the page was not taken away after all. */
export const LEAVE_CHECK_DELAY_MS = 400;

export type ExitGuardHistory = {
    state: unknown;
    pushState(data: unknown, title: string, url?: string | URL | null): void;
    go(delta: number): void;
};

/** Everything this guard asks of the browser, injectable so tests drive it by hand. */
export type ExitGuardHost = {
    history: ExitGuardHistory;
    addEventListener(type: string, listener: (event: Event) => void, capture?: boolean): void;
    removeEventListener(type: string, listener: (event: Event) => void, capture?: boolean): void;
    /** For a tab with nothing behind it: leaving means closing it. */
    close(): void;
    /** Whether this page is still on screen; hidden means the navigation or close did happen. */
    isVisible(): boolean;
    after(delayMs: number, run: () => void): void;
};

export type ExitGuardOptions = {
    /** Shows or hides the leave confirmation; `blocked` is the "nothing let us leave" hint. */
    onDialog(open: boolean, blocked: boolean): void;
    /** Whether a reload or tab close is worth the browser's own prompt, i.e. a live session. */
    shouldPromptOnUnload(): boolean;
};

export class BackButtonGuard {
    private armed = false;
    /** A navigation this guard started, so its own listeners must stand down. */
    private leaving = false;
    private dialogOpen = false;

    constructor(
        private readonly host: ExitGuardHost,
        private readonly options: ExitGuardOptions,
    ) {}

    isArmed(): boolean {
        return this.armed;
    }

    isDialogOpen(): boolean {
        return this.dialogOpen;
    }

    /**
     * Keeps the first back press for itself. While armed, the page sits on top of its own history
     * entry, so a press cannot step off it — exactly like the mobile apps that ask to confirm.
     */
    arm(): void {
        if (this.armed) return;
        this.armed = true;
        this.leaving = false;
        this.host.addEventListener("popstate", this.onPopState);
        this.host.addEventListener("beforeunload", this.onBeforeUnload);
        if (!this.hasSentinel()) this.pushSentinel();
    }

    /** Gives the back button back, dropping the entry this guard put on the stack. */
    disarm(): void {
        if (!this.armed) return;
        this.armed = false;
        this.host.removeEventListener("popstate", this.onPopState);
        this.host.removeEventListener("beforeunload", this.onBeforeUnload);
        this.setDialog(false);
        // Same URL, so a same-document step: nothing reloads, the player can just leave now.
        if (this.hasSentinel()) this.host.history.go(-1);
    }

    stay(): void {
        this.setDialog(false);
    }

    /**
     * Leaves the way the player asked: over this guard's own entry and the one behind it. If there
     * was nothing behind it — a tab opened on the game directly — the tab gets closed, and if the
     * browser refused both the question comes back rather than stranding the player on a page they
     * just agreed to leave.
     */
    leave(): void {
        this.setDialog(false);
        if (!this.armed) return;
        this.leaving = true;
        this.host.history.go(this.hasSentinel() ? -2 : -1);
        this.host.after(LEAVE_CHECK_DELAY_MS, () => this.checkLeft());
    }

    private readonly onPopState = (): void => {
        if (!this.armed || this.leaving) return;
        // Asking re-pushes the entry the press consumed, so the page stays on top of its own entry:
        // the stack keeps its length, the URL is untouched and nothing actually navigated.
        this.setDialog(true, false);
    };

    private readonly onBeforeUnload = (event: Event): void => {
        if (!this.armed || this.leaving || !this.options.shouldPromptOnUnload()) return;
        // Leaving by choice must not raise the browser's prompt on top of the navigation it starts.
        event.preventDefault?.();
        // Chrome still wants the legacy signal before it shows "Leave site?".
        (event as BeforeUnloadEvent).returnValue = "";
    };

    private checkLeft(): void {
        if (!this.leaving) return;
        this.leaving = false;
        if (!this.host.isVisible()) return;
        this.host.close();
        if (!this.host.isVisible()) return;
        this.setDialog(true, true);
    }

    private setDialog(open: boolean, blocked = false): void {
        if (open && !this.hasSentinel()) this.pushSentinel();
        this.dialogOpen = open;
        this.options.onDialog(open, blocked);
    }

    private hasSentinel(): boolean {
        return stateRecord(this.host.history.state)[EXIT_GUARD_STATE_KEY] === true;
    }

    private pushSentinel(): void {
        // Carry the entry's own state: the router keeps its keys there and rewrites them on popstate.
        this.host.history.pushState(
            { ...stateRecord(this.host.history.state), [EXIT_GUARD_STATE_KEY]: true },
            "",
        );
    }
}

function stateRecord(state: unknown): Record<string, unknown> {
    return typeof state === "object" && state !== null ? (state as Record<string, unknown>) : {};
}
