import { type OverlayFont, overlayFont } from "@runelite/client/ui/overlay/OverlayFonts";
import { drawTextGL } from "../../../widgets/components/TextRenderer";
import type { WidgetOverlay, WidgetOverlayDrawContext } from "../ClientPluginManager";
import type { PlayerIndicatorsPlugin } from "./PlayerIndicatorsPlugin";

type Rgba = [number, number, number, number];
type Point = [number, number];
type Shape = { points: Point[]; stroke: Rgba; fill: Rgba };
type Text = { text: string; x: number; y: number; color: number; center: boolean };
type Frame = { shapes: Shape[]; texts: Text[]; font: OverlayFont; signature: string };

/** OverlayUtil.renderPolygon: a 2px border, filled in the same colour at alpha 50. */
const BORDER_WIDTH = 2;
const FILL_ALPHA = 50 / 255;
/** Actor.getLogicalHeight's default for players, in local units (a tile is 128). */
const DEFAULT_LOGICAL_HEIGHT = 200;
const ACTOR_OVERHEAD_TEXT_MARGIN = 40;
const ACTOR_HORIZONTAL_TEXT_MARGIN = 10;

/**
 * RuneLite's PlayerIndicatorsTileOverlay, PlayerIndicatorsOverlay and
 * PlayerIndicatorsMinimapOverlay: in the scene (under the widgets) the tile under each
 * highlighted player and its name; on the minimap (above the widgets) its name.
 */
export class PlayerIndicatorsOverlay implements WidgetOverlay {
    readonly drawBelowWidgets: boolean;
    private frame?: Frame;

    constructor(private readonly plugin: PlayerIndicatorsPlugin, private readonly minimap: boolean) {
        this.drawBelowWidgets = !minimap;
    }

    signature(): string {
        this.frame = this.build();
        return this.frame.signature;
    }

    draw(context: WidgetOverlayDrawContext): { x: number; y: number; w: number; h: number }[] {
        const frame = this.frame ?? this.build();
        this.frame = undefined;
        if (frame.shapes.length + frame.texts.length === 0) return [];
        const glr = context.renderer as any;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const grow = (x: number, y: number, pad: number) => {
            minX = Math.min(minX, x - pad); minY = Math.min(minY, y - pad);
            maxX = Math.max(maxX, x + pad); maxY = Math.max(maxY, y + pad);
        };
        for (const shape of frame.shapes) {
            glr.drawPolyline?.(shape.points, BORDER_WIDTH, shape.stroke, true);
            glr.drawPolygon?.(shape.points, shape.fill);
            for (const [x, y] of shape.points) grow(x, y, BORDER_WIDTH);
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
        const frame: Frame = { shapes: [], texts: [], font: overlayFont("dynamic"), signature: "" };
        const plugin = this.plugin;
        const config = plugin.config;
        const wanted = this.minimap
            ? config.drawMinimapNames() === true
            : config.drawTiles() === true || String(config.playerNamePosition()) !== "DISABLED";
        if (!wanted) return frame;
        const highlighted = plugin.highlightedPlayers();
        if (highlighted.length === 0) return frame;
        const client: any = plugin.getClient();
        const players = client.playerEcs;
        const scene = this.minimap ? undefined : client.sceneGeometry;
        const position = String(config.playerNamePosition());
        const drawTiles = config.drawTiles() === true;

        for (const player of highlighted) {
            const x = players.getX(player.index) / 128;
            const y = players.getY(player.index) / 128;
            const plane = players.getLevel(player.index) | 0;
            if (scene && drawTiles) {
                // Actor.getCanvasTilePoly: the tile the player is drawn on.
                const points: Point[] = [];
                for (const [cx, cy] of [[x - 0.5, y - 0.5], [x + 0.5, y - 0.5], [x + 0.5, y + 0.5], [x - 0.5, y + 0.5]]) {
                    const p = scene.worldToScreen(cx, scene.tileHeight(cx, cy, plane, x, y), cy);
                    if (!p) break;
                    points.push([p[0], p[1]]);
                }
                if (points.length === 4) {
                    const [r, g, b] = rgba(player.color);
                    frame.shapes.push({ points, stroke: [r, g, b, 1], fill: [r, g, b, FILL_ALPHA] });
                }
            }
            if (scene && position !== "DISABLED") {
                const heightTiles = players.getDefaultHeightTiles?.(player.index);
                const logical = Number.isFinite(heightTiles) && heightTiles > 0 ? heightTiles * 128 : DEFAULT_LOGICAL_HEIGHT;
                const z = position === "ABOVE_HEAD" ? logical + ACTOR_OVERHEAD_TEXT_MARGIN : logical / 2;
                const p = scene.worldToScreen(x, scene.tileHeight(x, y, plane) - z / 128, y);
                if (p) {
                    const right = position === "MODEL_RIGHT";
                    frame.texts.push({
                        text: player.name,
                        x: right ? p[0] + ACTOR_HORIZONTAL_TEXT_MARGIN : p[0],
                        y: p[1],
                        color: player.color,
                        center: !right,
                    });
                }
            }
        }

        const minimap = this.minimap ? client.minimapGeometry : undefined;
        if (config.drawMinimapNames() === true && minimap && performance.now() - minimap.drawnAt < 500) {
            for (const player of highlighted) {
                if ((players.getLevel(player.index) | 0) !== minimap.plane) continue;
                const loc = minimap.worldToMinimap(players.getX(player.index) / 128, players.getY(player.index) / 128);
                if (loc) frame.texts.push({ text: player.name, x: loc[0], y: loc[1], color: player.color, center: false });
            }
        }

        frame.signature = frame.shapes.length + frame.texts.length === 0
            ? ""
            : JSON.stringify([
                frame.shapes.map((s) => [s.stroke, s.points.map(([px, py]) => [Math.round(px), Math.round(py)])]),
                frame.texts.map((t) => [t.text, t.color, Math.round(t.x), Math.round(t.y)]),
            ]);
        return frame;
    }
}

function rgba(rgb: number): Rgba {
    return [((rgb >> 16) & 0xff) / 255, ((rgb >> 8) & 0xff) / 255, (rgb & 0xff) / 255, 1];
}
