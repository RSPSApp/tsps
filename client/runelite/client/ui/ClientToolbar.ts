import type { NavigationButton } from "./NavigationButton";

/**
 * RuneLite's `ClientToolbar`: plugins add their sidebar button in `startUp()` and remove it in
 * `shutDown()`, so a button shows exactly while its plugin is enabled. The sidebar shows the
 * buttons ordered as RuneLite's ClientUI does: by priority, then tooltip.
 */
export class ClientToolbar {
    private readonly buttons = new Set<NavigationButton>();
    private readonly listeners = new Set<() => void>();
    private readonly openListeners = new Set<(button: NavigationButton) => void>();
    private sorted: ReadonlyArray<NavigationButton> = [];

    addNavigation(button: NavigationButton): void {
        if (this.buttons.has(button)) return;
        this.buttons.add(button);
        this.changed();
    }

    removeNavigation(button: NavigationButton): void {
        if (this.buttons.delete(button)) this.changed();
    }

    /** Opens `button`'s panel in the sidebar (RuneLite's `ClientToolbar#openPanel`). */
    openPanel(button: NavigationButton): void {
        if (!this.buttons.has(button)) return;
        for (const listener of this.openListeners) listener(button);
    }

    /** The buttons in sidebar order. The same array until a button is added or removed. */
    getNavigations(): ReadonlyArray<NavigationButton> {
        return this.sorted;
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** For the sidebar: `openPanel` requests. */
    onOpenPanel(listener: (button: NavigationButton) => void): () => void {
        this.openListeners.add(listener);
        return () => this.openListeners.delete(listener);
    }

    private changed(): void {
        this.sorted = [...this.buttons].sort(
            (a, b) => a.priority - b.priority || a.tooltip.localeCompare(b.tooltip),
        );
        for (const listener of this.listeners) listener();
    }
}
