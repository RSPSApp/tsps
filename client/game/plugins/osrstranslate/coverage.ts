import { cleanText, containsLetters, normalizeLookupText } from "./TranslationLookup";

/** One distinct text the client showed, and where. */
export interface CoverageEntry {
    readonly where: string;
    readonly text: string;
    translated: boolean;
    count: number;
}

export interface CoverageReport {
    readonly seen: number;
    readonly translated: number;
    readonly percent: number;
    /** Untranslated texts, most often seen first. */
    readonly untranslated: CoverageEntry[];
}

const CAP = 5000;

/**
 * A developer tool: while switched on, every text the plugin is asked about (interface text,
 * menu options, game messages, NPC overhead text) is recorded once per place, with whether it was
 * translated, giving an on-screen coverage figure and the list of what is still English. Text that
 * never passes the plugin (menu targets, world map labels, other plugins' overlays, React panels)
 * is not counted.
 */
export class TranslationCoverage {
    enabled = false;
    private readonly entries = new Map<string, CoverageEntry>();
    /** Text the plugin produced: when it is drawn again (chat lines become widgets), it is covered. */
    private readonly produced = new Set<string>();

    record(where: string, original: string, translation: string | null | undefined): void {
        if (!this.enabled) return;
        const text = normalizeLookupText(cleanText(original));
        if (!text || !containsLetters(text)) return;
        const translated = translation != null && translation !== original;
        if (translated) this.noteProduced(translation!);
        const covered = translated || this.produced.has(text);
        const key = `${where}\u0000${text}`;
        const entry = this.entries.get(key);
        if (entry) {
            entry.count++;
            if (covered) entry.translated = true;
            return;
        }
        if (this.entries.size >= CAP) return;
        this.entries.set(key, { where, text, translated: covered, count: 1 });
    }

    private noteProduced(translation: string): void {
        if (this.produced.size >= CAP * 2) return;
        this.produced.add(normalizeLookupText(cleanText(translation)));
    }

    reset(): void {
        this.entries.clear();
        this.produced.clear();
    }

    report(): CoverageReport {
        const all = [...this.entries.values()].filter((entry) => !this.produced.has(entry.text) || entry.translated);
        const translated = all.filter((entry) => entry.translated).length;
        const untranslated = all.filter((entry) => !entry.translated).sort((a, b) => b.count - a.count);
        return {
            seen: all.length,
            translated,
            percent: all.length ? Math.round((1000 * translated) / all.length) / 10 : 0,
            untranslated,
        };
    }
}
