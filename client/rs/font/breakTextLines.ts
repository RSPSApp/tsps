/**
 * What line breaking needs to know about a font. Character codes are single bytes (the font's
 * 256 glyphs); a non-breaking space measures as a space.
 */
export interface LineBreakMetrics {
    /** How far one character moves the pen. */
    advance(ch: number): number;
    /** The kerning between two neighbours; `prev` is 0 for the first character of a line. */
    kerning(prev: number, ch: number): number;
    /** The width of the icon `<img=id>` draws, or undefined when there is no such icon. */
    iconWidth(id: number): number | undefined;
}

const LT = 60;
const GT = 62;
const AT = 64;
const SPACE = 32;
const HYPHEN = 45;
const NBSP = 160;

/**
 * Breaks marked-up text into lines no wider than `maxWidth`, the way OSRS does for wrapped
 * text, paraheight and parawidth:
 *
 * - `<br>` and `<n>` end the line. The tag stays at the end of the line it closes, and text that
 *   ends with one has no empty line after it.
 * - A line may break after a space (the space is dropped) or after a "-" (the hyphen stays).
 *   The break happens when a character takes the line past the width, at the last such place;
 *   a line with no such place is left too long.
 * - Nothing else is trimmed: runs of spaces and spaces at the start of a line are kept.
 * - Tags take no width, except `<lt>`, `<gt>`, `<at>` (the character they draw), `<nbh>` (a
 *   hyphen that is no place to break) and `<img=N>` (the icon).
 * - A "<" that is never closed hides everything after it.
 *
 * Text templates and @macros@ are expected to be placed already.
 */
export function breakTextLines(text: string, maxWidth: number, metrics: LineBreakMetrics): string[] {
    const lines: string[] = [];
    if (!text) return lines;

    // `line` is everything since the last <br>; the current line starts at `lineStart` in it.
    let line = "";
    let lineStart = 0;
    let width = 0;
    let breakIndex = -1;
    let breakWidth = 0;
    let breakTrim = 0;
    let tagStart = -1;
    let last = 0;

    const measure = (ch: number): void => {
        const code = (ch === NBSP ? SPACE : ch) & 0xff;
        width += metrics.advance(code) + metrics.kerning(last, code);
        last = code;
    };

    for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        if (ch === LT) {
            tagStart = i;
            continue;
        }

        let drawn = ch !== 0;
        if (ch === GT && tagStart !== -1) {
            const tag = text.substring(tagStart + 1, i);
            tagStart = -1;
            drawn = false;
            line += `<${tag}>`;
            if (tag === "br" || tag === "n") {
                lines.push(line.substring(lineStart));
                line = "";
                lineStart = 0;
                width = 0;
                breakIndex = -1;
                last = 0;
            }
            if (tag === "lt") measure(LT);
            else if (tag === "gt") measure(GT);
            else if (tag === "at") measure(AT);
            else if (tag === "nbh") measure(HYPHEN);
            else if (tag.startsWith("img=")) {
                const id = /^[+-]?[0-9]+$/.test(tag.substring(4)) ? Number(tag.substring(4)) : NaN;
                const iconWidth = Number.isNaN(id) ? undefined : metrics.iconWidth(id);
                if (iconWidth !== undefined) {
                    width += iconWidth;
                    last = 0;
                }
            }
        }
        if (tagStart !== -1) continue;

        if (drawn) {
            line += text.charAt(i);
            measure(ch);
            if (ch === SPACE) {
                breakIndex = line.length;
                breakWidth = width;
                breakTrim = 1;
            }
        }

        if (width > maxWidth && breakIndex >= 0) {
            lines.push(line.substring(lineStart, breakIndex - breakTrim));
            lineStart = breakIndex;
            width -= breakWidth;
            breakIndex = -1;
            last = 0;
        }

        // A hyphen becomes a place to break only for the characters after it.
        if (drawn && ch === HYPHEN) {
            breakIndex = line.length;
            breakWidth = width;
            breakTrim = 0;
        }
    }

    if (line.length > lineStart) lines.push(line.substring(lineStart));
    return lines;
}
