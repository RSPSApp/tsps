import type { OsrsClient } from "../../../../../game/OsrsClient";
import type { WidgetOverlay, WidgetOverlayDrawContext } from "../../../../../game/plugins/ClientPluginManager";
import { drawTextGL } from "../../../../../widgets/components/TextRenderer";
import { Plugin, type PluginDescriptor } from "../../../plugins/Plugin";
import { CLIENT_TOKEN, inject } from "../../../plugins/PluginInjector";
import { overlayFont, overlayFontsVersion } from "../OverlayFonts";
import { type Tooltip, TooltipManager } from "./TooltipManager";

type Rgba = [number, number, number, number];
type Rect = { x: number; y: number; w: number; h: number };

const rgba = (r: number, g: number, b: number, a = 255): Rgba => [r / 255, g / 255, b / 255, a / 255];
/** ComponentConstants.STANDARD_BACKGROUND_COLOR and the panel outline. */
const BACKGROUND = rgba(70, 61, 50, 156);
const OUTLINE = rgba(56, 48, 35, 255);
const WHITE = 0xffffff;
/** TooltipOverlay's UNDER_OFFSET and PADDING. */
const UNDER_OFFSET = 24;
const PADDING = 2;
/** TooltipComponent's OFFSET, and the height of a line of the 16pt RuneScape font. */
const OFFSET = 4;
const LINE_HEIGHT = 14;
const BR = /<\/?br>/i;

/** A line's drawn width: colour tags take no room (TooltipComponent.calculateTextWidth). */
function textWidth(measure: (text: string) => number, line: string): number {
    return measure(line.replace(/<\/?col(?:=[0-9a-f]+)?>/gi, ""));
}

/**
 * RuneLite's TooltipOverlay and TooltipComponent: this frame's tooltips stacked under the cursor
 * (24 px below it), each a box with `<br>` lines and `<col>` colours, kept on the canvas.
 */
export class TooltipOverlay implements WidgetOverlay {
    readonly drawBeforeMenu = true;

    constructor(
        private readonly tooltips: TooltipManager,
        private readonly mouse: () => { x: number; y: number } | undefined,
    ) {}

    private current(): { tooltips: Tooltip[]; mouse: { x: number; y: number } } | undefined {
        const mouse = this.mouse();
        if (!mouse) return undefined;
        const tooltips = this.tooltips.getTooltips();
        return tooltips.length === 0 ? undefined : { tooltips, mouse };
    }

    signature(): string {
        const current = this.current();
        if (!current) return "";
        return JSON.stringify([current.mouse.x, current.mouse.y, overlayFontsVersion(), current.tooltips.map((t) => t.text)]);
    }

    draw(context: WidgetOverlayDrawContext): Rect[] {
        const current = this.current();
        if (!current) return [];
        const { x: sx, y: sy } = context.overlayTextScale?.() ?? { x: 1, y: 1 };
        const { x: ix, y: iy } = context.inputScale?.() ?? { x: 1, y: 1 };
        const font = overlayFont("tooltip");
        const loaded = context.fontLoader(font.id);
        const textScaleX = sx * font.scale, textScaleY = sy * font.scale;
        const measure = (text: string) => (loaded ? loaded.measure(text) : text.length * 7) * textScaleX;
        const lineHeight = LINE_HEIGHT * textScaleY;

        const boxes = current.tooltips.map((tooltip) => {
            const lines = tooltip.text.split(BR);
            const w = Math.max(...lines.map((line) => textWidth(measure, line))) + 2 * OFFSET * sx;
            const h = lines.length * lineHeight + 2 * OFFSET * sy;
            return { lines, w, h };
        });
        const width = Math.max(...boxes.map((b) => b.w));
        const height = boxes.reduce((sum, b) => sum + b.h, 0) + (boxes.length - 1) * PADDING * sy;
        const canvasW = context.renderer.canvas.width;
        const canvasH = context.renderer.canvas.height;
        const mouseX = current.mouse.x * ix, mouseY = current.mouse.y * iy;
        const x = Math.max(0, Math.min(canvasW - width, mouseX));
        let y = Math.max(0, Math.min(canvasH - height, mouseY + UNDER_OFFSET * sy));

        const rects: Rect[] = [];
        for (const box of boxes) {
            const r = { x, y, w: box.w, h: box.h };
            const glr = context.renderer;
            glr.drawRect(r.x, r.y, r.w, r.h, BACKGROUND);
            glr.drawRect(r.x, r.y, r.w, sy, OUTLINE);
            glr.drawRect(r.x, r.y + r.h - sy, r.w, sy, OUTLINE);
            glr.drawRect(r.x, r.y + sy, sx, r.h - 2 * sy, OUTLINE);
            glr.drawRect(r.x + r.w - sx, r.y + sy, sx, r.h - 2 * sy, OUTLINE);
            box.lines.forEach((line, i) => {
                drawTextGL(glr, context.fontLoader, line, r.x + OFFSET * sx, r.y + OFFSET * sy + i * lineHeight,
                    r.w - 2 * OFFSET * sx, lineHeight, font.id, WHITE, 0, 1, true, 1, undefined, textScaleX, textScaleY);
            });
            rects.push(r);
            y += box.h + PADDING * sy;
        }
        return rects;
    }
}

/**
 * Hosts the TooltipOverlay, which RuneLite adds to every client: always on and not listed, so
 * the plugins that add tooltips (Mouse Tooltips, Run Energy) need nothing else.
 */
export class TooltipPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Tooltips",
        description: "Draws the tooltips other plugins add.",
        hidden: true,
        configKey: "tooltipplugin",
    };

    readonly widgetOverlay: TooltipOverlay;

    constructor(tooltips?: TooltipManager, client?: OsrsClient) {
        super();
        const manager = tooltips ?? inject(TooltipManager);
        const osrsClient = client ?? inject<OsrsClient>(CLIENT_TOKEN);
        this.widgetOverlay = new TooltipOverlay(manager, () => {
            if (!this.isStarted() || osrsClient.menuOpen) return undefined;
            const x = Number(osrsClient.inputManager?.mouseX);
            const y = Number(osrsClient.inputManager?.mouseY);
            return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 ? { x, y } : undefined;
        });
    }
}
