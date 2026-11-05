import type { DictionaryData, DictionaryFile } from "./TranslationState";

/**
 * tsps's own additions to the author's dictionaries (client/public/osrstranslate/, built by
 * client/scripts/osrs-translate-additions.mjs from our pull requests to his repository). They
 * retire themselves: an addition is used only while his dictionary has no entry for the text, and
 * a fix only while his entry is still exactly the text it replaces.
 */
export interface Additions {
    files: Partial<Record<DictionaryFile, { add?: Record<string, string>; fix?: Record<string, [string, string]> }>>;
}

export type LoadAdditions = (language: string) => Promise<Additions | undefined>;

/** The dictionaries with the additions applied; the files they don't touch are shared, not copied. */
export function applyAdditions(data: DictionaryData, additions: Additions): { data: DictionaryData; added: number; fixed: number } {
    const out: Partial<Record<DictionaryFile, ReadonlyMap<string, string>>> = { ...data };
    let added = 0;
    let fixed = 0;
    for (const [file, entry] of Object.entries(additions.files ?? {}) as [DictionaryFile, Additions["files"][DictionaryFile]][]) {
        if (!entry) continue;
        const map = new Map(data[file] ?? []);
        for (const [key, value] of Object.entries(entry.add ?? {})) {
            if (typeof value !== "string" || map.has(key)) continue;
            map.set(key, value);
            added++;
        }
        for (const [key, pair] of Object.entries(entry.fix ?? {})) {
            if (!Array.isArray(pair) || typeof pair[1] !== "string" || map.get(key) !== pair[0]) continue;
            map.set(key, pair[1]);
            fixed++;
        }
        out[file] = map;
    }
    return { data: out, added, fixed };
}

const cache = new Map<string, Promise<Additions | undefined>>();

/** The bundled additions for a language folder, fetched once; none when the file can't be read. */
export const fetchAdditions: LoadAdditions = (language) => {
    let pending = cache.get(language);
    if (!pending) {
        const base = (process.env.PUBLIC_URL ?? "").replace(/\/$/, "");
        pending = fetch(`${base}/osrstranslate/additions-${encodeURIComponent(language)}.json`)
            .then((response) => (response.ok ? (response.json() as Promise<Additions>) : undefined))
            .catch(() => undefined);
        // A failed read is retried with the next update rather than remembered.
        pending.then((value) => { if (!value) cache.delete(language); });
        cache.set(language, pending);
    }
    return pending;
};
