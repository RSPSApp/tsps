import { GameState } from "@runelite/api/GameState";
import { toRuneLiteGameState } from "../../../runelite/impl/GameStateMapping";
import { getServerTickPhaseNow } from "../../../network/serverConnection/timing";
import { FONT_PLAIN_12 } from "../../../ui/fonts";
import { drawTextGL } from "../../../widgets/components/TextRenderer";
import type { WidgetOverlay, WidgetOverlayDrawContext } from "../ClientPluginManager";
import type { GroundItemsPlugin, ItemBox } from "./GroundItemsPlugin";
import { tileKey } from "./GroundItemsPlugin";
import { type GroundItem, itemLabel } from "./groundItemRules";

type Rgba = [number, number, number, number];
type Point = [number, number];
type Rect = { x: number; y: number; w: number; h: number };

/** RuneLite's GroundItemsOverlay constants (local units and pixels). */
export const MAX_DISTANCE = 2500;
export const OFFSET_Z = 20;
export const STRING_GAP = 15;
export const RECTANGLE_SIZE = 8;
export const TIMER_OVERLAY_DIAMETER = 10;
const FONT = FONT_PLAIN_12;
const PUBLIC_TIMER_COLOR = 0xffffff00;
const PRIVATE_TIMER_COLOR = 0xff00ff00;
const RED = 0xffff0000;
const GREEN = 0xff00ff00;
/** ComponentConstants.STANDARD_BACKGROUND_COLOR and BackgroundComponent's borders. */
const BACKGROUND: Rgba = [70 / 255, 61 / 255, 50 / 255, 156 / 255];
const BACKGROUND_OUTSIDE: Rgba = [56 / 255, 48 / 255, 35 / 255, 1];
const BACKGROUND_INSIDE: Rgba = [90 / 255, 82 / 255, 69 / 255, 1];
const TILE_FILL: Rgba = [0, 0, 0, 50 / 255];
const BLACK: Rgba = [0, 0, 0, 1];
const WHITE: Rgba = [1, 1, 1, 1];

type Text = { text: string; x: number; y: number; color: number; outline: boolean };
type Box = { rect: Rect; color: number; filled: boolean; plus: boolean };
type Pie = { x: number; y: number; progress: number; color: number };
type Frame = {
    tiles: { points: Point[]; color: number }[];
    backgrounds: Rect[];
    boxes: Box[];
    pies: Pie[];
    texts: Text[];
    signature: string;
};

export function argbToRgba(argb: number): Rgba {
    return [((argb >>> 16) & 255) / 255, ((argb >>> 8) & 255) / 255, (argb & 255) / 255, ((argb >>> 24) & 255) / 255];
}

const contains = (r: Rect | undefined, x: number, y: number) => !!r && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

/**
 * RuneLite's GroundItemsOverlay, drawn in 2D over the scene and under interfaces: item labels
 * with prices, stacked 15 px apart per tile, despawn timers (text or pie), highlighted tiles and
 * the hotkey mode's hidden/highlight boxes.
 */
/** The device rects each frame element paints, shared by draw() and coverage(). */
const TEXT_HEIGHT = 16;
const tileRect = (tile: Frame["tiles"][number]): Rect => bounds(tile.points, 2);
const backgroundRect = (r: Rect): Rect => ({ x: r.x - 2, y: r.y - 2, w: r.w + 4, h: r.h + 4 });
const boxRect = (box: Box): Rect => ({ x: box.rect.x - 1, y: box.rect.y - 1, w: box.rect.w + 3, h: box.rect.h + 3 });
const pieRect = (pie: Pie): Rect => {
    const r = TIMER_OVERLAY_DIAMETER / 2;
    return { x: pie.x - r - 1, y: pie.y - r - 1, w: 2 * r + 2, h: 2 * r + 2 };
};
const textRect = (t: Text, width: number): Rect => ({ x: t.x - 2, y: t.y - TEXT_HEIGHT, w: width + 6, h: TEXT_HEIGHT + 6 });

type LabelCacheEntry = { mode: string; quantity: number; gePrice: number; haPrice: number; text: string };

