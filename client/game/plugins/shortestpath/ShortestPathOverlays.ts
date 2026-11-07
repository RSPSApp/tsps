import { FONT_PLAIN_12 } from "../../../ui/fonts";
import { drawTextGL } from "../../../widgets/components/TextRenderer";
import type { WidgetOverlay, WidgetOverlayDrawContext, WorldMapOverlayContext } from "../ClientPluginManager";
import { argbToRgba } from "../npcindicators/NpcIndicatorsConfig";
import type { ShortestPathPlugin } from "./ShortestPathPlugin";
import { distanceBetween, unpackWorldPlane, unpackWorldX, unpackWorldY } from "./WorldPointUtil";

type Rgba = [number, number, number, number];
type Point = [number, number];
type Shape = { points: Point[]; fill?: Rgba; stroke?: Rgba; width?: number; closed?: boolean };
type Text = { text: string; x: number; y: number; color: number };
type Frame = { shapes: Shape[]; texts: Text[]; signature: string };
type Rect = { x: number; y: number; w: number; h: number };

/** How far from the player scene tiles are drawn (the loaded scene). */
const MAX_DRAW_DISTANCE = 52;

/** An ARGB colour with its alpha halved, as PathTileOverlay draws path tiles. */
function halfAlpha(argb: number): number {
    return ((((argb >>> 24) >>> 1) << 24) | (argb & 0xffffff)) >>> 0;
}

function signatureOf(frame: Frame): string {
    if (frame.shapes.length + frame.texts.length === 0) return "";
    return JSON.stringify([
        frame.shapes.map((s) => [s.points.map(([x, y]) => [Math.round(x), Math.round(y)]), s.fill, s.stroke, s.width]),
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
        if (shape.fill) glr.drawPolygon?.(shape.points, shape.fill);
        if (shape.stroke) glr.drawPolyline?.(shape.points, shape.width ?? 1, shape.stroke, shape.closed ?? true);
        for (const [x, y] of shape.points) grow(x, y, shape.width ?? 1);
    }
    const font = context.fontLoader(FONT_PLAIN_12);
    for (const t of frame.texts) {
        const w = font ? font.measure(t.text) : t.text.length * 7;
        const h = 16;
        const x = t.x - w / 2;
        drawTextGL(context.renderer, context.fontLoader, t.text, x - 2, t.y - h + 3, w + 4, h, FONT_PLAIN_12, t.color & 0xffffff, 1, 2, true);
        grow(x, t.y - h, 0);
        grow(x + w, t.y + 4, 0);
    }
    return Number.isFinite(minX) ? [{ x: minX, y: minY, w: maxX - minX, h: maxY - minY }] : [];
}

abstract class FrameOverlay implements WidgetOverlay {
    private frame?: Frame;
    constructor(protected readonly plugin: ShortestPathPlugin) {}

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
        if (this.plugin.isStarted() && this.plugin.isLoggedIn()) this.fill(frame);
        frame.signature = signatureOf(frame);
        return frame;
    }

    protected abstract fill(frame: Frame): void;
}

/** The label upstream shows at a transport's tile: its display info, else its menu option and target. */
export function transportLabel(plugin: ShortestPathPlugin, index: number): string | undefined {
    const transport = plugin.transports[index];
    if (!transport) return undefined;
    if (transport.displayInfo) return transport.displayInfo;
    if (transport.objectInfo) return transport.objectInfo.replace(/\s+-?\d+$/, "");
    return undefined;
}

/**
 * PathTileOverlay (ABOVE_SCENE): each path tile filled in the path colour at half alpha, or a line
 * through them; transport hints, the tile counter and the unreachable text; and the debug views.
 */
export class PathTileOverlay extends FrameOverlay {
    readonly drawBelowWidgets = true;

