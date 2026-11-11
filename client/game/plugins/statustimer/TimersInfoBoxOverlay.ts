import { OverlayPosition } from "@runelite/client/ui/overlay/OverlayPosition";
import { overlayFont } from "@runelite/client/ui/overlay/OverlayFonts";
import { drawTextGL } from "../../../widgets/components/TextRenderer";
import type { OverlayMenuEntry, WidgetOverlay, WidgetOverlayDrawContext } from "../ClientPluginManager";
import { TimersPosition } from "./TimersConfig";
import type { TimersPlugin } from "./TimersPlugin";

type Rgba = [number, number, number, number];
type Rect = { x: number; y: number; w: number; h: number };

/** One timer box: its icon (a cache sprite or an item) and the time left. */
export type TimerEntry = { key: string; sprite?: number; item?: number; text: string; fallback: string };

const rgba = (r: number, g: number, b: number, a = 255): Rgba => [r / 255, g / 255, b / 255, a / 255];
/** RuneLite's infobox background and outline, as the Boosts infoboxes draw them. */
const BACKGROUND = rgba(70, 61, 50, 156);
const OUTLINE = rgba(56, 48, 35, 255);
const WHITE = 0xffffff;
/**
 * The box at 100%: the combat row's infobox size (MobileHudLayout COMBAT_INFOBOX_SIZE, not imported:
 * that module imports TimersPlugin, which imports this one).
 */
const BOX = 28;
const GAP = 2;
const ICON = 22;
const MAX_COLUMNS = 10;
const ITEM_TEXTURE_PREFIX = "timers-item:";

/** The overlay position for each corner. Top right is below the minimap, clear of it and its orbs. */
const POSITIONS: Record<TimersPosition, (typeof OverlayPosition)[keyof typeof OverlayPosition]> = {
    [TimersPosition.TOP_LEFT]: OverlayPosition.TOP_LEFT,
    [TimersPosition.TOP_RIGHT]: OverlayPosition.BELOW_MINIMAP,
    [TimersPosition.BOTTOM_LEFT]: OverlayPosition.BOTTOM_LEFT,
    [TimersPosition.BOTTOM_RIGHT]: OverlayPosition.BOTTOM_RIGHT,
};

/** Seconds as the infobox shows them: "45" under a minute, "4:05" from a minute up. */
export function formatTimerSeconds(seconds: number): string {
    if (seconds < 60) return String(seconds);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The scale option as a factor (50-400%). */
export function timersScale(percent: unknown): number {
    const value = Number(percent);
    return Number.isFinite(value) ? Math.min(400, Math.max(50, value)) / 100 : 1.5;
}

/**
 * The Timers plugin's boxes as one movable overlay group, in the corner the "Position" option
 * picks (RuneLite's overlay corners: other overlays in the same corner, such as Opponent
 * Information top left or the Slayer Tracker bottom left, stack beside it instead of under it).
 * Each corner keeps its own Alt-drag position, so choosing a corner always starts there. The
 * mobile gameframe keeps its HTML boxes (StatusTimerOverlay), in the slots its layout gives them.
 */
export class TimersInfoBoxOverlay implements WidgetOverlay {
    private textureRenderer: unknown;
    /** Item icons made into textures, with the size of the image they came from. */
    private readonly textures = new Map<number, { texture: unknown; w: number; h: number }>();

    constructor(private readonly plugin: TimersPlugin) {}

    get movable(): { name: string; position: (typeof OverlayPosition)[keyof typeof OverlayPosition] } {
        const corner = (this.plugin.config.position() as TimersPosition) ?? TimersPosition.TOP_RIGHT;
        return { name: `TimersOverlay_${corner}`, position: POSITIONS[corner] ?? OverlayPosition.BELOW_MINIMAP };
    }

    menuEntries(): OverlayMenuEntry[] {
        return [{ option: "Configure", target: "Timers overlay", onClick: () => this.plugin.openSettings() }];
    }

    private entries(): TimerEntry[] {
        if (!this.plugin.isEnabled() || this.plugin.mobileGameframe()) return [];
        return this.plugin.timerEntries();
    }

    signature(): string {
        const list = this.entries();
        if (list.length === 0) return "";
        return JSON.stringify([this.plugin.config.position(), this.plugin.config.scale(), list.map((e) => [e.key, e.text])]);
    }

    draw(context: WidgetOverlayDrawContext): Rect[] {
        const list = this.entries();
        if (list.length === 0) return [];
        const scale = timersScale(this.plugin.config.scale());
        const box = BOX * scale, gap = GAP * scale;
        const fit = context.canvasCssWidth
            ? Math.max(1, Math.floor((context.canvasCssWidth / (context.hudScale ?? 1) - 16 + gap) / (box + gap)))
            : list.length;
        const columns = Math.min(MAX_COLUMNS, list.length, fit);
        const rows = Math.ceil(list.length / columns);
        const at = context.place(this, columns * box + (columns - 1) * gap, rows * box + (rows - 1) * gap);
        if (!at) return [];
        const { scaleX: sx, scaleY: sy } = at;
        const font = overlayFont("infobox");
        const textH = Math.round(12 * font.scale * scale);
        const rects: Rect[] = [];
        list.forEach((entry, i) => {
            const r = {
                x: at.x + (i % columns) * (box + gap) * sx,
                y: at.y + Math.floor(i / columns) * (box + gap) * sy,
                w: box * sx,
                h: box * sy,
            };
            this.frame(context, r, sx, sy);
            const icon = ICON * scale;
            this.icon(context, entry, r.x + ((box - icon) / 2) * sx, r.y + 2 * scale * sy, icon * sx, icon * sy, textH);
            drawTextGL(context.renderer, context.fontLoader, entry.text, r.x, r.y + r.h - (textH + scale) * sy, r.w, textH * sy,
                font.id, WHITE, 1, 1, true, 1, undefined, sx * font.scale * scale, sy * font.scale * scale);
            rects.push(r);
        });
        return rects;
    }

    private frame(context: WidgetOverlayDrawContext, r: Rect, sx: number, sy: number): void {
        const glr = context.renderer;
        glr.drawRect(r.x, r.y, r.w, r.h, BACKGROUND);
        glr.drawRect(r.x, r.y, r.w, sy, OUTLINE);
        glr.drawRect(r.x, r.y + r.h - sy, r.w, sy, OUTLINE);
        glr.drawRect(r.x, r.y + sy, sx, r.h - 2 * sy, OUTLINE);
        glr.drawRect(r.x + r.w - sx, r.y + sy, sx, r.h - 2 * sy, OUTLINE);
    }

    /** The entry's sprite or item icon, fitted to the box; its fallback letter when it has neither. */
    private icon(context: WidgetOverlayDrawContext, entry: TimerEntry, x: number, y: number, w: number, h: number, textH: number): void {
        const glr = context.renderer as any;
        const sprite = entry.sprite !== undefined ? context.sprite(entry.sprite) : undefined;
        const texture = sprite ? { texture: sprite, w: sprite.w, h: sprite.h }
            : entry.item !== undefined ? this.itemTexture(context, entry.item) : undefined;
        if (!texture || !(texture.w > 0) || !(texture.h > 0)) {
            drawTextGL(context.renderer, context.fontLoader, entry.fallback, x, y, w, h, overlayFont("infobox").id, 0xc8ec7f,
                1, 1, true, 1, undefined, (w / ICON) * (textH / 12), (h / ICON) * (textH / 12));
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
