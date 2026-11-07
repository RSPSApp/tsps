import type { WorldMapPoint } from "./WorldMapPoint";
import type { WorldMapPointManager } from "./WorldMapPointManager";

export type MapBounds = { x: number; y: number; w: number; h: number };
export type PointLayout = { x: number; y: number; snapped: boolean };

/** The owner tag RuneLite points carry in the client's plugin-point list. */
export const RUNELITE_POINT_OWNER = "runelite";

/**
 * An entry in the client's `pluginWorldMapPoints` (the list Quest Helper also writes): the tile,
 * a colour for a plain square, edge snapping, and for RuneLite points the WorldMapPoint itself,
 * whose image, anchor, name and jump-on-click the world map reads.
 */
export type PluginWorldMapPointEntry = {
    x: number;
    y: number;
    plane: number;
    color: number;
    snapToEdge: boolean;
    texture?: string;
    owner: string;
    point?: WorldMapPoint;
};

/**
 * Rewrites the RuneLite entries of the client's plugin-point list from the manager; other owners'
 * entries stay. An entry reads its tile and snapping from the point each time, so a point moved
 * with `setWorldPoint` after `add` draws, and jumps, at its current tile.
 */
export function syncWorldMapPoints(client: { pluginWorldMapPoints?: PluginWorldMapPointEntry[] }, manager: WorldMapPointManager): void {
    const others = (client.pluginWorldMapPoints ?? []).filter((entry) => entry.owner !== RUNELITE_POINT_OWNER);
    const ours: PluginWorldMapPointEntry[] = manager.getPoints().map((point) => ({
        get x() { return point.getWorldPoint().getX(); },
        get y() { return point.getWorldPoint().getY(); },
        get plane() { return point.getWorldPoint().getPlane(); },
        color: 0xffffff,
        get snapToEdge() { return point.isSnapToEdge(); },
        owner: RUNELITE_POINT_OWNER,
        point,
    }));
    client.pluginWorldMapPoints = [...others, ...ours];
}

/** Where a RuneLite point drew this frame, for its tooltip and click-to-jump. */
export type RenderedWorldMapPoint = { x0: number; y0: number; x1: number; y1: number; point: WorldMapPoint };

/** The topmost rendered point under a map position; with `jumpOnly`, only one that jumps on click. */
export function renderedWorldMapPointAt(rendered: readonly RenderedWorldMapPoint[], x: number, y: number, jumpOnly = false): WorldMapPoint | null {
    for (let i = rendered.length - 1; i >= 0; i--) {
        const r = rendered[i];
        if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) continue;
        if (jumpOnly && !r.point.isJumpOnClick()) continue;
        return r.point;
    }
    return null;
}

/** The size a point without an image takes on the map. */
const DEFAULT_SIZE = 16;

/**
 * Where a world map point's image draws (its top left) for a projected tile position, as RuneLite's
 * WorldMapOverlay places it: the anchor on the tile when the tile is on the map; clamped to the
 * map's edge when it is off the map and the point snaps; nothing otherwise. Fires the point's
 * edge snap and unsnap hooks on the transitions. `scale` scales the image for high-density canvases.
 */
export function layoutWorldMapPoint(point: WorldMapPoint, projected: { x: number; y: number }, bounds: MapBounds, scale = 1): PointLayout | null {
    const image = point.getImage();
    const width = (image ? image.width : DEFAULT_SIZE) * scale;
    const height = (image ? image.height : DEFAULT_SIZE) * scale;
    const anchor = point.getImagePoint();
    const anchorX = anchor ? anchor.x * scale : Math.trunc(width / 2);
    const anchorY = anchor ? anchor.y * scale : Math.trunc(height / 2);
    const inside = projected.x >= bounds.x && projected.y >= bounds.y && projected.x <= bounds.x + bounds.w && projected.y <= bounds.y + bounds.h;

    if (!inside && !point.isSnapToEdge()) {
        if (point.isCurrentlyEdgeSnapped()) {
            point.setCurrentlyEdgeSnapped(false);
            point.onEdgeUnsnap();
        }
        return null;
    }

    if (inside) {
        if (point.isCurrentlyEdgeSnapped()) {
            point.setCurrentlyEdgeSnapped(false);
            point.onEdgeUnsnap();
        }
        return { x: projected.x - anchorX, y: projected.y - anchorY, snapped: false };
    }

    if (!point.isCurrentlyEdgeSnapped()) {
        point.setCurrentlyEdgeSnapped(true);
        point.onEdgeSnap();
    }
    // The snapped image may differ in size; read it again after the hook.
    const edgeImage = point.getImage();
    const edgeWidth = (edgeImage ? edgeImage.width : DEFAULT_SIZE) * scale;
    const edgeHeight = (edgeImage ? edgeImage.height : DEFAULT_SIZE) * scale;
    const edgeAnchor = point.getImagePoint();
    const ax = edgeAnchor ? edgeAnchor.x * scale : Math.trunc(edgeWidth / 2);
    const ay = edgeAnchor ? edgeAnchor.y * scale : Math.trunc(edgeHeight / 2);
    const x = Math.min(Math.max(projected.x - ax, bounds.x), bounds.x + bounds.w - edgeWidth);
    const y = Math.min(Math.max(projected.y - ay, bounds.y), bounds.y + bounds.h - edgeHeight);
    return { x, y, snapped: true };
}