    protected fill(frame: Frame): void {
        const plugin = this.plugin;
        const scene = plugin.getClient().sceneGeometry;
        const player = plugin.playerTile();
        if (!scene || !player) return;
        const plane = player.plane;
        const near = (x: number, y: number) => Math.max(Math.abs(x - player.x), Math.abs(y - player.y)) < MAX_DRAW_DISTANCE;
        const project = (x: number, y: number, anchorX = x, anchorY = y): Point | undefined => {
            const p = scene.worldToScreen(x, scene.tileHeight(x, y, plane, anchorX, anchorY), y);
            return p ? [p[0], p[1]] : undefined;
        };
        const tilePoly = (x: number, y: number): Point[] | undefined => {
            const poly: Point[] = [];
            for (const [cx, cy] of [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]] as const) {
                const p = project(cx, cy, x + 0.5, y + 0.5);
                if (!p) return undefined;
                poly.push(p);
            }
            return poly;
        };
        // A world point's scene tiles on the player's plane.
        const sceneTiles = (packed: number) => plugin.toLocalInstance(packed).filter((t) => t.plane === plane && near(t.x, t.y));

        if (plugin.setting("drawCollisionMap") && plugin.debugMap) {
            const map = plugin.debugMap;
            const fill = argbToRgba(Number(plugin.setting("colourCollisionMap")) >>> 0);
            for (let x = player.x - 15; x <= player.x + 15; x++) {
                for (let y = player.y - 15; y <= player.y + 15; y++) {
                    const world = plugin.toWorld(x, y, plane);
                    if (!map.isBlocked(unpackWorldX(world), unpackWorldY(world), unpackWorldPlane(world))) continue;
                    const poly = tilePoly(x, y);
                    if (poly) frame.shapes.push({ points: poly, fill });
                }
            }
        }

        if (plugin.setting("drawTransports")) {
            for (const [index, transport] of plugin.transports.entries()) {
                if (transport.origin === -1 || transport.type.isTeleport) continue;
                for (const a of sceneTiles(transport.origin)) {
                    const pa = project(a.x + 0.5, a.y + 0.5);
                    const b = plugin.toLocalInstance(transport.destination).find((t) => near(t.x, t.y));
                    const pb = b ? project(b.x + 0.5, b.y + 0.5) : undefined;
                    if (pa && pb) {
                        frame.shapes.push({ points: [pa, pb], stroke: plugin.usableTransports.has(index) ? [1, 1, 1, 1] : [1, 0.78, 0, 1], width: 1, closed: false });
                    }
                    const poly = tilePoly(a.x, a.y);
                    if (poly) frame.shapes.push({ points: poly, fill: argbToRgba(Number(plugin.setting("colourTransports")) >>> 0) });
                }
            }
        }

        const search = plugin.activeSearch;
        if (!search || !plugin.setting("drawTiles")) return;
        const path = search.path;
        const color = argbToRgba(halfAlpha(plugin.pathColor()));
        const textColor = Number(plugin.setting("colourText")) >>> 0;
        const lines = plugin.setting("pathStyle") === "LINES";
        const counter = String(plugin.setting("showTileCounter"));
        const step = Math.max(1, Number(plugin.setting("tileCounterStep")) || 1);
        const showInfo = !!plugin.setting("showTransportInfo") && plugin.isDone() && !plugin.isPathUnreachable();

        for (let i = 0; i < path.length; i++) {
            const tiles = sceneTiles(path[i].packed);
            for (const tile of tiles) {
                if (lines) {
                    const next = path[i + 1];
                    const to = next ? sceneTiles(next.packed)[0] : undefined;
                    const a = project(tile.x + 0.5, tile.y + 0.5);
                    const b = to ? project(to.x + 0.5, to.y + 0.5) : undefined;
                    if (a && b) frame.shapes.push({ points: [a, b], stroke: color, width: 2, closed: false });
                } else {
                    const poly = tilePoly(tile.x, tile.y);
                    if (poly) frame.shapes.push({ points: poly, fill: color });
                }
                // drawCounter: every step-th tile and the last, travelled or remaining.
                if (counter !== "DISABLED" && (i % step === 0 || i === path.length - 1)) {
                    const n = counter === "REMAINING" ? path.length - i - 1 : i;
                    const c = project(tile.x + 0.5, tile.y + 0.5);
                    if (c && !(step > 1 && n === 0)) frame.texts.push({ text: String(n), x: c[0], y: c[1], color: textColor });
                }
            }
            // drawTransportInfo: where the next step is a transport, say which.
            const next = path[i + 1];
            if (showInfo && next && next.transport >= 0) {
                const label = transportLabel(plugin, next.transport);
                const tile = tiles[0];
                const c = tile ? project(tile.x + 0.5, tile.y + 0.5) : undefined;
                if (label && c) frame.texts.push({ text: label, x: c[0], y: c[1] - 14, color: textColor });
            }
        }

