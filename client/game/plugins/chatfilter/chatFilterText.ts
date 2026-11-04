/** RuneLite's Text helpers, as Chat Filter uses them. */

const TAG_REGEXP = /<([^>]*)>/g;

/** Text.unescapeJagex: tags dropped, the printable ones (lt, gt, br...) as their characters. */
export function unescapeJagex(text: string): string {
    return text.replace(TAG_REGEXP, (_tag, name: string) => {
        switch (name) {
            case "br":
            case "n":
                return "\n";
            case "lt":
                return "<";
            case "gt":
                return ">";
            case "at":
                return "@";
            case "nbh":
                return "-";
            default:
                return "";
        }
    });
}

/** Text.escapeJagex: <, >, @ and newlines as their tags, carriage returns dropped. */
export function escapeJagex(text: string): string {
    let out = "";
    for (const c of text) {
        if (c === "<") out += "<lt>";
        else if (c === ">") out += "<gt>";
        else if (c === "@") out += "<at>";
        else if (c === "\n") out += "<br>";
        else if (c !== "\r") out += c;
    }
    return out;
}

/** Text.JAGEX_PRINTABLE_CHAR_MATCHER.retainFrom: only the characters the game can draw. */
export function retainJagexPrintable(text: string): string {
    let out = "";
    for (const c of text) {
        const code = c.charCodeAt(0);
        if ((code >= 32 && code <= 126) || code === 128 || (code >= 160 && code <= 255)) out += c;
    }
    return out;
}

/** Text.sanitize: a name without its leading `<img=n>` icon, non-breaking spaces as spaces. */
export function sanitize(name: string): string {
    const cleaned = name.includes("<img") ? name.substring(name.lastIndexOf(">") + 1) : name;
    return cleaned.replace(/ /g, " ");
}

/**
 * StringUtils.stripAccents, one character at a time so the result is as long as the input (the
 * censor relies on it, as RuneLite asserts): é to e, and Ø and Ł to O and L as Commons Lang does.
 */
export function stripAccents(text: string): string {
    let out = "";
    for (const c of text) {
        if (c === "Ł") out += "L";
        else if (c === "ł") out += "l";
        else if (c === "Ø") out += "O";
        else if (c === "ø") out += "o";
        else {
            const stripped = c.normalize("NFD").replace(/[̀-ͯ]/g, "");
            out += stripped.length === c.length ? stripped : c;
        }
    }
    return out;
}

/** A pattern as a case-insensitive global RegExp, or null where it doesn't compile. */
export function compilePattern(pattern: string): RegExp | null {
    try {
        return new RegExp(pattern, "gi");
    } catch {
        return null;
    }
}

/** Pattern.quote: the text matched literally. */
export function quote(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
