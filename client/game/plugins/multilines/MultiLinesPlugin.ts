import type { ConfigOf } from "@runelite/client/config/ConfigItem";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { GameState } from "@runelite/api/GameState";
import { toRuneLiteGameState } from "../../../runelite/impl/GameStateMapping";
import type { OsrsClient } from "../../OsrsClient";
import type { WidgetOverlay, WidgetOverlayDrawContext } from "../ClientPluginManager";
import { argbToRgba } from "../npcindicators/NpcIndicatorsConfig";
import { MultiLinesConfig } from "./MultiLinesConfig";
import { state } from "../../../network/serverConnection/state";
import { fetchContent } from "../../../network/serverConnection/contentApi";
import { multiBorders, wildernessLines, type Box, type Segment } from "./multiLines";

type Rgba = [number, number, number, number];
type Line = { points: [number, number][]; color: Rgba };
type Rect = { x: number; y: number; w: number; h: number };

/** Tiles drawn each side of the player (RuneLite draws the loaded scene; this is its visible part). */
const RADIUS = 32;

/** RuneLite's Multi-Lines: multicombat borders and the Wilderness level 20/30 lines, in the scene and on the minimap. */
export class MultiLinesPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Multi-Lines",
        enabledByDefault: false,
        description: "Draws the borders of multicombat areas and the Wilderness level lines",
        tags: ["multicombat", "pvp", "wilderness", "overlay", "minimap"],
        configKey: "multiindicatorsplugin",
    };

    static config = MultiLinesConfig;

    readonly config: ConfigOf<typeof MultiLinesConfig>;
    private readonly overlays: WidgetOverlay[];
    /** The server's multicombat boxes, fetched on start-up. */
    boxes: Box[] = [];

    constructor(private readonly osrsClient?: OsrsClient, deps?: { configManager?: ConfigManager }) {
        super();
        this.osrsClient ??= inject<OsrsClient>(CLIENT_TOKEN);
        this.config = (deps?.configManager ?? inject(ConfigManager)).getConfig(MultiLinesConfig);
        this.overlays = [new MultiLinesOverlay(this, false), new MultiLinesOverlay(this, true)];
    }

    private connection: unknown;
    private loading = false;
    private retryAt = 0;

    /** Keep bounds tied to the live world and discard responses from an old connection. */
    private load(): void {
        const connection = state.socket;
        if (connection !== this.connection) {
            this.connection = connection;
            this.boxes = [];
            this.loading = false;
            this.retryAt = 0;
        }
        if (this.loading || performance.now() < this.retryAt) return;
        this.loading = true;
        fetchContent("/api/multi-combat").then(
            (boxes) => { if (state.socket === connection) this.boxes = boxes; },
            (error) => {
                if (state.socket !== connection) return;
                console.warn("[multi-lines] could not load multicombat bounds", error);
                this.loading = false;
                this.retryAt = performance.now() + 10_000;
            },
        );
    }

    widgetOverlays(): WidgetOverlay[] {
        return this.isStarted() ? this.overlays : [];
    }

    getClient(): OsrsClient {
        return this.osrsClient!;
    }

    /** The player's tile, when logged in. */
    playerTile(): { x: number; y: number; plane: number } | undefined {
        const client: any = this.osrsClient;
        if (toRuneLiteGameState(client?.gameState) !== GameState.LOGGED_IN) return undefined;
        const index = client.playerEcs?.getIndexForServerId?.(client.controlledPlayerServerId);
        if (index === undefined) return undefined;
        const p = client.playerEcs;
        return { x: p.getX(index) >> 7, y: p.getY(index) >> 7, plane: p.getLevel(index) | 0 };
    }

    /** The segments to draw around the player, multicombat then Wilderness lines. */
    segments(): { multi: Segment[]; wilderness: Segment[]; plane: number } | undefined {
        const p = this.playerTile();
        if (!p) return undefined;
        this.load();
        const w = { minX: p.x - RADIUS, maxX: p.x + RADIUS, minY: p.y - RADIUS, maxY: p.y + RADIUS };
        return {
            plane: p.plane,
            multi: multiBorders(this.boxes, p.plane, w),
            wilderness: this.config.showWildernessLines() ? wildernessLines(w) : [],
        };
    }
}

export class MultiLinesOverlay implements WidgetOverlay {
    readonly drawBelowWidgets: boolean;
    private lines?: Line[];

    constructor(private readonly plugin: MultiLinesPlugin, private readonly minimap: boolean) {
        this.drawBelowWidgets = !minimap;
    }

    signature(): string {
        this.lines = this.build();
        return JSON.stringify([this.minimap ? 1 : this.plugin.config.borderWidth(), this.lines.map((l) => [l.points.map(([x, y]) => [Math.round(x), Math.round(y)]), l.color])]);
    }

    draw(context: WidgetOverlayDrawContext): Rect[] {
        const lines = this.lines ?? this.build();
        this.lines = undefined;
        const glr = context.renderer as any;
        const width = this.minimap ? 1 : Math.max(0, Number(this.plugin.config.borderWidth()) || 0);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const { points, color } of lines) {
            glr.drawPolyline?.(points, width, color, false);
            for (const [x, y] of points) {
                minX = Math.min(minX, x - width); minY = Math.min(minY, y - width);
                maxX = Math.max(maxX, x + width); maxY = Math.max(maxY, y + width);
            }
        }
        return Number.isFinite(minX) ? [{ x: minX, y: minY, w: maxX - minX, h: maxY - minY }] : [];
    }

    private build(): Line[] {
        const plugin = this.plugin;
        const { config } = plugin;
        if (!plugin.isStarted() || !(this.minimap ? config.showOnMinimap() : config.showInScene())) return [];
        const client: any = plugin.getClient();
        const geometry = this.minimap ? client.minimapGeometry : client.sceneGeometry;
        const segs = plugin.segments();
        if (!geometry || !segs) return [];
        if (this.minimap && (performance.now() - geometry.drawnAt >= 500 || geometry.plane !== segs.plane)) return [];
        const project = this.minimap
            ? (x: number, y: number) => geometry.worldToMinimap(x, y)
            : (x: number, y: number) => geometry.worldToScreen(x, geometry.tileHeight(x, y, segs.plane), y);
        const out: Line[] = [];
        const add = (list: Segment[], argb: number) => {
            const color = argbToRgba(argb);
            for (const s of list) {
                // A point per tile along the run, so the line follows the terrain.
                const n = Math.max(s.x2 - s.x1, s.y2 - s.y1);
                const points: [number, number][] = [];
                for (let i = 0; i <= n; i++) {
                    const p = project(s.x1 + (s.x2 > s.x1 ? i : 0), s.y1 + (s.y2 > s.y1 ? i : 0));
                    if (p) points.push([p[0], p[1]]);
                }
                if (points.length >= 2) out.push({ points, color });
            }
        };
        add(segs.multi, Number(config.multicombatColor()) >>> 0);
        add(segs.wilderness, Number(config.wildernessLineColor()) >>> 0);
        return out;
    }
}
