import type { WidgetOverlay, WidgetOverlayDrawContext } from "../ClientPluginManager";
import { convexHull } from "../npcindicators/npcMatching";
import type { ObjectIndicatorsPlugin, MarkedObject } from "./ObjectIndicatorsPlugin";
import { HF_CLICKBOX, HF_HULL, HF_TILE, withAlpha } from "./objectPoints";

type Rgba = [number, number, number, number];
type Point = [number, number];
type Shape = { points: Point[]; stroke: Rgba; fill: Rgba; width: number };

/** RuneLite's default hull fill: new Color(0, 0, 0, 50). */
const DEFAULT_HULL_FILL = 0x32000000;

function rgba(argb: number): Rgba {
    const v = argb >>> 0;
    return [((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255, (v >>> 24) / 255];
}

/**
 * RuneLite's ObjectIndicatorsOverlay (ABOVE_SCENE, so under the widgets): per marked object, in
 * order, its hull(s), clickbox and tile (the outline goes through the renderers' model outline
 * pass via ObjectIndicatorsPlugin.locOutlines).
 */
export class ObjectIndicatorsOverlay implements WidgetOverlay {
    readonly drawBelowWidgets = true;
    private shapes?: Shape[];
    private signatureShapes: Shape[] = [];
    private revision = 0;

    constructor(private readonly plugin: ObjectIndicatorsPlugin) {}

    signature(): string {
        this.shapes = this.build();
        if (!sameShapes(this.shapes, this.signatureShapes)) this.revision++;
        this.signatureShapes = this.shapes;
        return this.shapes.length === 0 ? "" : String(this.revision);
    }

    draw(context: WidgetOverlayDrawContext): { x: number; y: number; w: number; h: number }[] {
        const shapes = this.shapes ?? this.build();
        this.shapes = undefined;
        const glr: any = context.renderer;
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

    private build(): Shape[] {
        const plugin = this.plugin;
        if (!plugin.isStarted() || !plugin.isLoggedIn()) return [];
        const geom = plugin.getClient().sceneGeometry;
        if (!geom) return [];
        const borderWidth = Math.max(0, Number(plugin.config.borderWidth()) || 0);
        const shapes: Shape[] = [];
        for (const object of plugin.objects) {
            if (!plugin.shouldDraw(object)) continue;
            const flags = plugin.flagsFor(object);
            const border = plugin.borderColor(object);
            const stroke = rgba(border);
            const lightFill = object.point.fillColor ?? withAlpha(border, Math.floor((border >>> 24) / 12));
            const parts = flags & (HF_HULL | HF_CLICKBOX) ? geom.locModelPoints(object.loc) : undefined;
            if (flags & HF_HULL) {
                const fill = rgba(object.point.fillColor ?? DEFAULT_HULL_FILL);
                for (const part of parts ?? []) {
                    const hull = this.hull(part.map(([x, h, y]) => geom.worldToScreen(x, h, y)));
                    if (hull) shapes.push({ points: hull, stroke, fill, width: borderWidth });
                }
            }
            if ((flags & HF_CLICKBOX) && parts && parts.length > 0) {
                const box = this.clickbox(geom, parts.flat());
                if (box) shapes.push({ points: box, stroke, fill: rgba(lightFill), width: borderWidth });
            }
            if (flags & HF_TILE) {
                const tile = this.tile(geom, object);
                if (tile) shapes.push({ points: tile, stroke, fill: rgba(lightFill), width: Math.min(borderWidth, 2) });
            }
        }
        return shapes;
    }

    private hull(projected: (readonly [number, number] | undefined)[]): Point[] | undefined {
        const points = projected.filter((p): p is readonly [number, number] => !!p).map((p) => [p[0], p[1]] as Point);
        if (points.length < 3) return undefined;
        const hull = convexHull(points);
        return hull.length >= 3 ? hull : undefined;
    }

    /** The clickbox as RuneLite builds it for most objects: the hull of the model's bounding box. */
    private clickbox(geom: any, points: ReadonlyArray<readonly [number, number, number]>): Point[] | undefined {
        let x0 = Infinity, x1 = -Infinity, h0 = Infinity, h1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const [x, h, y] of points) {
            x0 = Math.min(x0, x); x1 = Math.max(x1, x);
            h0 = Math.min(h0, h); h1 = Math.max(h1, h);
            y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
        if (!Number.isFinite(x0)) return undefined;
        const corners: (readonly [number, number] | undefined)[] = [];
        for (const x of [x0, x1]) for (const h of [h0, h1]) for (const y of [y0, y1]) corners.push(geom.worldToScreen(x, h, y));
        return this.hull(corners);
    }

    /** TileObject.getCanvasTilePoly: a game object's whole footprint, else its own tile. */
    private tile(geom: any, object: MarkedObject): Point[] | undefined {
        const { loc } = object;
        const type = this.plugin.locType(loc.id);
        let sx = 1, sy = 1;
        if (loc.shape >= 9 && loc.shape <= 21) {
            sx = Math.max(1, type?.sizeX ?? 1);
            sy = Math.max(1, type?.sizeY ?? 1);
            if (loc.rotation === 1 || loc.rotation === 3) [sx, sy] = [sy, sx];
        }
        const corners: [number, number][] = [[loc.tileX, loc.tileY], [loc.tileX + sx, loc.tileY], [loc.tileX + sx, loc.tileY + sy], [loc.tileX, loc.tileY + sy]];
        const out: Point[] = [];
        for (const [x, y] of corners) {
            const p = geom.worldToScreen(x, geom.tileHeight(x, y, loc.plane, loc.tileX + sx / 2, loc.tileY + sy / 2), y);
            if (!p) return undefined;
            out.push([p[0], p[1]]);
        }
        return out;
    }
}

/** Repaint only when the rounded screen geometry or its styling changes. */
function sameShapes(a: readonly Shape[], b: readonly Shape[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        const left = a[i], right = b[i];
        if (left.width !== right.width || left.points.length !== right.points.length) return false;
        for (let c = 0; c < 4; c++) {
            if (left.stroke[c] !== right.stroke[c] || left.fill[c] !== right.fill[c]) return false;
        }
        for (let p = 0; p < left.points.length; p++) {
            if (Math.round(left.points[p][0]) !== Math.round(right.points[p][0]) ||
                Math.round(left.points[p][1]) !== Math.round(right.points[p][1])) return false;
        }
    }
    return true;
}
