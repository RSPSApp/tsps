/**
 * RuneLite's `FontType`: a font family, a size in points and a bold style, as the overlay font
 * settings store it. Italic is left out. Stored as JSON, as RuneLite's FontTypeSerializer does,
 * and the legacy enum names ("REGULAR", "BOLD", "SMALL") still read.
 */
export class FontType {
    /** FontManager's built-in families, the dropdown's options. */
    static readonly RUNESCAPE = "RuneScape";
    static readonly RUNESCAPE_SMALL = "RuneScape Small";
    static readonly FAMILIES: readonly string[] = [FontType.RUNESCAPE, FontType.RUNESCAPE_SMALL];
    /** The size the cache fonts are drawn at unscaled (RuneLite's built-in fonts are 16pt). */
    static readonly DEFAULT_SIZE = 16;
    static readonly MIN_SIZE = 1;
    static readonly MAX_SIZE = 64;

    static readonly REGULAR = new FontType(FontType.RUNESCAPE, FontType.DEFAULT_SIZE, false);
    static readonly BOLD = new FontType(FontType.RUNESCAPE, FontType.DEFAULT_SIZE, true);
    static readonly SMALL = new FontType(FontType.RUNESCAPE_SMALL, FontType.DEFAULT_SIZE, false);

    constructor(
        readonly family: string,
        readonly size: number,
        readonly bold: boolean,
    ) {}

    withFamily(family: string): FontType {
        return new FontType(family, this.size, this.bold);
    }

    withSize(size: number): FontType {
        return new FontType(this.family, FontType.clampSize(size), this.bold);
    }

    withBold(bold: boolean): FontType {
        return new FontType(this.family, this.size, bold);
    }

    equals(other: FontType): boolean {
        return this.family === other.family && this.size === other.size && this.bold === other.bold;
    }

    toString(): string {
        return JSON.stringify({ family: this.family, size: this.size, bold: this.bold });
    }

    static clampSize(size: number): number {
        if (!Number.isFinite(size)) return FontType.DEFAULT_SIZE;
        return Math.max(FontType.MIN_SIZE, Math.min(FontType.MAX_SIZE, Math.round(size)));
    }

    /** FontTypeSerializer.deserialize; anything unreadable gives `fallback`. */
    static parse(raw: string, fallback: FontType): FontType {
        if (raw === "REGULAR") return FontType.REGULAR;
        if (raw === "BOLD") return FontType.BOLD;
        if (raw === "SMALL") return FontType.SMALL;
        try {
            const json = JSON.parse(raw);
            if (!json || typeof json !== "object") return fallback;
            const family = FontType.FAMILIES.includes(json.family) ? json.family : fallback.family;
            const size = typeof json.size === "number" ? FontType.clampSize(json.size) : fallback.size;
            const bold = typeof json.bold === "boolean" ? json.bold : fallback.bold;
            return new FontType(family, size, bold);
        } catch {
            return fallback;
        }
    }
}