export class GroundItemsOverlay implements WidgetOverlay {
    readonly drawBelowWidgets = true;
    /** The frame signature() built, drawn (possibly more than once) by the following draw(). */
    private frame?: Frame;
    private readonly modelHeights = new Map<number, number>();
    /**
     * Each item's label as last formatted. The plugin rebuilds its items when the ground or the
     * prices change, so a stale entry falls away with its item; the mode and the numbers the text
     * reads are still checked, as the label is otherwise reformatted every frame for every item.
     */
    private readonly labels = new WeakMap<GroundItem, LabelCacheEntry>();
    /** The draw's font loader, for measuring labels while laying out the next frame. */
    private fontLoader?: WidgetOverlayDrawContext["fontLoader"];

    constructor(private readonly plugin: GroundItemsPlugin) {}

    signature(): string {
        this.frame = this.build();
        return this.frame.signature;
    }

    /**
     * Where the frame signature() built will draw, so a label that moved redraws its old and new
     * rects rather than the whole UI. Unknown until a draw has supplied the font.
     */
    coverage(): Rect[] | undefined {
        const frame = this.frame ?? (this.frame = this.build());
        const font = frame.texts.length > 0 ? this.fontLoader?.(FONT) : undefined;
        if (frame.texts.length > 0 && !font) return undefined;
        const rects: Rect[] = [];
        for (const tile of frame.tiles) rects.push(tileRect(tile));
        for (const r of frame.backgrounds) rects.push(backgroundRect(r));
        for (const box of frame.boxes) rects.push(boxRect(box));
        for (const pie of frame.pies) rects.push(pieRect(pie));
        for (const t of frame.texts) rects.push(textRect(t, font!.measure(t.text)));
        return rects;
    }

    draw(context: WidgetOverlayDrawContext): Rect[] {
        const frame = this.frame ?? (this.frame = this.build());
        this.fontLoader = context.fontLoader;
        const glr = context.renderer as any;
        const rects: Rect[] = [];
        for (const tile of frame.tiles) {
            glr.drawPolygon?.(tile.points, TILE_FILL);
            glr.drawPolyline?.(tile.points, 2, argbToRgba(tile.color), true);
            rects.push(tileRect(tile));
        }
        for (const r of frame.backgrounds) {
            glr.drawRect?.(r.x, r.y, r.w, r.h, BACKGROUND);
            strokeRect(glr, { x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 }, BACKGROUND_OUTSIDE);
            strokeRect(glr, r, BACKGROUND_INSIDE);
            rects.push(backgroundRect(r));
        }
        for (const box of frame.boxes) {
            drawItemBox(glr, box);
            rects.push(boxRect(box));
        }
        for (const pie of frame.pies) {
            const r = TIMER_OVERLAY_DIAMETER / 2;
            const color = argbToRgba(pie.color);
            if (pie.progress > 0) glr.drawPolygon?.(sector(pie.x, pie.y, r, pie.progress), color);
            glr.drawPolyline?.(circle(pie.x, pie.y, r), 1, color, true);
            rects.push(pieRect(pie));
        }
        for (const t of frame.texts) {
            const font = context.fontLoader(FONT);
            const w = font ? font.measure(t.text) : t.text.length * 7;
            const h = TEXT_HEIGHT;
            const alpha = ((t.color >>> 24) & 255) / 255;
            const rgb = t.color & 0xffffff;
            // The point is the text baseline, as Graphics.drawString takes it.
            const draw = (dx: number, dy: number, color: number, shadow: boolean) =>
                drawTextGL(context.renderer, context.fontLoader, t.text, t.x + dx, t.y - h + 3 + dy, w + 4, h, FONT, color, 0, 2, shadow, alpha);
            if (t.outline) {
                draw(0, 1, 0, false);
                draw(0, -1, 0, false);
                draw(1, 0, 0, false);
                draw(-1, 0, 0, false);
                draw(0, 0, rgb, false);
            } else {
                draw(0, 0, rgb, true);
            }
            rects.push(textRect(t, w));
        }
        return rects;
    }

