import type { WidgetOverlay, WidgetOverlayDrawContext } from "../ClientPluginManager";
import type { Tile, TileMarkersPlugin } from "./TileMarkersPlugin";

type Rgba = [number, number, number, number];
type Point = [number, number];
type Shape = { points: Point[]; stroke: Rgba; fill: Rgba; width: number };
type Rect = { x: number; y: number; w: number; h: number };

/** A config colour (0xAARRGGBB) with its alpha as given: RuneLite's (0,0,0,0) draws nothing. */
function rgba(argb: number): Rgba {
    const v = Number(argb) >>> 0;
    return [((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255, (v >>> 24) / 255];
}

/**
 * RuneLite's TileIndicatorsOverlay (ABOVE_SCENE): the hovered, destination and true tiles, in
 * that order, each as its canvas tile polygon with renderPolygon's border, fill and stroke.
 */
export class TileIndicatorsOverlay implements WidgetOverlay {
    readonly drawBelowWidgets = true;
    private shapes?: Shape[];

    constructor(private readonly plugin: TileMarkersPlugin) {}

    signature(): string {
        this.shapes = this.build();
        if (this.shapes.length === 0) return "";
        return JSON.stringify(this.shapes.map((s) => [s.points.map(([x, y]) => [Math.round(x), Math.round(y)]), s.stroke, s.fill, s.width]));
    }

    draw(context: WidgetOverlayDrawContext): Rect[] {
        const shapes = this.shapes ?? this.build();
        this.shapes = undefined;
        const glr = context.renderer as any;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const s of shapes) {
            glr.drawPolyline?.(s.points, s.width, s.stroke, true);
            glr.drawPolygon?.(s.points, s.fill);
            for (const [x, y] of s.points) {
                minX = Math.min(minX, x - s.width); minY = Math.min(minY, y - s.width);
                maxX = Math.max(maxX, x + s.width); maxY = Math.max(maxY, y + s.width);
            }
        }
        return Number.isFinite(minX) ? [{ x: minX, y: minY, w: maxX - minX, h: maxY - minY }] : [];
    }

    build(): Shape[] {
        const plugin = this.plugin;
        if (!plugin.isStarted() || !plugin.isLoggedIn() || plugin.inCutscene()) return [];
        const config = plugin.config;
        const shapes: Shape[] = [];
        const add = (tile: Tile | undefined, color: number, width: number, fill: number) => {
            const points = tile && this.tilePoly(tile);
            if (points) shapes.push({ points, stroke: rgba(color), fill: rgba(fill), width: Math.max(0, Number(width) || 0) });
        };
        if (config.highlightHoveredTile()) {
            add(plugin.hoveredTile(), config.highlightHoveredColor(), config.hoveredTileBorderWidth(), config.hoveredTileFillColor());
        }
        if (config.highlightDestinationTile()) {
            add(plugin.destinationTile(), config.highlightDestinationColor(), config.destinationTileBorderWidth(), config.destinationTileFillColor());
        }
        if (config.highlightCurrentTile()) {
            add(plugin.trueTile(), config.highlightCurrentColor(), config.currentTileBorderWidth(), config.currentTileFillColor());
        }
        return shapes;
    }

    /** Perspective.getCanvasTilePoly: the tile's four corners at the ground's height. */
    private tilePoly(tile: Tile): Point[] | undefined {
        const scene = this.plugin.getClient().sceneGeometry;
        if (!scene) return undefined;
        const corners: [number, number][] = [[tile.x, tile.y], [tile.x + 1, tile.y], [tile.x + 1, tile.y + 1], [tile.x, tile.y + 1]];
        const out: Point[] = [];
        for (const [cx, cy] of corners) {
            const p = scene.worldToScreen(cx, scene.tileHeight(cx, cy, tile.plane, tile.x + 0.5, tile.y + 0.5), cy);
            if (!p) return undefined;
            out.push([p[0], p[1]]);
        }
        return out;
    }
}
