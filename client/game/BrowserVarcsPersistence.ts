import { canUseLocalStorage } from "../common/utils/localStorage";
import type { CacheInfo } from "../rs/cache/CacheInfo";
import type { PersistedVarcsState } from "../rs/config/vartype/VarManager";

const STORAGE_KEY_PREFIX = "osrs.varcs";
const STORAGE_VERSION = 1;

type BrowserVarcsPayload = {
    version: number;
    ints: Array<[number, number]>;
    strings: Array<[number, string]>;
};

function sanitizeIntPairs(raw: unknown): Array<[number, number]> {
    if (!Array.isArray(raw)) {
        return [];
    }

    const pairs: Array<[number, number]> = [];
    for (const entry of raw) {
        if (!Array.isArray(entry) || entry.length !== 2) {
            continue;
        }
        const id = Number(entry[0]);
        const value = Number(entry[1]);
        if (!Number.isInteger(id) || !Number.isFinite(value)) {
            continue;
        }
        pairs.push([id | 0, value | 0]);
    }

    return pairs;
}

function sanitizeStringPairs(raw: unknown): Array<[number, string]> {
    if (!Array.isArray(raw)) {
        return [];
    }

    const pairs: Array<[number, string]> = [];
    for (const entry of raw) {
        if (!Array.isArray(entry) || entry.length !== 2) {
            continue;
        }
        const id = Number(entry[0]);
        const value = entry[1];
        if (!Number.isInteger(id) || typeof value !== "string") {
            continue;
        }
        pairs.push([id | 0, value]);
    }

    return pairs;
}

export function getBrowserVarcsStorageKey(cacheInfo: CacheInfo): string {
    return `${STORAGE_KEY_PREFIX}.${cacheInfo.game}.v${STORAGE_VERSION}`;
}

export function loadBrowserVarcs(storageKey: string): PersistedVarcsState | undefined {
    // Blocked storage throws on the property read itself, so ask through the guarded helper.
    if (!canUseLocalStorage()) {
        return undefined;
    }

    try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) {
            return undefined;
        }

        const parsed = JSON.parse(raw) as Partial<BrowserVarcsPayload>;
        return {
            ints: sanitizeIntPairs(parsed.ints),
            strings: sanitizeStringPairs(parsed.strings),
        };
    } catch {
        return undefined;
    }
}

export function saveBrowserVarcs(storageKey: string, state: PersistedVarcsState): void {
    // Blocked storage throws on the property read itself, so ask through the guarded helper.
    if (!canUseLocalStorage()) {
        return;
    }

    try {
        const payload: BrowserVarcsPayload = {
            version: STORAGE_VERSION,
            ints: state.ints,
            strings: state.strings,
        };
        window.localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {}
}
