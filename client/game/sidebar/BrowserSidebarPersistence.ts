import type { SidebarPersistedState, SidebarPersistence } from "./types";

export function createBrowserSidebarPersistence(
    storageKey: string,
): SidebarPersistence | undefined {
    try {
        if (typeof window === "undefined") return undefined;
        if (typeof window.localStorage === "undefined") return undefined;
    } catch {
        return undefined;
    }

    return {
        load: (): SidebarPersistedState | undefined => {
            try {
                const raw = window.localStorage.getItem(storageKey);
                if (!raw) return undefined;
                const parsed = JSON.parse(raw) as Partial<SidebarPersistedState>;
                return {
                    open: parsed.open === true,
                    selectedId: typeof parsed.selectedId === "string" ? parsed.selectedId : null,
                    // Saves from before the sidebar could be hidden have no flag: shown.
                    collapsed: parsed.collapsed === true,
                };
            } catch {
                return undefined;
            }
        },
        save: (state: SidebarPersistedState): void => {
            try {
                window.localStorage.setItem(storageKey, JSON.stringify(state));
            } catch {}
        },
    };
}