        // drawUnreachedTargets: the targets the path doesn't end on, in the calculating colour.
        const end = path.length > 0 ? path[path.length - 1].packed : undefined;
        const calculating = argbToRgba(halfAlpha(Number(plugin.setting("colourPathCalculating")) >>> 0));
        for (const target of search.targets) {
            if (end === undefined || target === end) continue;
            for (const tile of sceneTiles(target)) {
                const poly = tilePoly(tile.x, tile.y);
                if (poly) frame.shapes.push({ points: poly, fill: calculating });
            }
        }

        if (plugin.isPathUnreachable() && plugin.setting("showUnreachableText")) {
            const c = project(player.x + 0.5, player.y + 0.5);
            if (c) frame.texts.push({ text: String(plugin.setting("unreachableText")), x: c[0], y: c[1] - 20, color: textColor });
        }
    }
}

/** PathMinimapOverlay (ABOVE_WIDGETS): each path tile on the player's plane as a filled square. */
export class PathMinimapOverlay extends FrameOverlay {
    protected fill(frame: Frame): void {
        const plugin = this.plugin;
        const search = plugin.activeSearch;
        const minimap = plugin.getClient().minimapGeometry;
        const player = plugin.playerTile();
        if (!search || !minimap || !player || !plugin.setting("drawMinimap")) return;
        if (performance.now() - minimap.drawnAt >= 500 || minimap.plane !== player.plane) return;
        const square = (packed: number, rgba: Rgba) => {
            for (const tile of plugin.toLocalInstance(packed)) {
                if (tile.plane !== player.plane) continue;
                const poly: Point[] = [];
                for (const [cx, cy] of [[tile.x, tile.y], [tile.x, tile.y + 1], [tile.x + 1, tile.y + 1], [tile.x + 1, tile.y]] as const) {
                    const p = minimap.worldToMinimap(cx, cy);
                    if (!p) return;
                    poly.push([p[0], p[1]]);
                }
                frame.shapes.push({ points: poly, fill: rgba });
            }
        };
        const color = argbToRgba(plugin.pathColor());
        for (const step of search.path) square(step.packed, color);
        const end = search.path.length > 0 ? search.path[search.path.length - 1].packed : undefined;
        const calculating = argbToRgba(Number(plugin.setting("colourPathCalculating")) >>> 0);
        for (const target of search.targets) if (end !== undefined && target !== end) square(target, calculating);
    }
}

