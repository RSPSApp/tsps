import { GameState } from "@runelite/api/GameState";
import { toRuneLiteGameState } from "../../../runelite/impl/GameStateMapping";
import { type OverlayFont, overlayFont } from "@runelite/client/ui/overlay/OverlayFonts";
import { drawTextGL } from "../../../widgets/components/TextRenderer";
import type { WidgetOverlay, WidgetOverlayDrawContext } from "../ClientPluginManager";
import { argbToRgba } from "./NpcIndicatorsConfig";
import { convexHull } from "./npcMatching";
import type { HighlightedNpc, NpcIndicatorsPlugin } from "./NpcIndicatorsPlugin";
import { formatRespawn, respawnSecondsLeft } from "./respawn";

type Rgba = [number, number, number, number];
type Point = [number, number];
type Shape = { points: Point[]; stroke: Rgba; fill: Rgba; width: number };
type Text = { text: string; x: number; y: number; color: number; center: boolean };
type Dot = { x: number; y: number; color: Rgba; radius: number };
/** `font` is the dynamic overlay font, which every text here is drawn in. */
type Frame = { shapes: Shape[]; texts: Text[]; dots: Dot[]; font: OverlayFont; signature: string };

const MINIMAP_DOT_RADIUS = 4;
const BLACK: Rgba = [0, 0, 0, 1];
const WHITE = 0xffffff;

/**
 * RuneLite's NpcOverlay, NpcMinimapOverlay and NpcRespawnOverlay in one 2D pass under the
 * widgets: hull, tile, true tile, south-west tile, south-west true tile and name per NPC, the
 * respawn countdown tiles, then minimap dots and names. (Outlines go through the renderers'
 * model outline pass, see NpcIndicatorsPlugin.npcOutlines.)
 */
export class NpcOverlay implements WidgetOverlay {
    readonly drawBelowWidgets = true;
    private frame?: Frame;

    constructor(private readonly plugin: NpcIndicatorsPlugin) {}

    signature(): string {
        this.frame = this.build();
        return this.frame.signature;
    }

    draw(context: WidgetOverlayDrawContext): { x: number; y: number; w: number; h: number }[] {
        const frame = this.frame ?? this.build();
        this.frame = undefined;
        if (frame.shapes.length + frame.texts.length + frame.dots.length === 0) return [];
        const glr = context.renderer as any;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const grow = (x: number, y: number, pad: number) => {
            minX = Math.min(minX, x - pad); minY = Math.min(minY, y - pad);
            maxX = Math.max(maxX, x + pad); maxY = Math.max(maxY, y + pad);
        };
        for (const shape of frame.shapes) {
            glr.drawPolyline?.(shape.points, shape.width, shape.stroke, true);
            glr.drawPolygon?.(shape.points, shape.fill);
            for (const [x, y] of shape.points) grow(x, y, shape.width);
        }
        for (const dot of frame.dots) {
            glr.drawPolygon?.(circle(dot.x, dot.y + 1, dot.radius), BLACK);
            glr.drawPolygon?.(circle(dot.x, dot.y, dot.radius), dot.color);
            grow(dot.x, dot.y, dot.radius + 1);
        }
        const { id: fontId, scale } = frame.font;
        for (const t of frame.texts) {
            const font = context.fontLoader(fontId);
            const w = (font ? font.measure(t.text) : t.text.length * 7) * scale;
            const h = 16 * scale;
            const x = t.center ? t.x - w / 2 : t.x;
            // The point is the text baseline, as Graphics.drawString takes it.
            drawTextGL(context.renderer, context.fontLoader, t.text, x - 2, t.y - h + 3 * scale, w + 4, h, fontId, t.color,
                1, 2, true, 1, undefined, scale, scale);
            grow(x, t.y - h, 0);
            grow(x + w, t.y + 4 * scale, 0);
        }
        if (!Number.isFinite(minX)) return [];
        return [{ x: minX, y: minY, w: maxX - minX, h: maxY - minY }];
    }

