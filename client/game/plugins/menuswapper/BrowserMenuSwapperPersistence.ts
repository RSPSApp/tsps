import type { MenuSwapperPluginConfig, MenuSwapperPluginPersistence } from "./types";

export function createBrowserMenuSwapperPluginPersistence(
    storageKey: string,
): MenuSwapperPluginPersistence | undefined {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
        return undefined;
    }

    return {
        load: (): Partial<MenuSwapperPluginConfig> | undefined => {
            try {
                const raw = window.localStorage.getItem(storageKey);
                return raw ? (JSON.parse(raw) as Partial<MenuSwapperPluginConfig>) : undefined;
            } catch {
                return undefined;
            }
        },
        save: (config: MenuSwapperPluginConfig): void => {
            try {
                window.localStorage.setItem(storageKey, JSON.stringify(config));
            } catch {}
        },
    };
}