/** Clips a segment to a rect (Liang-Barsky); undefined when it lies outside. */
function clipSegment(ax: number, ay: number, bx: number, by: number, r: { x: number; y: number; w: number; h: number }): [Point, Point] | undefined {
    let t0 = 0, t1 = 1;
    const dx = bx - ax, dy = by - ay;
    const edges: [number, number][] = [[-dx, ax - r.x], [dx, r.x + r.w - ax], [-dy, ay - r.y], [dy, r.y + r.h - ay]];
    for (const [p, q] of edges) {
        if (p === 0) {
            if (q < 0) return undefined;
            continue;
        }
        const t = q / p;
        if (p < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
        if (t0 > t1) return undefined;
    }
    return [[ax + t0 * dx, ay + t0 * dy], [ax + t1 * dx, ay + t1 * dy]];
}

/**
 * PathMapOverlay: each path tile as a tile-sized square in the path colour, a dashed line across
 * each transport jump, the targets the path doesn't reach in the calculating colour, and a marker
 * on the target (upstream's world map point).
 */
export function drawWorldMapPath(plugin: ShortestPathPlugin, context: WorldMapOverlayContext): void {
    const glr = context.renderer as any;
    const bounds = context.bounds;
    const w = Math.max(2, context.pixelsPerTileX);
    const h = Math.max(2, context.pixelsPerTileY);
    const tileRect = (packed: number) => {
        const p = context.worldToScreen(unpackWorldX(packed), unpackWorldY(packed), unpackWorldPlane(packed));
        return p ? { x: p.x, y: p.y - context.pixelsPerTileY, cx: p.x + context.pixelsPerTileX / 2, cy: p.y - context.pixelsPerTileY / 2 } : undefined;
    };
    const fillTile = (packed: number, rgba: Rgba) => {
        const r = tileRect(packed);
        if (!r) return;
        const x0 = Math.max(bounds.x, r.cx - w / 2), y0 = Math.max(bounds.y, r.cy - h / 2);
        const x1 = Math.min(bounds.x + bounds.w, r.cx + w / 2), y1 = Math.min(bounds.y + bounds.h, r.cy + h / 2);
        if (x1 > x0 && y1 > y0) glr.drawRect(x0, y0, x1 - x0, y1 - y0, rgba);
    };
    const dashed = (from: number, to: number, rgba: Rgba) => {
        const a = tileRect(from), b = tileRect(to);
        if (!a || !b) return;
        const length = Math.hypot(b.cx - a.cx, b.cy - a.cy);
        for (let s = 0; s < length; s += 18) {
            const e = Math.min(length, s + 9);
            const segment = clipSegment(a.cx + (b.cx - a.cx) * s / length, a.cy + (b.cy - a.cy) * s / length,
                a.cx + (b.cx - a.cx) * e / length, a.cy + (b.cy - a.cy) * e / length, bounds);
            if (segment) glr.drawPolyline(segment, 1, rgba, false);
        }
    };

    if (plugin.setting("drawTransports")) {
        for (const [index, transport] of plugin.transports.entries()) {
            if (transport.origin === -1 || transport.type.isTeleport) continue;
            const a = tileRect(transport.origin), b = tileRect(transport.destination);
            if (!a || !b) continue;
            const segment = clipSegment(a.cx, a.cy, b.cx, b.cy, bounds);
            if (segment) glr.drawPolyline(segment, 1, plugin.usableTransports.has(index) ? [1, 1, 1, 1] : [1, 0.78, 0, 1], false);
        }
    }

    const search = plugin.activeSearch;
    if (!search) return;
    const color = argbToRgba(plugin.pathColor());
    const path = search.path;
    for (let i = 0; i < path.length; i++) {
        const point = path[i].packed;
        if (i > 0 && distanceBetween(point, path[i - 1].packed) > 1) dashed(path[i - 1].packed, point, color);
        fillTile(point, color);
    }
    const end = path.length > 0 ? path[path.length - 1].packed : undefined;
    const calculating = argbToRgba(Number(plugin.setting("colourPathCalculating")) >>> 0);
    for (const target of search.targets) {
        if (end !== undefined && target !== end) fillTile(target, calculating);
        // The target marker: a diamond outline around the target tile.
        const r = tileRect(target);
        if (!r) continue;
        const size = Math.max(6, w * 1.5);
        const diamond: Point[] = [[r.cx, r.cy - size], [r.cx + size, r.cy], [r.cx, r.cy + size], [r.cx - size, r.cy]];
        if (diamond.every(([x, y]) => x >= bounds.x && y >= bounds.y && x <= bounds.x + bounds.w && y <= bounds.y + bounds.h)) {
            glr.drawPolyline(diamond, 2, color, true);
        }
    }
}
