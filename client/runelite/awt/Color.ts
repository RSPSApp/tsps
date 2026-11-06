/**
 * java.awt.Color for ported plugins: sRGB components with alpha, the standard constants, `decode`,
 * `darker`/`brighter` and `getRGB` (0xAARRGGBB as a signed int, as Java returns it).
 */
export class Color {
    private readonly value: number;

    constructor(r: number, g: number, b: number, a: number = 255) {
        const clamp = (c: number) => Math.max(0, Math.min(255, c | 0));
        this.value = ((clamp(a) << 24) | (clamp(r) << 16) | (clamp(g) << 8) | clamp(b)) | 0;
    }

    /** A colour from a packed 0xAARRGGBB int; without `hasAlpha` the alpha is 255 (Java's Color(int, boolean)). */
    static fromArgb(argb: number, hasAlpha = true): Color {
        const v = argb >>> 0;
        return new Color((v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff, hasAlpha ? v >>> 24 : 255);
    }

    /** Java's Color.decode: "#RRGGBB" (or any form Integer.decode takes) to an opaque colour. */
    static decode(text: string): Color {
        const trimmed = text.trim();
        const digits = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed.replace(/^0x/i, "");
        const rgb = parseInt(digits, 16);
        if (!Number.isFinite(rgb)) throw new Error(`Color.decode: ${text}`);
        return new Color((rgb >>> 16) & 0xff, (rgb >>> 8) & 0xff, rgb & 0xff, 255);
    }

    getRed(): number {
        return (this.value >>> 16) & 0xff;
    }

    getGreen(): number {
        return (this.value >>> 8) & 0xff;
    }

    getBlue(): number {
        return this.value & 0xff;
    }

    getAlpha(): number {
        return this.value >>> 24;
    }

    /** 0xAARRGGBB as a signed 32-bit int, as java.awt.Color.getRGB returns it. */
    getRGB(): number {
        return this.value;
    }

    /** Java's darker(): each component scaled by 0.7, alpha kept. */
    darker(): Color {
        const factor = 0.7;
        return new Color(
            Math.max(0, Math.floor(this.getRed() * factor)),
            Math.max(0, Math.floor(this.getGreen() * factor)),
            Math.max(0, Math.floor(this.getBlue() * factor)),
            this.getAlpha(),
        );
    }

    /** Java's brighter(): each component divided by 0.7 (black becomes a dark grey), alpha kept. */
    brighter(): Color {
        const factor = 0.7;
        let r = this.getRed(), g = this.getGreen(), b = this.getBlue();
        const i = Math.floor(1 / (1 - factor));
        if (r === 0 && g === 0 && b === 0) return new Color(i, i, i, this.getAlpha());
        if (r > 0 && r < i) r = i;
        if (g > 0 && g < i) g = i;
        if (b > 0 && b < i) b = i;
        return new Color(Math.min(255, Math.floor(r / factor)), Math.min(255, Math.floor(g / factor)), Math.min(255, Math.floor(b / factor)), this.getAlpha());
    }

    equals(other: Color | null | undefined): boolean {
        return !!other && other.value === this.value;
    }

    /** The renderer's [r, g, b, a] floats. */
    toRgba(): [number, number, number, number] {
        return [this.getRed() / 255, this.getGreen() / 255, this.getBlue() / 255, this.getAlpha() / 255];
    }

    toString(): string {
        return `Color(${this.getRed()}, ${this.getGreen()}, ${this.getBlue()}, ${this.getAlpha()})`;
    }

    static readonly WHITE = new Color(255, 255, 255);
    static readonly LIGHT_GRAY = new Color(192, 192, 192);
    static readonly GRAY = new Color(128, 128, 128);
    static readonly DARK_GRAY = new Color(64, 64, 64);
    static readonly BLACK = new Color(0, 0, 0);
    static readonly RED = new Color(255, 0, 0);
    static readonly PINK = new Color(255, 175, 175);
    static readonly ORANGE = new Color(255, 200, 0);
    static readonly YELLOW = new Color(255, 255, 0);
    static readonly GREEN = new Color(0, 255, 0);
    static readonly MAGENTA = new Color(255, 0, 255);
    static readonly CYAN = new Color(0, 255, 255);
    static readonly BLUE = new Color(0, 0, 255);
}
