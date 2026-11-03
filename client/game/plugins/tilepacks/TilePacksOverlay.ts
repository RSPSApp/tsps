import { overlayFont } from "@runelite/client/ui/overlay/OverlayFonts";
import { drawTextGL } from "../../../widgets/components/TextRenderer";
import type { WidgetOverlay, WidgetOverlayDrawContext } from "../ClientPluginManager";
import { argbToRgba } from "../npcindicators/NpcIndicatorsConfig";
import type { ColorTileMarker, TilePacksPlugin } from "./TilePacksPlugin";

type Rgba = [number, number, number, number];
type Point = [number, number];
type Shape = { points: Point[]; stroke: Rgba; fill?: Rgba; width: number };
type Text = { text: string; x: number; y: number; color: number };
type Frame = { shapes: Shape[]; texts: Text[]; signature: string };
type Rect = { x: number; y: number; w: number; h: number };

/** GroundMarkerOverlay.MAX_DRAW_DISTANCE. */
const MAX_DRAW_DISTANCE = 32;
/** A tile without a colour draws as Ground Markers' default, yellow. */
const DEFAULT_COLOR = 0xffffff00;

function tileColor(plugin: TilePacksPlugin, marker: ColorTileMarker): number {
    if (plugin.config.overrideColorActive()) return Number(plugin.config.overrideColor()) >>> 0;
    return marker.color ?? DEFAULT_COLOR;
}

/** The markers on the player's plane (both overlays skip the others). */
function markersOnPlane(plugin: TilePacksPlugin): ColorTileMarker[] {
    if (!plugin.isStarted() || !plugin.isLoggedIn() || plugin.points.length === 0) return [];
    const plane = plugin.playerPlane();
    return plugin.points.filter((m) => m.point.plane === plane);
}

function frameSignature(frame: Frame): string {
    if (frame.shapes.length + frame.texts.length === 0) return "";
    return JSON.stringify([
        frame.shapes.map((s) => [s.points.map(([x, y]) => [Math.round(x), Math.round(y)]), s.stroke, s.fill, s.width]),
        frame.texts.map((t) => [t.text, Math.round(t.x), Math.round(t.y), t.color]),
    ]);
}

function drawFrame(context: WidgetOverlayDrawContext, frame: Frame): Rect[] {
    const glr = context.renderer as any;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const grow = (x: number, y: number, pad: number) => {
        minX = Math.min(minX, x - pad); minY = Math.min(minY, y - pad);
        maxX = Math.max(maxX, x + pad); maxY = Math.max(maxY, y + pad);
    };
    for (const shape of frame.shapes) {
        glr.drawPolyline?.(shape.points, shape.width, shape.stroke, true);
        if (shape.fill) glr.drawPolygon?.(shape.points, shape.fill);
        for (const [x, y] of shape.points) grow(x, y, shape.width);
    }
    // A DYNAMIC overlay: the dynamic overlay font.
    const { id: fontId, scale } = overlayFont("dynamic");
    for (const t of frame.texts) {
        const font = context.fontLoader(fontId);
        const w = (font ? font.measure(t.text) : t.text.length * 7) * scale;
        const h = 16 * scale;
        const x = t.x - w / 2;
        // OverlayUtil.renderTextLocation: the point is the baseline, with a shadow.
        drawTextGL(context.renderer, context.fontLoader, t.text, x - 2, t.y - h + 3 * scale, w + 4, h, fontId,
            t.color & 0xffffff, 1, 2, true, 1, undefined, scale, scale);
        grow(x, t.y - h, 0);
        grow(x + w, t.y + 4 * scale, 0);
    }
    return Number.isFinite(minX) ? [{ x: minX, y: minY, w: maxX - minX, h: maxY - minY }] : [];
}

/** Tile Packs' GroundMarkerOverlay (ABOVE_SCENE): each tile's outline and fill, and its label. */
export class TilePacksOverlay implements WidgetOverlay {
    readonly drawBelowWidgets = true;
    private frame?: Frame;

    constructor(private readonly plugin: TilePacksPlugin) {}

    signature(): string {
        this.frame = this.build();
        return this.frame.signature;
    }

    draw(context: WidgetOverlayDrawContext): Rect[] {
        const frame = this.frame ?? this.build();
        this.frame = undefined;
        return drawFrame(context, frame);
    }

    private build(): Frame {
        const frame: Frame = { shapes: [], texts: [], signature: "" };
        const plugin = this.plugin;
        const scene = plugin.getClient().sceneGeometry;
        const markers = markersOnPlane(plugin);
        const player = plugin.playerTile();
        if (!scene || markers.length === 0 || !player) return frame;
        const width = Math.max(0, Number(plugin.config.borderWidth()) || 0);
        const opacity = Math.max(0, Math.min(255, Number(plugin.config.fillOpacity()) | 0));
        const fill: Rgba = [0, 0, 0, opacity / 255];
        const showLabels = plugin.config.showLabels() === true;
        for (const marker of markers) {
            const { x, y, plane } = marker.point;
            if (Math.max(Math.abs(x - player.x), Math.abs(y - player.y)) >= MAX_DRAW_DISTANCE) continue;
            const color = tileColor(plugin, marker);
            const corners: [number, number][] = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
            const poly: Point[] = [];
            for (const [cx, cy] of corners) {
                const p = scene.worldToScreen(cx, scene.tileHeight(cx, cy, plane), cy);
                if (!p) break;
                poly.push([p[0], p[1]]);
            }
            if (poly.length === 4) frame.shapes.push({ points: poly, stroke: argbToRgba(color), fill, width });
            if (showLabels && marker.label) {
                const cx = x + 0.5, cy = y + 0.5;
                const p = scene.worldToScreen(cx, scene.tileHeight(cx, cy, plane), cy);
                if (p) frame.texts.push({ text: marker.label, x: p[0], y: p[1], color });
            }
        }
        frame.signature = frameSignature(frame);
        return frame;
    }
}

/** Tile Packs' GroundMarkerMinimapOverlay (ABOVE_WIDGETS): a 1px outline of each tile. */
export class TilePacksMinimapOverlay implements WidgetOverlay {
    private frame?: Frame;

    constructor(private readonly plugin: TilePacksPlugin) {}

    signature(): string {
        this.frame = this.build();
        return this.frame.signature;
    }

    draw(context: WidgetOverlayDrawContext): Rect[] {
        const frame = this.frame ?? this.build();
        this.frame = undefined;
        return drawFrame(context, frame);
    }

    private build(): Frame {
        const frame: Frame = { shapes: [], texts: [], signature: "" };
        const plugin = this.plugin;
        if (!plugin.config.drawTilesOnMinimmap()) return frame;
        const minimap = plugin.getClient().minimapGeometry;
        const markers = markersOnPlane(plugin);
        if (!minimap || markers.length === 0) return frame;
        if (performance.now() - minimap.drawnAt >= 500 || minimap.plane !== plugin.playerPlane()) return frame;
        const width = Math.max(1, minimap.scale);
        for (const marker of markers) {
            const { x, y } = marker.point;
            const corners: [number, number][] = [[x, y], [x, y + 1], [x + 1, y + 1], [x + 1, y]];
            const poly: Point[] = [];
            for (const [cx, cy] of corners) {
                const p = minimap.worldToMinimap(cx, cy);
                if (!p) break;
                poly.push([p[0], p[1]]);
            }
            if (poly.length === 4) frame.shapes.push({ points: poly, stroke: argbToRgba(tileColor(plugin, marker)), width });
        }
        frame.signature = frameSignature(frame);
        return frame;
    }
}