    private label(item: GroundItem, priceMode: string): string {
        const cached = this.labels.get(item);
        if (
            cached &&
            cached.mode === priceMode &&
            cached.quantity === item.quantity &&
            cached.gePrice === item.gePrice &&
            cached.haPrice === item.haPrice
        ) {
            return cached.text;
        }
        const text = itemLabel(item, priceMode);
        this.labels.set(item, { mode: priceMode, quantity: item.quantity, gePrice: item.gePrice, haPrice: item.haPrice, text });
        return text;
    }

    private build(): Frame {
        const frame: Frame = { tiles: [], backgrounds: [], boxes: [], pies: [], texts: [], signature: "" };
        const plugin = this.plugin;
        if (!plugin.isStarted()) return frame;
        const client: any = plugin.getClient();
        if (toRuneLiteGameState(client?.gameState) !== GameState.LOGGED_IN) return frame;
        const scene = client.sceneGeometry;
        const player = plugin.playerTile();
        if (!scene || !player) return frame;
        const config = plugin.config;
        const hotkey = plugin.hotKeyPressed;
        const mode = config.itemHighlightMode();
        const dontShowOverlay = (mode === "MENU" || mode === "NONE" || plugin.hideAll) && !hotkey;
        const highlightTiles = config.highlightTiles() === true;
        if (dontShowOverlay && !highlightTiles) {
            this.clearBoxes();
            return frame;
        }
        const priceMode = config.priceDisplayMode();
        const timers = config.groundItemTimers();
        const outline = config.textOutline() === true;
        const showHighlightedOnly = config.showHighlightedOnly() === true;
        const font = this.fontLoader?.(FONT);
        const measure = (text: string) => (font ? font.measure(text) : text.length * 6);
        const stringHeight = font ? Math.max(1, (font.maxAscent | 0) + (font.maxDescent | 0)) : 12;
        const [mouseX, mouseY] = plugin.input.mouse;
        const timing = getServerTickPhaseNow();
        const nowTick = timing.tick + Math.max(0, Math.min(0.999, timing.phase || 0));
        const tickMs = Math.max(1, timing.tickMs | 0);

        let items = [...plugin.groundItems().values()];
        const offsets = new Map<string, number>();
        const itemOffsets = new Map<string, number>();
        let top: GroundItem | undefined;
        if (hotkey) {
            for (const item of items) {
                const tile = tileKey(item.tile.x, item.tile.y, item.tile.level);
                const offset = offsets.has(tile) ? offsets.get(tile)! + 1 : 0;
                offsets.set(tile, offset);
                itemOffsets.set(item.key, offset);
                if (top) continue;
                for (const box of [plugin.textBox, plugin.hiddenBox, plugin.highlightBox]) {
                    if (box && box.item.key === item.key && contains(box, mouseX, mouseY)) {
                        top = item;
                        break;
                    }
                }
            }
            if (top) items = [...items.filter((i) => i !== top), top];
            offsets.clear();
        }
        this.clearBoxes();

        const layerHeights = new Map<string, number>();
        for (const item of items) {
            if (item.tile.level !== player.level) continue;
            const dx = item.tile.x * 128 + 64 - player.fineX;
            const dy = item.tile.y * 128 + 64 - player.fineY;
            if (Math.hypot(dx, dy) > MAX_DISTANCE || !plugin.displaysOwnership(item)) continue;
            const e = plugin.evaluate(item);
            if (e.highlighted === undefined && !hotkey) {
                if (e.hidden || showHighlightedOnly) continue;
            }
            const color = e.color;
            const tile = tileKey(item.tile.x, item.tile.y, item.tile.level);
            let layerHeight = layerHeights.get(tile);
            if (layerHeight === undefined) layerHeights.set(tile, (layerHeight = this.itemLayerHeight(items, item)));
            const cx = item.tile.x + 0.5;
            const cy = item.tile.y + 0.5;
            const ground = scene.tileHeight(cx, cy, item.tile.level);

            if (highlightTiles) {
                const points = tilePoly(scene, item.tile.x, item.tile.y, item.tile.level, layerHeight);
                if (points) frame.tiles.push({ points, color });
            }
            if (dontShowOverlay) continue;

            const text = this.label(item, priceMode);
            const p = scene.worldToScreen(cx, ground - (layerHeight + OFFSET_Z) / 128, cy);
            if (!p) continue;
            const textWidth = measure(text);
            const offset = hotkey
                ? itemOffsets.get(item.key) ?? 0
                : (offsets.set(tile, offsets.has(tile) ? offsets.get(tile)! + 1 : 0), offsets.get(tile)!);
            const textX = Math.round(p[0] - textWidth / 2);
            const textY = Math.round(p[1]) - STRING_GAP * offset;

            if (hotkey) {
                const itemBounds: Rect = { x: textX - 2, y: textY - stringHeight - 2, w: textWidth + 4, h: stringHeight + 4 };
                const hiddenRect: Rect = {
                    x: itemBounds.x + itemBounds.w + 2,
                    y: textY - Math.trunc((RECTANGLE_SIZE + stringHeight) / 2),
                    w: RECTANGLE_SIZE,
                    h: RECTANGLE_SIZE,
                };
                const highlightRect: Rect = { ...hiddenRect, x: hiddenRect.x + RECTANGLE_SIZE + 2 };
                const inBox = contains(itemBounds, mouseX, mouseY);
                const inHidden = contains(hiddenRect, mouseX, mouseY);
                const inHighlight = contains(highlightRect, mouseX, mouseY);
                if (inBox) plugin.textBox = { ...itemBounds, item } as ItemBox;
                else if (inHidden) plugin.hiddenBox = { ...hiddenRect, item } as ItemBox;
                else if (inHighlight) plugin.highlightBox = { ...highlightRect, item } as ItemBox;
                const isTop = top === item;
                if (isTop && (inBox || inHidden || inHighlight)) frame.backgrounds.push(itemBounds);
                frame.boxes.push({ rect: hiddenRect, color: isTop && inHidden ? RED : color, filled: e.hidden, plus: false });
                frame.boxes.push({ rect: highlightRect, color: isTop && inHighlight ? GREEN : color, filled: e.highlighted !== undefined, plus: true });
            }

            const despawn = item.despawnTick;
            const remainingTicks = despawn !== undefined ? despawn - nowTick : undefined;
            const timerColor = remainingTicks !== undefined && remainingTicks > 0
                ? (item.isPrivate || (item.visibleTick !== undefined && item.visibleTick > nowTick) ? PRIVATE_TIMER_COLOR : PUBLIC_TIMER_COLOR)
                : undefined;
            if (timers === "PIE") {
                // Left of the text, so it is drawn with the hotkey boxes too.
                const spawn = item.spawnTick;
                if (timerColor !== undefined && spawn !== undefined && despawn! > spawn) {
                    const percent = (nowTick - spawn) / (despawn! - spawn);
                    frame.pies.push({
                        x: textX - TIMER_OVERLAY_DIAMETER,
                        y: textY - TIMER_OVERLAY_DIAMETER / 2,
                        progress: Math.max(0, Math.min(1, 1 - percent)),
                        color: timerColor,
                    });
                }
            } else if ((timers === "SECONDS" || timers === "TICKS") && timerColor !== undefined) {
                const ms = remainingTicks! * tickMs;
                const timerText = timers === "SECONDS" ? ` - ${(ms / 1000).toFixed(1)}` : ` - ${Math.trunc(ms / 600)}`;
                // Its own colour, after the label (left out of the centring, which would jitter).
                frame.texts.push({ text: timerText, x: textX + textWidth, y: textY, color: timerColor, outline });
            }
            frame.texts.push({ text, x: textX, y: textY, color, outline });
        }

        const empty = frame.tiles.length + frame.texts.length + frame.boxes.length + frame.pies.length === 0;
        frame.signature = empty
            ? ""
            : JSON.stringify([
                frame.tiles.map((t) => [t.color, t.points.map(([x, y]) => [Math.round(x), Math.round(y)])]),
                frame.texts.map((t) => [t.text, t.x, t.y, t.color, t.outline]),
                frame.boxes.map((b) => [b.rect.x, b.rect.y, b.color, b.filled]),
                frame.pies.map((p) => [Math.round(p.x), Math.round(p.y), Math.round(p.progress * 100), p.color]),
                frame.backgrounds.map((r) => [r.x, r.y, r.w]),
            ]);
        return frame;
    }

