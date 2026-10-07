/** What the sidebar remembers between visits: whether a panel was open, and which. */
export interface SidebarPersistedState {
    open: boolean;
    /** The open panel's button tooltip. */
    selectedId: string | null;
}

export interface SidebarPersistence {
    load(): SidebarPersistedState | undefined;
    save(state: SidebarPersistedState): void;
}

export interface SidebarState {
    /** The open panel's button tooltip, or null when no panel is open. */
    selected: string | null;
}
