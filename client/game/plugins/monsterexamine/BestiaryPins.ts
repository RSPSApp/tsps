import { GameState } from '@runelite/api/GameState';
import type { GameStateChanged, PluginMessage } from '@runelite/api/events';
import { ClientState } from '../../ClientState';
import type { OsrsClient } from '../../OsrsClient';
import { toRuneLiteGameState } from '../../../runelite/impl/GameStateMapping';
import { send } from '../../../network/serverConnection/connection/send';
import type { WidgetOverlay, WidgetOverlayDrawContext, WorldMapOverlayContext } from '../ClientPluginManager';

type Point = { x: number; y: number; plane: number };
type Selection = { npcId: number; name: string; points: Point[]; expiresAt: number; index: number };
type Shape = { points: [number, number][]; edge: boolean };
const CHANNEL = 'bestiary';
const MAX_PINS = 256;
const MAX_LIFETIME_MS = 10 * 60 * 1000;
const GOLD: [number, number, number, number] = [1, 0.82, 0.5, 1];
const CYAN: [number, number, number, number] = [0.2, 1, 1, 1];
const BLACK: [number, number, number, number] = [0, 0, 0, 1];

/** Session-only public spawn markers. The server owns the data and selection. */
export class BestiaryPins implements WidgetOverlay {
    private revision = -1;
    private selected?: Selection;
    private frame?: Shape[];
    private pendingFocus?: Point;
    constructor(private readonly client: OsrsClient) {}

