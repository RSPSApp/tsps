import { OverlayPosition } from "@runelite/client/ui/overlay/OverlayPosition";
import { drawTextGL } from "../../../widgets/components/TextRenderer";
import { FONT_PLAIN_11, FONT_PLAIN_12 } from "../../../ui/fonts";
import type { OverlayMenuEntry, WidgetOverlay, WidgetOverlayDrawContext } from "../ClientPluginManager";
import { StatusInfoPosition } from "./StatusInfoConfig";
import type { StatusInfoPlugin } from "./StatusInfoPlugin";

type Rgba = [number, number, number, number];
type Rect = { x: number; y: number; w: number; h: number };

/** One timer box: its icon (a cache sprite or an item) and the time left (or the ammo left). */
export type TimerEntry = { key: string; sprite?: number; item?: number; text: string; fallback: string };

/**
 * One stat boost: the skill's icon over its boosted level, with two bars beside it, each 0-1: the
 * time to the next stat restore, and the boost left out of the most it reached.
 */
export type BoostEntry = { key: string; sprite: number; text: string; restore: number; boost: number };

const rgba = (r: number, g: number, b: number, a = 255): Rgba => [r / 255, g / 255, b / 255, a / 255];

// The look of the game's own buff bar (interface 651), as measured from a screenshot of it.
/** Timer boxes: a see-through green edge, a dark green ring, a faint green tint inside. */
const TIMER_EDGE = rgba(0, 90, 0, 115);
const TIMER_RING = rgba(0, 48, 17);
const TIMER_FILL = rgba(0, 48, 17, 56);
/** Boost boxes: a light brown edge with a darker shadow right and below, on dark see-through brown. */
const BOOST_EDGE = rgba(90, 82, 69);
const BOOST_SHADOW = rgba(56, 48, 35);
const BOOST_FILL = rgba(35, 30, 25, 220);
/** The boost box's side bars: the time to the next restore (red), the boost left (green). */
const RESTORE_BAR = rgba(182, 105, 98);
const BOOST_BAR = rgba(115, 179, 90);
const WHITE = 0xffffff;
/** A boosted level's colour. */
const BOOSTED = 0x93ff7a;

/** Sizes at 100%, in layout units: the buff bar's own. */
const BOX = 34;
const GAP = 4;
/** The boost box's bar strip beside it, edges included, and the 1-unit shadow after each. */
const BAR_STRIP = 10;
const SHADOW = 1;
const BOOST_UNIT = BAR_STRIP + SHADOW + BOX + SHADOW;
/** Space above the bars inside the strip, below its top edge. */
const BAR_TOP = 4;
/** Skill icons are 25 units; items fill the box inside its two-unit edge. */
const SKILL_ICON = 25;
const ITEM_ICON = BOX - 4;
const MAX_COLUMNS = 10;
const ITEM_TEXTURE_PREFIX = "statusinfo-item:";

/** The overlay position for each corner. Top right is below the minimap, clear of it and its orbs. */
const POSITIONS: Record<StatusInfoPosition, (typeof OverlayPosition)[keyof typeof OverlayPosition]> = {
    [StatusInfoPosition.TOP_LEFT]: OverlayPosition.TOP_LEFT,
    [StatusInfoPosition.TOP_RIGHT]: OverlayPosition.BELOW_MINIMAP,
    [StatusInfoPosition.BOTTOM_LEFT]: OverlayPosition.BOTTOM_LEFT,
    [StatusInfoPosition.BOTTOM_RIGHT]: OverlayPosition.BOTTOM_RIGHT,
};