    private clearBoxes(): void {
        this.plugin.textBox = this.plugin.hiddenBox = this.plugin.highlightBox = undefined;
    }

    /** The tile's item layer height: the tallest item model there (local units). */
    private itemLayerHeight(items: GroundItem[], at: GroundItem): number {
        let height = 0;
        for (const item of items) {
            if (item.tile.x !== at.tile.x || item.tile.y !== at.tile.y || item.tile.level !== at.tile.level) continue;
            height = Math.max(height, this.modelHeight(item.id));
        }
        return height;
    }

    private modelHeight(id: number): number {
        const cached = this.modelHeights.get(id);
        if (cached !== undefined) return cached;
        let height = 0;
        try {
            const client: any = this.plugin.getClient();
            const obj = client.objTypeLoader?.load?.(id);
            const model = obj && obj.model >= 0 ? client.modelLoader?.getModel?.(obj.model) : undefined;
            const ys: ArrayLike<number> | undefined = model?.verticesY;
            if (ys && model.verticesCount !== undefined) {
                let minY = 0;
                for (let i = 0; i < (model.verticesCount | 0); i++) if (ys[i] < minY) minY = ys[i];
                height = Math.round((-minY * (obj.resizeY ?? 128)) / 128);
            }
        } catch {}
        this.modelHeights.set(id, height);
        return height;
    }
}