    start(): void {
        if (toRuneLiteGameState(this.client.gameState) === GameState.LOGGED_IN) this.announce(true);
    }
    stop(): void {
        this.clear();
        if (toRuneLiteGameState(this.client.gameState) === GameState.LOGGED_IN) this.announce(false);
    }
    private announce(enabled: boolean): void {
        send({ type: 'plugin_message', payload: { channel: CHANNEL, data: { type: 'client-state', enabled } } });
    }
    clear(): void { this.selected = undefined; this.frame = undefined; this.pendingFocus = undefined; }
    onGameStateChanged(event: GameStateChanged): void {
        const state = event.getGameState();
        if (state === GameState.LOGGED_IN) this.announce(true);
        if (state === GameState.LOGIN_SCREEN || state === GameState.HOPPING || state === GameState.CONNECTION_LOST) {
            this.clear(); this.revision = -1;
        }
    }
    onPluginMessage(event: PluginMessage): void {
        if (event.channel !== CHANNEL) return;
        const data = event.data;
        if (data.type === 'unavailable') { this.clear(); this.revision = -1; return; }
        if (!Number.isSafeInteger(data.revision) || Number(data.revision) <= this.revision) return;
        this.revision = Number(data.revision);
        this.clear();
        if (data.type !== 'find' || !Number.isInteger(data.npcId) || Number(data.npcId) < 0
            || typeof data.name !== 'string' || !Array.isArray(data.points) || data.points.length > MAX_PINS
            || typeof data.expiresAt !== 'number' || !Number.isFinite(data.expiresAt)) return;
        const points: Point[] = [];
        const keys = new Set<string>();
        for (const p of data.points) {
            if (!p || !Number.isInteger(p.x) || p.x < 0 || p.x > 16383 || !Number.isInteger(p.y)
                || p.y < 0 || p.y > 16383 || !Number.isInteger(p.plane) || p.plane < 0 || p.plane > 3) continue;
            const key = `${p.x}:${p.y}:${p.plane}`;
            if (keys.has(key)) continue;
            keys.add(key); points.push({ x: p.x, y: p.y, plane: p.plane });
        }
        const index = Number.isInteger(data.focusIndex) && Number(data.focusIndex) >= 0 && Number(data.focusIndex) < points.length
            ? Number(data.focusIndex) : 0;
        this.selected = { npcId: Number(data.npcId), name: data.name.replace(/<[^>]*>/g, '').slice(0, 100), points, index,
            expiresAt: Math.min(data.expiresAt, Date.now() + MAX_LIFETIME_MS) };
        this.pendingFocus = points[index];
    }
    selection(): Selection | undefined {
        if (this.selected && Date.now() >= this.selected.expiresAt) this.clear();
        return this.selected;
    }
    private shapes(): Shape[] {
        const selection = this.selection(), map = this.client.minimapGeometry;
        if (!selection || !map || performance.now() - map.drawnAt >= 500 || ClientState.inInstance) return [];
        const state = this.client.playerMovementSync?.getState?.(this.client.controlledPlayerServerId);
        if (!state || (state.level | 0) !== map.plane) return [];
        const shapes: Shape[] = [], edges = new Map<number, { p: Point; distance: number }>();
        const s = Math.max(1, map.scale);
        for (const p of selection.points) {
            if (p.plane !== map.plane) continue;
            const projected = map.projectMarker?.(p.x + 0.5, p.y + 0.5, 6 * s);
            const fallback = projected ? undefined : map.worldToMinimap(p.x + 0.5, p.y + 0.5);
            if (!projected && !fallback) continue;
            const x = projected?.x ?? fallback![0], y = projected?.y ?? fallback![1];
            if (projected?.edge) {
                const sector = (Math.round(projected.angle / (Math.PI / 4)) + 8) % 8;
                const distance = Math.hypot(p.x - state.tileX, p.y - state.tileY);
                if (!edges.has(sector) || distance < edges.get(sector)!.distance) edges.set(sector, { p, distance });
            } else {
                shapes.push({ edge: false, points: [[x, y - 4 * s], [x + 4 * s, y], [x, y + 4 * s], [x - 4 * s, y]] });
            }
        }
        for (const { p } of edges.values()) {
            const q = map.projectMarker!(p.x + 0.5, p.y + 0.5, 6 * s)!;
            const dx = Math.cos(q.angle) * s, dy = Math.sin(q.angle) * s;
            shapes.push({ edge: true, points: [[q.x + dx * 5, q.y + dy * 5],
                [q.x - dx * 3 - dy * 3, q.y - dy * 3 + dx * 3],
                [q.x - dx * 3 + dy * 3, q.y - dy * 3 - dx * 3]] });
        }
        return shapes;
    }
    signature(): string {
        const focus = this.pendingFocus, map = this.client.worldMapState;
        if (focus && map?.mapAreaAtCoord(focus.plane, focus.x, focus.y)
            && [...(this.client.widgetManager?.interfaceParents?.values() ?? [])].some(parent => parent.group === 595)) {
            map.setCurrentMapAreaAndPosition(focus.plane, focus.x, focus.y);
            this.pendingFocus = undefined;
            const root = this.client.widgetManager.getGroupRoot(595);
            if (root) this.client.widgetManager.invalidateWidgetRender(root);
        }
        const selection = this.selection();
        this.frame = this.shapes();
        // A selection can change entirely outside the minimap. Still invalidate
        // the shared widget layer so its world-map pins clear/change at once.
        return JSON.stringify([selection ? this.revision : null, selection ? this.phase() : null, this.frame, this.client.worldMapState?.getCurrentMapAreaId(),
            this.client.worldMapState?.displayX, this.client.worldMapState?.displayY]);
    }
    private phase(): number { return Math.floor(Date.now() / 650) % 2; }
    private color(): [number, number, number, number] { return this.phase() ? CYAN : GOLD; }
    draw(context: WidgetOverlayDrawContext): { x: number; y: number; w: number; h: number }[] {
        const frame = this.frame ?? this.shapes();
        this.frame = undefined;
        const rects = [];
        const color = this.color();
        for (const shape of frame) {
            if (shape.edge) context.renderer.drawPolygon(shape.points, color);
            context.renderer.drawPolyline(shape.points, 4, BLACK, true);
            context.renderer.drawPolyline(shape.points, 2, color, true);
            const xs = shape.points.map(p => p[0]), ys = shape.points.map(p => p[1]);
            const x = Math.min(...xs) - 2, y = Math.min(...ys) - 2;
            rects.push({ x, y, w: Math.max(...xs) - x + 2, h: Math.max(...ys) - y + 2 });
        }
        return rects;
    }
    drawWorldMap(context: WorldMapOverlayContext): void {
        const selection = this.selection(), color = this.color();
        for (const [index, p] of (selection?.points ?? []).entries()) {
            const q = context.worldToScreen(p.x + 0.5, p.y + 0.5, p.plane);
            const b = context.bounds, s = index === selection?.index ? 8 : 5;
            if (!q || q.x - s < b.x || q.y - s < b.y || q.x + s > b.x + b.w || q.y + s > b.y + b.h) continue;
            context.renderer.drawPolyline([[q.x, q.y - s - 2], [q.x + s + 2, q.y], [q.x, q.y + s + 2], [q.x - s - 2, q.y]], 4, BLACK, true);
            context.renderer.drawPolyline([[q.x, q.y - s], [q.x + s, q.y], [q.x, q.y + s], [q.x - s, q.y]], 2, color, true);
        }
    }
}
