/**
 * Safe localStorage primitives. Never throw; return undefined/default on failure.
 */

export function canUseLocalStorage(): boolean {
    try {
        return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
    } catch {
        return false;
    }
}

export function readLocalStorageItem(key: string): string | undefined {
    if (!canUseLocalStorage()) return undefined;
    try {
        const value = window.localStorage.getItem(key);
        return value === null ? undefined : value;
    } catch {
        return undefined;
    }
}

export function writeLocalStorageItem(key: string, value: string): boolean {
    if (!canUseLocalStorage()) return false;
    try {
        window.localStorage.setItem(key, value);
        return true;
    } catch {
        return false;
    }
}

export function removeLocalStorageItem(key: string): void {
    if (!canUseLocalStorage()) return;
    try {
        window.localStorage.removeItem(key);
    } catch {
        // ignore
    }
}

export function readLocalStorageJson<T>(key: string): T | undefined {
    const raw = readLocalStorageItem(key);
    if (raw === undefined) return undefined;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return undefined;
    }
}

export function writeLocalStorageJson(key: string, value: unknown): boolean {
    try {
        return writeLocalStorageItem(key, JSON.stringify(value));
    } catch {
        return false;
    }
}

export function readLocalStorageBool(key: string, defaultValue: boolean): boolean {
    const raw = readLocalStorageItem(key);
    if (raw === undefined) return defaultValue;
    if (raw === "true") return true;
    if (raw === "false") return false;
    return defaultValue;
}

export function writeLocalStorageBool(key: string, value: boolean): boolean {
    return writeLocalStorageItem(key, String(value));
}
