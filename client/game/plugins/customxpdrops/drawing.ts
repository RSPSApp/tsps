import { resolveFontType, type OverlayFont } from "@runelite/client/ui/overlay/OverlayFonts";
import type { FontType } from "@runelite/client/config/FontType";
import { drawTextGL } from "../../../widgets/components/TextRenderer";
import { skillIconSprite } from "../../../rs/skill/skillIcons";
import type { WidgetOverlayDrawContext } from "../ClientPluginManager";
import { TextBackground } from "./CustomXpDropsConfig";
import {
    FAKE_SKILL_ICON_INDEX,
    HITSPLAT_ICON_INDEX,
    OVERALL,
    SKILL_INDICES,
    type TextPart,
} from "./xpDrops";

/** The drop's icons (XpDropOverlayManager): skill icons, the total's, and the hitsplats. */
const OVERALL_ICON_SPRITE = 898;
const OVERALL_ICON_FALLBACK = 222;
const RED_HITSPLAT_SPRITE = 1359;
const DARK_RED_HITSPLAT_SPRITE = 1631;
const FAKE_SKILL_ICON_SPRITE = 423;

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * A font as Java's FontMetrics measures it, in layout units: `k` turns a layout unit into
 * device pixels (a movable overlay's scale, or 1 over the scene).
 */
export class Pen {
    readonly font: OverlayFont;
    readonly rects: Rect[] = [];

    constructor(readonly context: WidgetOverlayDrawContext, fontType: FontType, readonly k: number) {
        this.font = resolveFontType(fontType);
    }

    private bitmap() {
        return this.context.fontLoader(this.font.id);
    }

    width(text: string): number {
        const font = this.bitmap();
        return (font ? font.measure(text) : text.length * 7) * this.font.scale;
    }

    /** FontMetrics.getMaxAscent. */
    get ascent(): number {
        const font = this.bitmap();
        return (font ? font.maxAscent || font.ascent : 12) * this.font.scale;
    }

    /** FontMetrics.getHeight. */
    get height(): number {
        const font = this.bitmap();
        return font ? ((font.maxAscent || font.ascent) + (font.maxDescent || 0)) * this.font.scale : 16 * this.font.scale;
    }

    /** As Java's String.replaceAll("[0-9]", widest digit): numbers that don't jitter as they change. */
    monospacedWidth(text: string): number {
        let widest = "0";
        for (const digit of "1234567890") if (this.width(digit) >= this.width(widest)) widest = digit;
        return this.width(text.replace(/[0-9]/g, widest));
    }

    private grow(x: number, y: number, w: number, h: number): void {
        this.rects.push({ x: x - 2, y: y - 2, w: w + 4, h: h + 4 });
    }

    /**
     * TextComponentWithAlpha: each part in its colour from the baseline at (x, y), device pixels,
     * its alpha the lower of the colour's and `alpha` (0-255), over a shadow or outline.
     */
    text(parts: TextPart[], x: number, y: number, alpha: number, background: TextBackground): number {
        const scale = this.font.scale * this.k;
        const top = y - this.ascent * this.k;
        const h = this.height * this.k + 4;
        let cx = x;
        for (const part of parts) {
            const w = this.width(part.text) * this.k;
            const colorAlpha = (part.color >>> 24) & 0xff;
            const a = Math.min(colorAlpha === 0 ? 0xff : colorAlpha, alpha) / 255;
            if (a > 0 && part.text) {
                const draw = (dx: number, dy: number, color: number) => drawTextGL(this.context.renderer, this.context.fontLoader,
                    part.text, cx + dx, top + dy, w + 8, h, this.font.id, color, 0, 0, false, a, undefined, scale, scale);
                const one = this.k;
                if (background === TextBackground.SHADOW) draw(one, one, 0);
                if (background === TextBackground.OUTLINE) {
                    draw(0, one, 0);
                    draw(0, -one, 0);
                    draw(one, 0, 0);
                    draw(-one, 0, 0);
                }
                draw(0, 0, part.color & 0xffffff);
            }
            cx += w;
        }
        this.grow(x, top, cx - x, h);
        return cx - x;
    }

    /** A sprite at (x, y) device pixels, `w` x `h` layout units; right to left draws it left of x. */
    icon(spriteId: number, x: number, y: number, w: number, h: number, alpha: number, rightToLeft: boolean): void {
        const sprite = this.context.sprite(spriteId);
        if (!sprite) return;
        const dx = rightToLeft ? w * this.k : 0;
        const yOffset = (this.height / 2 - h / 2) * this.k;
        (this.context.renderer as any).drawTexture(sprite, x - dx, y + yOffset, w * this.k, h * this.k,
            1, 1, 0, [0, 0, 0], false, false, alpha);
        this.grow(x - dx, y + yOffset, w * this.k, h * this.k);
    }

    spriteSize(spriteId: number): { w: number; h: number } | undefined {
        const sprite = this.context.sprite(spriteId);
        return sprite ? { w: sprite.w, h: sprite.h } : undefined;
    }
}

/** A skill's icon (SkillId, or OVERALL for the total's). */
export function statIconSprite(pen: Pen, skill: number): number {
    if (skill !== OVERALL) return skillIconSprite(skill);
    return pen.spriteSize(OVERALL_ICON_SPRITE) ? OVERALL_ICON_SPRITE : OVERALL_ICON_FALLBACK;
}

type Icon = { sprite: number; w: number; h: number };

/** The icons a drop's flags draw, right to left over the priority bits as drawIcons walks them. */
function iconsOf(pen: Pen, icons: number, iconSizeOverride: number, self: boolean): Icon[] {
    const iconSize = iconSizeOverride > 0 ? iconSizeOverride : pen.height;
    const out: Icon[] = [];
    for (let i = SKILL_INDICES.length - 1; i >= 0; i--) {
        if (((icons >> i) & 1) !== 1) continue;
        const sprite = statIconSprite(pen, SKILL_INDICES[i]);
        const size = pen.spriteSize(sprite);
        if (!size) continue;
        const s = Math.max(iconSize, 18);
        out.push({ sprite, w: Math.trunc((size.w * s) / 25), h: Math.trunc((size.h * s) / 25) });
    }
    const small = Math.max(iconSize - 4, 14);
    if (((icons >> FAKE_SKILL_ICON_INDEX) & 1) === 1) out.push({ sprite: FAKE_SKILL_ICON_SPRITE, w: small, h: small });
    if (((icons >> HITSPLAT_ICON_INDEX) & 1) === 1) {
        out.push({ sprite: self ? RED_HITSPLAT_SPRITE : DARK_RED_HITSPLAT_SPRITE, w: small, h: small });
    }
    return out;
}

/** getIconWidthForIcons, in layout units. */
export function iconsWidth(pen: Pen, icons: number, iconSizeOverride: number): number {
    return iconsOf(pen, icons, iconSizeOverride, true).reduce((width, icon) => width + icon.w + 2, 0);
}

/**
 * drawIcons: from (x, y) device pixels (y the line's top), left to right or right to left;
 * returns the width drawn in layout units.
 */
export function drawIcons(pen: Pen, icons: number, x: number, y: number, alpha: number, rightToLeft: boolean,
    iconSizeOverride: number): number {
    let width = 0;
    for (const icon of iconsOf(pen, icons, iconSizeOverride, true)) {
        pen.icon(icon.sprite, x, y, icon.w, icon.h, alpha / 0xff, rightToLeft);
        x += (rightToLeft ? -1 : 1) * (icon.w + 2) * pen.k;
        width += icon.w + 2;
    }
    return width;
}

export function plainText(parts: TextPart[]): string {
    return parts.map((part) => part.text).join("");
}
