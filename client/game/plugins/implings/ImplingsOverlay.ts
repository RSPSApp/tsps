import { GameState } from "@runelite/api/GameState";
import { toRuneLiteGameState } from "../../../runelite/impl/GameStateMapping";
import { type OverlayFont, overlayFont } from "@runelite/client/ui/overlay/OverlayFonts";
import { drawTextGL } from "../../../widgets/components/TextRenderer";
import type { WidgetOverlay, WidgetOverlayDrawContext } from "../ClientPluginManager";
import { argbToRgba } from "../npcindicators/NpcIndicatorsConfig";
import { implingTypeName } from "./Impling";
import { IMPLING_SPAWNS } from "./ImplingSpawn";
import type { ImplingsPlugin } from "./ImplingsPlugin";

type Rgba = [number, number, number, number];
type Point = [number, number];
type Shape = { points: Point[]; stroke: Rgba; fill: Rgba; width: number };
type Text = { text: string; x: number; y: number; color: number; center: boolean };
type Dot = { x: number; y: number; color: Rgba; radius: number };
/** `font` is the dynamic overlay font, which every text here is drawn in. */
type Frame = { shapes: Shape[]; texts: Text[]; dots: Dot[]; font: OverlayFont; signature: string };

/** RuneLite's ImplingsOverlay.PURO_PURO region id. */
export const PURO_PURO = (40 << 8) | 67;
/** Spawns this far (Chebyshev, tiles) or further from the player are not drawn. */
const SPAWN_DRAW_DISTANCE = 32;
/** HighlightedNpc's default border width and fill (black, alpha 50). */
const BORDER_WIDTH = 2;
const NPC_FILL: Rgba = [0, 0, 0, 50 / 255];
const MINIMAP_DOT_RADIUS = 4;
const BLACK: Rgba = [0, 0, 0, 1];

export function regionId(x: number, y: number): number {
    return ((x >> 6) << 8) | (y >> 6);
}

/**
 * One 2D pass under the widgets: the NpcOverlayService drawing RuneLite gives implings (tile and
 * name per highlighted impling, minimap dot and optional minimap name), then ImplingsOverlay's
 * Puro-Puro spawn tiles.
 */
export class ImplingsOverlay implements WidgetOverlay {
    readonly drawBelowWidgets = true;
    private frame?: Frame;

    constructor(private readonly plugin: ImplingsPlugin) {}

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
        const player = plugin.playerTile();
        const plane = player?.plane ?? 0;
        const scene = client.sceneGeometry;
        const npcs = client.npcEcs;
        const visible = [...plugin.highlightedNpcs.values()].filter((npc) => {
            if ((npcs.getLevel(npc.ecsId) | 0) !== plane) return false;
            // NpcOverlay and NpcMinimapOverlay skip NPCs whose composition is not interactable.
            return plugin.npcType(npc.ecsId)?.isInteractable === true;
        });

        if (scene) {
            for (const npc of visible) {
                const stroke = argbToRgba(npc.color);
                const size = Math.max(1, npcs.getSize(npc.ecsId) | 0);
                const cx = npcs.getWorldX(npc.ecsId) / 128;
                const cy = npcs.getWorldY(npc.ecsId) / 128;
                const tile = area(scene, cx - size / 2, cy - size / 2, size, plane);
                if (tile) frame.shapes.push({ points: tile, stroke, fill: NPC_FILL, width: BORDER_WIDTH });
                const height = scene.tileHeight(cx, cy, plane) - (scene.npcHeight(npc.id) + 40) / 128;
                const p = scene.worldToScreen(cx, height, cy);
                if (p) frame.texts.push({ text: npc.name, x: p[0], y: p[1], color: rgb(npc.color), center: true });
            }
            if (player && plugin.config.showSpawn() === true && regionId(player.x, player.y) === PURO_PURO) {
                this.spawns(frame, scene, player);
            }
        }

        const minimap = client.minimapGeometry;
        if (minimap && performance.now() - minimap.drawnAt < 500 && minimap.plane === plane) {
            const showNames = plugin.config.showName() === true;
            for (const npc of visible) {
                const loc = minimap.worldToMinimap(npcs.getWorldX(npc.ecsId) / 128, npcs.getWorldY(npc.ecsId) / 128);
                if (!loc) continue;
                const color = argbToRgba(npc.color);
                frame.dots.push({ x: loc[0], y: loc[1], color: [color[0], color[1], color[2], 1], radius: (MINIMAP_DOT_RADIUS / 2) * minimap.scale });
                if (showNames) {
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

    /** ImplingsOverlay.drawSpawn for each spawn whose type is not NONE: OverlayUtil.renderPolygon and its name. */
    private spawns(frame: Frame, scene: any, player: { x: number; y: number; plane: number }): void {
        const color = Number(this.plugin.config.spawnColor()) >>> 0;
        const stroke = argbToRgba(color);
        const fill: Rgba = [stroke[0], stroke[1], stroke[2], 50 / 255];
        for (const spawn of IMPLING_SPAWNS) {
            if (this.plugin.showImplingType(spawn.type) === "NONE") continue;
            if (spawn.plane !== player.plane) continue;
            if (Math.max(Math.abs(spawn.x - player.x), Math.abs(spawn.y - player.y)) >= SPAWN_DRAW_DISTANCE) continue;
            const tile = area(scene, spawn.x, spawn.y, 1, spawn.plane);
            if (tile) frame.shapes.push({ points: tile, stroke, fill, width: BORDER_WIDTH });
            const cx = spawn.x + 0.5, cy = spawn.y + 0.5;
            const p = scene.worldToScreen(cx, scene.tileHeight(cx, cy, spawn.plane), cy);
            if (p) frame.texts.push({ text: implingTypeName(spawn.type), x: p[0], y: p[1], color: rgb(color), center: true });
        }
    }
}

/** A size x size tile area from its south-west corner (Perspective.getCanvasTileAreaPoly). */
function area(scene: any, x: number, y: number, size: number, plane: number): Point[] | undefined {
    const corners: [number, number][] = [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];
    const out: Point[] = [];
    for (const [cx, cy] of corners) {
        const p = scene.worldToScreen(cx, scene.tileHeight(cx, cy, plane), cy);
        if (!p) return undefined;
        out.push([p[0], p[1]]);
    }
    return out;
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
