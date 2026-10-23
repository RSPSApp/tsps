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

const DEFINITION_PREFIX = "<str_";
const NAME = /^[a-z0-9_]+$/i;
const MAX_CACHED = 256;

const resolved = new Map<string, string>();

/** The text with every `<str_name=value>` definition removed and every `<str_name>` replaced. */
export function resolveTextTemplates(text: string): string {
    if (!text || text.indexOf(DEFINITION_PREFIX) === -1) return text;
    const cached = resolved.get(text);
    if (cached !== undefined) return cached;

    const values = new Map<string, string>();
    let stripped = "";
    let i = 0;
    while (i < text.length) {
        const start = text.indexOf(DEFINITION_PREFIX, i);
        if (start === -1) break;
        const equals = text.indexOf("=", start);
        const close = text.indexOf(">", start);
        const name = equals === -1 ? "" : text.slice(start + DEFINITION_PREFIX.length, equals);
        if (equals === -1 || (close !== -1 && close < equals) || !NAME.test(name)) {
            // A reference (or not a template at all): kept for the second pass.
            stripped += text.slice(i, start + 1);
            i = start + 1;
            continue;
        }
        const end = valueEnd(text, equals + 1);
        if (end === -1) break;
        stripped += text.slice(i, start);
        values.set(name.toLowerCase(), text.slice(equals + 1, end));
        i = end + 1;
    }
    stripped += text.slice(i);

    const out = stripped.replace(/<str_([a-z0-9_]+)>/gi, (_tag, name: string) => values.get(name.toLowerCase()) ?? "");
    if (resolved.size >= MAX_CACHED) resolved.delete(resolved.keys().next().value as string);
    resolved.set(text, out);
    return out;
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
