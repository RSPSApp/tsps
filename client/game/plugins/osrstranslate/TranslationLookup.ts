/*
 * Copyright (c) 2026, Walter Rezende
 * All rights reserved.
 *
 * Ported to TypeScript from OSRS Translate PT-BR (TranslationLookupHelper, WelcomeTranslationService
 * and the lookup parts of OsrsTranslatePlugin). BSD 2-Clause License, see ./LICENSE.
 */

const BR_TAG = /<br\s*\/?>/gi;
const HTML_TAG = /<[^>]+>/g;
const START_TAGS = /^(?:<str>|<col=[^>]+>)+/;
const PLACEHOLDER = /\[[^\]]+\]/g;
const PLACEHOLDER_ONE = /\[[^\]]+\]/;
const LEADING_PLACEHOLDER = /^\[[^\]]+\]/;
const QUEST_HELPER_PREFIX = /^\[\d+\]\s+/;
const COLLAPSE_SUFFIX = /\s\(\d+\)$/;
const LETTER = /\p{L}/u;

/** `<br>` and tags become spaces, whitespace collapses: the form the dictionaries' keys use. */
export function cleanText(text: string | null | undefined): string {
    if (!text) return "";
    return String(text).replace(BR_TAG, " ").replace(HTML_TAG, " ").replace(/\s+/g, " ").trim();
}

/**
 * The lookup form with inline tags kept: `<br>` as a space, leading tags dropped (they are put
 * back by preserveStartTags), whitespace collapsed and normalised as the lookup is.
 */
export function richLookupText(text: string): string {
    const collapsed = String(text).replace(BR_TAG, " ").replace(/\s+/g, " ").trim();
    return normalizeLookupText(collapsed.replace(START_TAGS, "").trim());
}

/** Upstream's key normalisation: no space before punctuation, and the "Ironmen" fixes. */
export function normalizeLookupText(text: string): string {
    return text
        .replace(/\s+([.,!?])/g, "$1")
        .replace(/([Hh])ardcore Ironmen /g, "$1ardcore Ironman ")
        .replace(/standard Ironmen /g, "standard Ironman ");
}

/** The leading `<str>`/`<col=...>` tags of `text`, put back in front of a translation. */
export function preserveStartTags(text: string): string {
    return START_TAGS.exec(text)?.[0] ?? "";
}

export function containsLetters(text: string): boolean {
    return LETTER.test(text);
}

/** Quest Helper numbers dialogue options "[1] Yes."; the number is kept, the rest translated. */
export function splitQuestHelperPrefix(clean: string): [prefix: string, rest: string] {
    const prefix = QUEST_HELPER_PREFIX.exec(clean)?.[0] ?? "";
    return [prefix, clean.slice(prefix.length)];
}

/** Chat Filter collapses repeats into "message (3)"; the count is kept, the message translated. */
export function splitCollapseSuffix(text: string): [rest: string, suffix: string] {
    const suffix = COLLAPSE_SUFFIX.exec(text)?.[0] ?? "";
    return [text.slice(0, text.length - suffix.length), suffix];
}

/** Rich chat-overlay translations use `<br>` and `</col>`; the overlay wants `\n` and black. */
export function normalizeChatOverlayTags(text: string): string {
    return text.replace(BR_TAG, "\n").split("</col>").join("<col=000000>");
}

