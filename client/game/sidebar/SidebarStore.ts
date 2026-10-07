import type { SidebarPersistence, SidebarState } from "./types";

/**
 * Which sidebar panel is open, by its NavigationButton's tooltip, saved between visits.
 * The buttons themselves come from `ClientToolbar`; a remembered panel whose plugin is now
 * off simply doesn't open.
 */
export class SidebarStore {
    private readonly listeners = new Set<() => void>();
    private state: SidebarState;

    constructor(private readonly persistence?: SidebarPersistence) {
        const saved = persistence?.load();
        this.state = { selected: saved?.open ? saved.selectedId : null };
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getState(): SidebarState {
        return this.state;
    }

    /** Opens `tooltip`'s panel, or closes the panel with null. */
    select(tooltip: string | null): void {
        if (this.state.selected === tooltip) return;
        this.state = { selected: tooltip };
        this.persistence?.save({ open: tooltip !== null, selectedId: tooltip });
        for (const listener of this.listeners) listener();
    }

    /** A rail click: opens the panel, or closes it when it's already open (RuneLite). */
    toggle(tooltip: string): void {
        this.select(this.state.selected === tooltip ? null : tooltip);
    }
}
