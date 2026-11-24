/**
 * Text templates in client script strings (rev 241, 2026-10-20 cache on): `<str_name=value>`
 * defines a value and draws nothing, and `<str_name>` draws it, so a script can name a quest once
 * and place it inside its markup:
 *
 *     <str_quest_name_0=Dragon Slayer II>Requires <col=ff981f><str_quest_name_0></col>
 *
 * A value may hold tags of its own. A reference with no definition draws nothing, as unknown
 * tags do. `<str>` (strikethrough) is a different tag and is left alone.
 */

const DEFINITION_PREFIX = "<str";
/** A template name follows "str" directly: `<str_quest=...>`, `<str0=...>`. `<str>` and `<str=colour>` are strikethrough. */
const NAME = /^[a-z0-9_]+$/i;
const MAX_CACHED = 256;

const resolved = new Map<string, string>();

/**
 * Text macros: a script names a piece of text once (`translations_set("or4", "<col=ff981f>")`)
 * and any text drawn or measured afterwards may place it as `@or4@`. A name no script has set
 * draws nothing. `<at>` is the escape for a literal @.
 */
const macros = new Map<string, string>();
const MACRO_NAME = /^[a-z0-9_]+$/i;
const MAX_MACRO_EXPANSIONS = 64;

export function setTextMacro(name: string, value: string): void {
    macros.set(String(name).toLowerCase(), String(value));
    resolved.clear();
}

export function clearTextMacros(): void {
    macros.clear();
    resolved.clear();
}

/** The text with every `@name@` outside a tag replaced by its macro (or by nothing). */
export function expandTextMacros(text: string): string {
    if (!text || text.indexOf("@") === -1) return text;
    let out = "";
    let rest = text;
    let expansions = 0;
    for (let i = 0; i < rest.length; i++) {
        const ch = rest.charCodeAt(i);
        if (ch === 60 /* < */) {
            // A tag is copied as it stands.
            const close = rest.indexOf(">", i);
            if (close !== -1) {
                out += rest.slice(i, close + 1);
                i = close;
                continue;
            }
        } else if (ch === 64 /* @ */ && expansions < MAX_MACRO_EXPANSIONS) {
            const end = rest.indexOf("@", i + 1);
            if (end > i + 1) {
                const name = rest.slice(i + 1, end);
                if (MACRO_NAME.test(name)) {
                    // The replacement is read again, so a macro may hold tags and other macros.
                    rest = (macros.get(name.toLowerCase()) ?? "") + rest.slice(end + 1);
                    i = -1;
                    expansions++;
                    continue;
                }
            }
        }
        out += rest[i];
    }
    return out;
}

/**
 * Text as it is drawn and measured: macros placed, every `<strNAME=value>` definition removed,
 * every `<strNAME>` replaced, and `<at>` turned into @.
 */
export function resolveTextTemplates(text: string): string {
    return resolveText(text, false);
}

function resolveText(text: string, keepEscapes: boolean, placeMacros = true): string {
    if (!text) return text;
    if (text.indexOf(DEFINITION_PREFIX) === -1 && text.indexOf("@") === -1 && text.indexOf("<at>") === -1) return text;
    const cached = keepEscapes ? undefined : resolved.get(text);
    if (cached !== undefined) return cached;

    const source = placeMacros ? expandTextMacros(text) : text;
    const values = new Map<string, string>();
    let stripped = "";
    let i = 0;
    while (i < source.length) {
        const start = source.indexOf(DEFINITION_PREFIX, i);
        if (start === -1) break;
        const equals = source.indexOf("=", start);
        const close = source.indexOf(">", start);
        const name = equals === -1 ? "" : source.slice(start + DEFINITION_PREFIX.length, equals);
        if (equals === -1 || (close !== -1 && close < equals) || !NAME.test(name)) {
            // A reference (or not a template at all): kept for the second pass.
            stripped += source.slice(i, start + 1);
            i = start + 1;
            continue;
        }
        const end = valueEnd(source, equals + 1);
        if (end === -1) break;
        stripped += source.slice(i, start);
        values.set(name.toLowerCase(), source.slice(equals + 1, end));
        i = end + 1;
    }
    stripped += source.slice(i);

    // Only a name that was defined is a reference: `<str>` alone is strikethrough.
    const placed = stripped.replace(/<str([a-z0-9_]+)>/gi, (tag, name: string) =>
        values.has(name.toLowerCase()) ? values.get(name.toLowerCase())! : name.startsWith("_") ? "" : tag);
    const out = keepEscapes ? placed : placed.replace(/<at>/g, "@");
    if (!keepEscapes) {
        if (resolved.size >= MAX_CACHED) resolved.delete(resolved.keys().next().value as string);
        resolved.set(text, out);
    }
    return out;
}

/** Templates placed, with macros and `<at>` left as they are (for code that strips markup next). */
export function resolveTextTemplatesKeepingEscapes(text: string): string {
    return resolveText(text, true, false);
}

/** The `>` that closes a definition whose value starts at `from`, skipping tags inside it. */
function valueEnd(text: string, from: number): number {
    let depth = 0;
    for (let i = from; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        if (ch === 60 /* < */) depth++;
        else if (ch === 62 /* > */) {
            if (depth === 0) return i;
            depth--;
        }
    }
    return -1;
}