export interface PatternEntry {
    readonly key: string;
    readonly pattern: RegExp;
    readonly translation: string;
    readonly specificity: number;
    /**
     * The key's fixed text before its first placeholder and after its last, and the shortest text
     * it can match. The pattern is anchored at both ends, so a text failing these can't match;
     * checking them first skips the regex for nearly every pattern.
     */
    readonly prefix: string;
    readonly suffix: string;
    readonly minLength: number;
    /** Position in the specificity-sorted list: the order upstream tries patterns in. */
    readonly rank: number;
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function staticTextLength(text: string): number {
    return text.replace(PLACEHOLDER, "").length;
}

function isIdentityTemplate(key: string, translation: string): boolean {
    return key.replace(PLACEHOLDER, "\u0000") === translation.replace(PLACEHOLDER, "\u0000");
}

/**
 * Keys with `[placeholder]` tokens as whole-string patterns, most specific (longest static text)
 * first. Identity templates and keys made only of placeholders are skipped, as upstream: the
 * latter would match every text, NPC names included.
 */
export function compileRegexTranslations(source: ReadonlyMap<string, string>): PatternEntry[] {
    const entries: Omit<PatternEntry, "rank">[] = [];
    for (const [key, translation] of source) {
        if (!PLACEHOLDER_ONE.test(key) || isIdentityTemplate(key, translation)) continue;
        const specificity = staticTextLength(key);
        // Keys with no words of their own match nearly any text. Upstream skips only keys of
        // placeholders alone; pt-BR's "[Vampyre name]." -> "[Vampyre name]" also matches every
        // untranslated sentence ending in a full stop and drops the stop, so punctuation alone
        // is not enough either.
        if (specificity === 0 || !LETTER.test(key.replace(PLACEHOLDER, ""))) continue;
        const parts = key.split(PLACEHOLDER);
        const pattern = parts.map(escapeRegExp).join("(.+?)");
        entries.push({
            key,
            pattern: new RegExp(`^${pattern}$`, "s"),
            translation,
            specificity,
            prefix: parts[0],
            suffix: parts[parts.length - 1],
            minLength: specificity + parts.length - 1,
        });
    }
    // Stable sort keeps the dictionary's order among equally specific keys, as Java's sort does.
    entries.sort((a, b) => b.specificity - a.specificity);
    return entries.map((entry, rank) => ({ ...entry, rank }));
}

/** Fills each placeholder of the matching translation with the captured text, in order. */
function applyPattern(entry: PatternEntry, lookup: string): string | null {
    if (lookup.length < entry.minLength || !lookup.startsWith(entry.prefix) || !lookup.endsWith(entry.suffix)) return null;
    const match = entry.pattern.exec(lookup);
    if (!match) return null;
    let result = entry.translation;
    let replaced = false;
    // Search after each inserted value, so a captured "[x]" is never taken for a placeholder.
    let from = 0;
    for (let i = 1; i < match.length; i++) {
        const placeholder = PLACEHOLDER_ONE.exec(result.slice(from));
        if (!placeholder) break;
        const at = from + placeholder.index;
        result = result.slice(0, at) + match[i] + result.slice(at + placeholder[0].length);
        from = at + match[i].length;
        replaced = true;
    }
    return replaced && result !== lookup ? result : null;
}

/** Upstream's linear scan, kept for tests and as the reference for the bucketed one. */
export function findRegexTranslation(patterns: readonly PatternEntry[], lookup: string): string | null {
    for (const entry of patterns) {
        const result = applyPattern(entry, lookup);
        if (result !== null) return result;
    }
    return null;
}

const MEMO_LIMIT = 8192;

/**
 * One dictionary file: exact keys, the set of its translations (text already translated is left
 * alone), and its placeholder patterns. Patterns are bucketed by the first character of their
 * key, since a pattern with literal text in front only matches text starting with it; patterns
 * starting with a placeholder are checked for every lookup. Results are memoised because the
 * interface asks for the same strings every frame it redraws.
 */
export class TranslationDomain {
    readonly values: ReadonlySet<string>;
    private readonly byFirstChar = new Map<string, PatternEntry[]>();
    private readonly leadingPlaceholder: PatternEntry[] = [];
    private readonly memo = new Map<string, string | null>();

    constructor(
        readonly exact: ReadonlyMap<string, string>,
        withPatterns: boolean,
    ) {
        this.values = new Set(exact.values());
        if (!withPatterns) return;
        for (const entry of compileRegexTranslations(exact)) {
            if (LEADING_PLACEHOLDER.test(entry.key)) {
                this.leadingPlaceholder.push(entry);
            } else {
                const first = entry.key.charAt(0);
                let bucket = this.byFirstChar.get(first);
                if (!bucket) this.byFirstChar.set(first, (bucket = []));
                bucket.push(entry);
            }
        }
    }

    static empty(): TranslationDomain {
        return new TranslationDomain(new Map(), false);
    }

    get size(): number {
        return this.exact.size;
    }

    /**
     * The translation of a cleaned, normalised lookup, or null when there is none. `rich` is the
     * same text with its inline tags kept (see richLookupText): when a placeholder key matches it
     * too, the placeholders are filled from it, so a value the game colours (a track name, an
     * item) keeps its colour. Upstream fills them from the stripped text and loses it.
     */
    translate(lookup: string, rich?: string): string | null {
        const memoKey = rich && rich !== lookup ? `${lookup}\u0000${rich}` : lookup;
        const cached = this.memo.get(memoKey);
        if (cached !== undefined) return cached;
        let result = this.exact.get(lookup) ?? null;
        if (result === null) {
            const entry = this.findPattern(lookup);
            if (entry) {
                result = (memoKey !== lookup ? applyPattern(entry, rich!) : null) ?? applyPattern(entry, lookup);
            }
        }
        if (this.memo.size >= MEMO_LIMIT) this.memo.clear();
        this.memo.set(memoKey, result);
        return result;
    }

