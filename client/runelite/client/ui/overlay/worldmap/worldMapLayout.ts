import type { WorldMapPoint } from "./WorldMapPoint";

export type MapBounds = { x: number; y: number; w: number; h: number };
export type PointLayout = { x: number; y: number; snapped: boolean };

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