/** Perspective.getCanvasTilePoly: the tile's corners, raised by zOffset (local units). */
function tilePoly(scene: any, x: number, y: number, level: number, zOffset: number): Point[] | undefined {
    const out: Point[] = [];
    for (const [cx, cy] of [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]] as const) {
        const p = scene.worldToScreen(cx, scene.tileHeight(cx, cy, level) - zOffset / 128, cy);
        if (!p) return undefined;
        out.push([p[0], p[1]]);
    }
    return out;
}

function bounds(points: Point[], pad: number): Rect {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const x = Math.min(...xs) - pad;
    const y = Math.min(...ys) - pad;
    return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
}

function strokeRect(glr: any, r: Rect, color: Rgba): void {
    const x0 = r.x + 0.5;
    const y0 = r.y + 0.5;
    glr.drawPolyline?.([[x0, y0], [x0 + r.w, y0], [x0 + r.w, y0 + r.h], [x0, y0 + r.h]], 1, color, true);
}

/** drawRectangle: a shadowed box, filled when the item is in that list, with a minus or a plus. */
function drawItemBox(glr: any, box: Box): void {
    const r = box.rect;
    strokeRect(glr, { x: r.x + 1, y: r.y + 1, w: r.w, h: r.h }, BLACK);
    const color = argbToRgba(box.color);
    strokeRect(glr, r, color);
    if (box.filled) glr.drawRect?.(r.x, r.y, r.w, r.h, color);
    const midY = r.y + Math.trunc(r.h / 2) + 0.5;
    glr.drawPolyline?.([[r.x + 2, midY], [r.x + r.w - 2 + 1, midY]], 1, WHITE, false);
    if (box.plus) {
        const midX = r.x + Math.trunc(r.w / 2) + 0.5;
        glr.drawPolyline?.([[midX, r.y + 2], [midX, r.y + r.h - 2 + 1]], 1, WHITE, false);
    }
}

function circle(x: number, y: number, r: number): Point[] {
    const points: Point[] = [];
    for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        points.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
    }
    return points;
}

/** ProgressPieComponent's arc: from 12 o'clock, anticlockwise, the given fraction of a turn. */
export function sector(x: number, y: number, r: number, progress: number): Point[] {
    const points: Point[] = [[x, y]];
    const steps = Math.max(2, Math.ceil(progress * 24));
    for (let i = 0; i <= steps; i++) {
        const a = Math.PI / 2 + (i / steps) * progress * Math.PI * 2;
        points.push([x + Math.cos(a) * r, y - Math.sin(a) * r]);
    }
    return points;
}