/** Seconds as the buff bar shows them: "45s" under a minute, "4:05" from a minute up. */
export function formatTimerSeconds(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * An amount as the buff bar's ammo count shows it, never more than there is: "950", "5.2k",
 * "52k", "1.2m". A tenth is shown only while it fits (under 10k and under 10m).
 */
export function formatQuantity(amount: number): string {
    const n = Math.max(0, Math.floor(amount));
    if (n < 1000) return String(n);
    const short = (value: number, unit: string) =>
        value < 10 ? `${Math.floor(value * 10) / 10}${unit}` : `${Math.floor(value)}${unit}`;
    if (n < 1_000_000) return short(n / 1000, "k");
    return short(n / 1_000_000, "m");
}

/** The scale option as a factor (50-400%). */
export function statusInfoScale(percent: unknown): number {
    const value = Number(percent);
    return Number.isFinite(value) ? Math.min(400, Math.max(50, value)) / 100 : 1;
}

/** How many of `count` items of `size` (with GAP between) fit across the canvas, at most MAX_COLUMNS. */
function columnsFor(count: number, size: number, gap: number, context: WidgetOverlayDrawContext): number {
    const fit = context.canvasCssWidth
        ? Math.max(1, Math.floor((context.canvasCssWidth / (context.hudScale ?? 1) - 16 + gap) / (size + gap)))
        : count;
    return Math.max(1, Math.min(MAX_COLUMNS, count, fit));
}

/**
 * Status Info's boxes, styled like the game's own buff bar: a row of stat boosts (each with its
 * restore and boost bars), then the timers and the ammo left. One movable overlay group, in the
 * corner the "Position" option picks (RuneLite's overlay corners: other overlays in the same
 * corner, such as Opponent Information top left or the Slayer Tracker bottom left, stack beside it
 * instead of under it). Each corner keeps its own Alt-drag position, so choosing a corner always
 * starts there.
 */
export class StatusInfoOverlay implements WidgetOverlay {
    private textureRenderer: unknown;
    /** Item icons made into textures, with the size of the image they came from. */
    private readonly textures = new Map<number, { texture: unknown; w: number; h: number }>();

    constructor(private readonly plugin: StatusInfoPlugin) {}

    get movable(): { name: string; position: (typeof OverlayPosition)[keyof typeof OverlayPosition] } {
        const corner = (this.plugin.config.position() as StatusInfoPosition) ?? StatusInfoPosition.TOP_RIGHT;
        return { name: `StatusInfoOverlay_${corner}`, position: POSITIONS[corner] ?? OverlayPosition.BELOW_MINIMAP };
    }

    menuEntries(): OverlayMenuEntry[] {
        return [{ option: "Configure", target: "Status Info overlay", onClick: () => this.plugin.openSettings() }];
    }

    private shown(): { boosts: BoostEntry[]; timers: TimerEntry[] } {
        if (!this.plugin.isEnabled()) return { boosts: [], timers: [] };
        return { boosts: this.plugin.boostEntries(), timers: this.plugin.timerEntries() };
    }

    signature(): string {
        const { boosts, timers } = this.shown();
        if (boosts.length === 0 && timers.length === 0) return "";
        // Bars change in whole bar units, so a redraw comes only when one would show.
        const step = (fraction: number) => Math.round(fraction * BOX);
        return JSON.stringify([
            this.plugin.config.position(), this.plugin.config.scale(),
            boosts.map((b) => [b.key, b.text, step(b.restore), step(b.boost)]),
            timers.map((e) => [e.key, e.text]),
        ]);
    }

    draw(context: WidgetOverlayDrawContext): Rect[] {
        const { boosts, timers } = this.shown();
        if (boosts.length === 0 && timers.length === 0) return [];
        const scale = statusInfoScale(this.plugin.config.scale());
        const box = BOX * scale, gap = GAP * scale, unit = BOOST_UNIT * scale, rowH = (BOX + SHADOW) * scale;
        const boostColumns = columnsFor(boosts.length, unit, gap, context);
        const timerColumns = columnsFor(timers.length, box, gap, context);
        const boostRows = boosts.length ? Math.ceil(boosts.length / boostColumns) : 0;
        const timerRows = timers.length ? Math.ceil(timers.length / timerColumns) : 0;
        const width = Math.max(
            boosts.length ? boostColumns * unit + (boostColumns - 1) * gap : 0,
            timers.length ? timerColumns * box + (timerColumns - 1) * gap : 0,
        );
        const rows = boostRows + timerRows;
        const height = boostRows * rowH + timerRows * box + (rows - 1) * gap;
        const at = context.place(this, width, height);
        if (!at) return [];
        const { scaleX: sx, scaleY: sy } = at;
        const rects: Rect[] = [];
        boosts.forEach((entry, i) => {
            const x = at.x + (i % boostColumns) * (unit + gap) * sx;
            const y = at.y + Math.floor(i / boostColumns) * (rowH + gap) * sy;
            rects.push(this.drawBoost(context, entry, x, y, scale, sx, sy));
        });
        const timersTop = at.y + boostRows * (rowH + gap) * sy;
        timers.forEach((entry, i) => {
            const r = {
                x: at.x + (i % timerColumns) * (box + gap) * sx,
                y: timersTop + Math.floor(i / timerColumns) * (box + gap) * sy,
                w: box * sx,
                h: box * sy,
            };
            this.timerFrame(context, r, sx, sy);
            const icon = ITEM_ICON * scale;
            this.icon(context, entry, r.x + ((box - icon) / 2) * sx, r.y + 2 * scale * sy, icon * sx, icon * sy);
            this.text(context, entry.text, r, FONT_PLAIN_11, WHITE, scale, sx, sy);
            rects.push(r);
        });
        return rects;
    }

    /** A boost: the bar strip and the box beside it, each with its shadow. Returns the area it covered. */
    private drawBoost(context: WidgetOverlayDrawContext, entry: BoostEntry, x: number, y: number,
        scale: number, sx: number, sy: number): Rect {
        const u = (n: number) => n * scale;
        const strip = { x, y, w: u(BAR_STRIP) * sx, h: u(BOX) * sy };
        const box = { x: x + u(BAR_STRIP + SHADOW) * sx, y, w: u(BOX) * sx, h: u(BOX) * sy };
        this.boostFrame(context, strip, sx * scale, sy * scale);
        this.boostFrame(context, box, sx * scale, sy * scale);
        // The bars: inside the strip's edge, below a gap at the top, rising from the bottom.
        const inner = { x: strip.x + u(1) * sx, w: u(BAR_STRIP - 2) * sx };
        const top = strip.y + u(1 + BAR_TOP) * sy, bottom = strip.y + strip.h - u(1) * sy;
        const bar = (fraction: number, x0: number, w: number, color: Rgba) => {
            const h = (bottom - top) * Math.min(1, Math.max(0, fraction));
            if (h > 0) context.renderer.drawRect(x0, bottom - h, w, h, color);
        };
        bar(entry.restore, inner.x, inner.w / 2, RESTORE_BAR);
        bar(entry.boost, inner.x + inner.w / 2, inner.w / 2, BOOST_BAR);
        const icon = u(SKILL_ICON);
        this.icon(context, { key: entry.key, sprite: entry.sprite, text: entry.text, fallback: "+" },
            box.x + ((u(BOX) - icon) / 2) * sx, box.y + u(3) * sy, icon * sx, icon * sy);
        this.text(context, entry.text, box, FONT_PLAIN_12, BOOSTED, scale, sx, sy);
        return { x, y, w: u(BOOST_UNIT) * sx, h: u(BOX + SHADOW) * sy };
    }

    /** Text along the bottom of a box, centred, with the game's black shadow. */
    private text(context: WidgetOverlayDrawContext, text: string, r: Rect, font: number, color: number,
        scale: number, sx: number, sy: number): void {
        const lineH = (font === FONT_PLAIN_11 ? 11 : 12) * scale;
        drawTextGL(context.renderer, context.fontLoader, text, r.x, r.y + r.h - (lineH + 3 * scale) * sy, r.w, lineH * sy,
            font, color, 1, 1, true, 1, undefined, sx * scale, sy * scale);
    }

    /** A timer box: the see-through green edge, the dark green ring, the faint tint inside. */
    private timerFrame(context: WidgetOverlayDrawContext, r: Rect, sx: number, sy: number): void {
        const glr = context.renderer;
        const scale = statusInfoScale(this.plugin.config.scale());
        const px = sx * scale, py = sy * scale;
        glr.drawRect(r.x + 2 * px, r.y + 2 * py, r.w - 4 * px, r.h - 4 * py, TIMER_FILL);
        this.outline(context, r, px, py, TIMER_EDGE);
        this.outline(context, { x: r.x + px, y: r.y + py, w: r.w - 2 * px, h: r.h - 2 * py }, px, py, TIMER_RING);
    }

    /** A boost box or bar strip: dark fill, a light edge, and a shadow just outside right and below. */
    private boostFrame(context: WidgetOverlayDrawContext, r: Rect, px: number, py: number): void {
        const glr = context.renderer;
        glr.drawRect(r.x + px, r.y + py, r.w - 2 * px, r.h - 2 * py, BOOST_FILL);
        this.outline(context, r, px, py, BOOST_EDGE);
        glr.drawRect(r.x + r.w, r.y, px, r.h + py, BOOST_SHADOW);
        glr.drawRect(r.x, r.y + r.h, r.w, py, BOOST_SHADOW);
    }

    /** A one-unit outline just inside the rect, its sides not overlapping (so see-through colours stay even). */
    private outline(context: WidgetOverlayDrawContext, r: Rect, px: number, py: number, color: Rgba): void {
        const glr = context.renderer;
        glr.drawRect(r.x, r.y, r.w, py, color);
        glr.drawRect(r.x, r.y + r.h - py, r.w, py, color);
        glr.drawRect(r.x, r.y + py, px, r.h - 2 * py, color);
        glr.drawRect(r.x + r.w - px, r.y + py, px, r.h - 2 * py, color);
    }

    /** The entry's sprite or item icon, fitted to the area; its fallback letter when it has neither. */
    private icon(context: WidgetOverlayDrawContext, entry: TimerEntry, x: number, y: number, w: number, h: number): void {
        const glr = context.renderer as any;
        const sprite = entry.sprite !== undefined ? context.sprite(entry.sprite) : undefined;
        const texture = sprite ? { texture: sprite, w: sprite.w, h: sprite.h }
            : entry.item !== undefined ? this.itemTexture(context, entry.item) : undefined;
        if (!texture || !(texture.w > 0) || !(texture.h > 0)) {
            drawTextGL(context.renderer, context.fontLoader, entry.fallback, x, y, w, h, FONT_PLAIN_12, 0xc8ec7f,
                1, 1, true, 1, undefined, w / ITEM_ICON, h / ITEM_ICON);
            return;
        }
        const fit = Math.min(w / texture.w, h / texture.h);
        const dw = texture.w * fit, dh = texture.h * fit;
        glr.drawTexture(texture.texture, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    }

    private itemTexture(context: WidgetOverlayDrawContext, itemId: number): { texture: unknown; w: number; h: number } | undefined {
        const renderer = context.renderer as any;
        if (this.textureRenderer !== renderer) {
            this.textures.clear();
            this.textureRenderer = renderer;
        }
        const cached = this.textures.get(itemId);
        if (cached) return cached;
        const canvas = context.itemImage?.(itemId, 1, 1);
        if (!canvas || typeof renderer.createTextureFromCanvas !== "function") return undefined;
        const made = { texture: renderer.createTextureFromCanvas(`${ITEM_TEXTURE_PREFIX}${itemId}`, canvas), w: canvas.width, h: canvas.height };
        this.textures.set(itemId, made);
        return made;
    }
}