    private build(): Frame {
        const frame: Frame = { shapes: [], texts: [], dots: [], font: overlayFont("dynamic"), signature: "" };
        const plugin = this.plugin;
        if (!plugin.isStarted()) return frame;
        const client: any = plugin.getClient();
        if (toRuneLiteGameState(client?.gameState) !== GameState.LOGGED_IN) return frame;
        const scene = client.sceneGeometry;
        const config = plugin.config;
        const plane = plugin.playerPlane();
        const width = Math.max(0, Number(config.borderWidth()) || 0);
        const fill = argbToRgba(Number(config.fillColor()) >>> 0);
        const showNames = config.drawNames() === true;
        const npcs = client.npcEcs;

        if (scene) {
            for (const npc of plugin.highlightedNpcs.values()) {
                if ((npcs.getLevel(npc.ecsId) | 0) !== plane || !plugin.shouldDraw(npc)) continue;
                const stroke = argbToRgba(npc.color);
                const add = (points: Point[] | undefined) => {
                    if (points && points.length >= 3) frame.shapes.push({ points, stroke, fill, width });
                };
                const size = Math.max(1, npcs.getSize(npc.ecsId) | 0);
                const cx = npcs.getWorldX(npc.ecsId) / 128;
                const cy = npcs.getWorldY(npc.ecsId) / 128;
                const sw = plugin.npcWorldLocation(npc.ecsId);
                if (npc.flags.hull) add(this.hull(scene, npc));
                if (npc.flags.tile) add(this.area(scene, cx - size / 2, cy - size / 2, size, plane));
                if (npc.flags.trueTile) add(this.area(scene, sw.x, sw.y, size, plane));
                if (npc.flags.swTile) {
                    add(this.area(scene, cx - size / 2, cy - size / 2, 1, plane));
                }
                if (npc.flags.swTrueTile) add(this.area(scene, sw.x, sw.y, 1, plane));
                if (showNames) {
                    const height = scene.tileHeight(cx, cy, plane) - (scene.npcHeight(npc.id) + 40) / 128;
                    const p = scene.worldToScreen(cx, height, cy);
                    if (p) frame.texts.push({ text: npc.name, x: p[0], y: p[1], color: rgb(npc.color), center: true });
                }
            }
            if (config.showRespawnTimer()) this.respawns(frame, scene, plane, fill, width);
        }

        const minimap = client.minimapGeometry;
        if (minimap && performance.now() - minimap.drawnAt < 500 && minimap.plane === plane) {
            const showMinimapNames = config.drawMinimapNames() === true;
            for (const npc of plugin.highlightedNpcs.values()) {
                if ((npcs.getLevel(npc.ecsId) | 0) !== plane || !plugin.shouldDraw(npc)) continue;
                const loc = minimap.worldToMinimap(npcs.getWorldX(npc.ecsId) / 128, npcs.getWorldY(npc.ecsId) / 128);
                if (!loc) continue;
                const color = argbToRgba(npc.color);
                frame.dots.push({ x: loc[0], y: loc[1], color: [color[0], color[1], color[2], 1], radius: (MINIMAP_DOT_RADIUS / 2) * minimap.scale });
                if (showMinimapNames) {
                    frame.texts.push({ text: npc.name, x: loc[0], y: loc[1], color: rgb(npc.color), center: false });
                }
            }
        }

        frame.signature = frame.shapes.length + frame.texts.length + frame.dots.length === 0
            ? ""
            : JSON.stringify([
                frame.shapes.map((s) => s.points.map(([x, y]) => [Math.round(x), Math.round(y)])),
                frame.texts.map((t) => [t.text, Math.round(t.x), Math.round(t.y)]),
                frame.dots.map((d) => [Math.round(d.x), Math.round(d.y)]),
            ]);
        return frame;
    }

    /** The model's projected convex hull (RuneLite's Actor.getConvexHull). */
    private hull(scene: any, npc: HighlightedNpc): Point[] | undefined {
        const points = scene.npcModelPoints(npc.ecsId, npc.index);
        if (!points || points.length < 3) return undefined;
        const projected: Point[] = [];
        for (const [x, h, y] of points) {
            const p = scene.worldToScreen(x, h, y);
            if (p) projected.push([p[0], p[1]]);
        }
        return projected.length >= 3 ? convexHull(projected) : undefined;
    }

    /** A size x size tile area from its south-west corner (Perspective.getCanvasTileAreaPoly). */
    private area(scene: any, x: number, y: number, size: number, plane: number): Point[] | undefined {
        const corners: [number, number][] = [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];
        const out: Point[] = [];
        for (const [cx, cy] of corners) {
            const p = scene.worldToScreen(cx, scene.tileHeight(cx, cy, plane), cy);
            if (!p) return undefined;
            out.push([p[0], p[1]]);
        }
        return out;
    }

    /** NpcRespawnOverlay: the respawn tile in the global colours, a white countdown on it. */
    private respawns(frame: Frame, scene: any, plane: number, fill: Rgba, width: number): void {
        const plugin = this.plugin;
        const stroke = argbToRgba(Number(plugin.config.highlightColor()) >>> 0);
        const sinceTick = plugin.lastTickAt > 0 ? performance.now() - plugin.lastTickAt : 0;
        for (const npc of plugin.respawn.deadNpcsToDisplay.values()) {
            const at = npc.possibleRespawnLocations[0];
            if (!at || at.plane !== plane) continue;
            const size = Math.max(1, npc.npcSize);
            const points = this.area(scene, at.x, at.y, size, plane);
            if (!points) continue;
            frame.shapes.push({ points, stroke, fill, width });
            const cx = at.x + size / 2, cy = at.y + size / 2;
            const p = scene.worldToScreen(cx, scene.tileHeight(cx, cy, plane), cy);
            if (!p) continue;
            const text = formatRespawn(respawnSecondsLeft(npc, plugin.getTickCount(), sinceTick));
            frame.texts.push({ text, x: p[0], y: p[1] + 6, color: WHITE, center: true });
        }
    }
}

function rgb(argb: number): number {
    return argb & 0xffffff;
}

function circle(x: number, y: number, r: number): Point[] {
    const points: Point[] = [];
    for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        points.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
    }
    return points;
}