    /** The first pattern, in upstream's order, that translates `lookup`. */
    private findPattern(lookup: string): PatternEntry | null {
        const bucket = this.byFirstChar.get(lookup.charAt(0));
        const leading = this.leadingPlaceholder;
        if (!bucket && leading.length === 0) return null;
        // Merge the two lists by rank so the order matches the unbucketed scan exactly.
        let i = 0;
        let j = 0;
        const a = bucket ?? [];
        while (i < a.length || j < leading.length) {
            const takeA = j >= leading.length || (i < a.length && a[i].rank < leading[j].rank);
            const entry = takeA ? a[i++] : leading[j++];
            if (applyPattern(entry, lookup) !== null) return entry;
        }
        return null;
    }
}

// --- Welcome screen specials (WelcomeTranslationService) -----------------------------------------

const LAST_LOGIN_TEMPLATE = "You last logged in [value] ago.";
const HANS_TEMPLATE_KEY = "__hans.template";
const WELCOME_LAST_LOGIN = /^You last logged in (.+) ago\.$/;
const DURATION_UNIT = /\b(\d[\d,]*)\s+(day|days|hour|hours|minute|minutes|second|seconds)\b/g;
const SINGLE_DURATION_UNIT = /\b(a|an)\s+(day|hour|minute|second)\b/g;
const HANS = /^You've spent (\d[\d,]*) (days?), (\d[\d,]*) (hours?), (\d[\d,]*) (minutes?) in the world since you arrived (\d[\d,]*) (days?) ago\.$/;
const NUMBER = /\d[\d,]*/g;

function durationUnit(unit: string, welcome: ReadonlyMap<string, string>): string {
    return welcome.get(`__duration.${unit}`) || unit;
}

function translateDuration(text: string, welcome: ReadonlyMap<string, string>): string {
    let found = false;
    const out = text.replace(DURATION_UNIT, (_m, amount: string, unit: string) => {
        found = true;
        return `${amount} ${durationUnit(unit, welcome)}`;
    });
    if (found) return out;
    return text.replace(SINGLE_DURATION_UNIT, (_m, _a: string, unit: string) => `1 ${durationUnit(unit, welcome)}`);
}

function isHansTimePlayed(lookup: string): boolean {
    return lookup.startsWith("You've spent") && lookup.includes("in the world since you arrived") && lookup.endsWith("ago.");
}

function translateHans(lookup: string, welcome: ReadonlyMap<string, string>): string | null {
    const template = welcome.get(HANS_TEMPLATE_KEY);
    if (!template) return null;
    const m = HANS.exec(lookup);
    let values: string[];
    let units: string[];
    if (m) {
        values = [m[1], m[3], m[5], m[7]];
        units = [m[2], m[4], m[6], m[8]];
    } else {
        values = [...(lookup.match(NUMBER) ?? [])];
        while (values.length < 4) values.push("");
        units = ["days", "hours", "minutes", "days"];
    }
    const u = units.map((unit) => durationUnit(unit, welcome));
    return template
        .replace("[daysInWorld]", values[0])
        .replace("[daysUnit]", u[0])
        .replace("[hoursInWorld]", values[1])
        .replace("[hoursUnit]", u[1])
        .replace("[minutesInWorld]", values[2])
        .replace("[minutesUnit]", u[2])
        .replace("[daysSinceArrival]", values[3])
        .replace("[daysSinceArrivalUnit]", u[3]);
}

/**
 * Hans's time-played line (any interface) and the welcome screen's last-login line, which carry
 * durations the dictionary's placeholders can't express.
 */
export function translateSpecialText(
    lookup: string,
    onWelcomeScreen: boolean,
    welcome: ReadonlyMap<string, string>,
): string | null {
    if (isHansTimePlayed(lookup)) return translateHans(lookup, welcome);
    if (!onWelcomeScreen) return null;
    const m = WELCOME_LAST_LOGIN.exec(lookup);
    if (!m) return null;
    const template = welcome.get(LAST_LOGIN_TEMPLATE);
    if (!template) return null;
    return template.replace("[value]", translateDuration(m[1], welcome));
}
