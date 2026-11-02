import { regionIdOf } from "./EditorCoordinates";
import type { EditModeEdit, EditModeRegionOverlays, EditModeTile } from "./types";

/** One region's worth, the most Paint selection changes at once. */
export const MAX_FILL_TILES = 64 * 64;

const WORLD_SIZE = 0x4000;

export type OverlayFillResult =
    | { edits: EditModeEdit[] }
    | { error: "unloaded" | "no-overlay" | "same-overlay" | "too-large" };

/**
 * Repaints the overlay under `start`, and every tile joined to it by a side with the same overlay,
 * with `overlayId`. Each tile keeps its shape and rotation, so diagonal edges stay where they were.
 * Unloaded regions end the fill like any other border.
 */
export function fillOverlay(
    start: EditModeTile,
    overlayId: number,
    getRegion: (regionId: number) => EditModeRegionOverlays | undefined,
    maxTiles = MAX_FILL_TILES,
): OverlayFillResult {
    const plane = start.plane;
    const lookup = (tileX: number, tileY: number) => {
        if (tileX < 0 || tileY < 0 || tileX >= WORLD_SIZE || tileY >= WORLD_SIZE) return undefined;
        const region = getRegion(regionIdOf(tileX, tileY));
        return region && { region, index: (plane * 64 + (tileX & 63)) * 64 + (tileY & 63) };
    };
    const first = lookup(start.tileX, start.tileY);
    if (!first) return { error: "unloaded" };
    const target = first.region.overlays[first.index];
    if (target === 0) return { error: "no-overlay" };
    if (target === overlayId) return { error: "same-overlay" };

    const seen = new Set([start.tileX * WORLD_SIZE + start.tileY]);
    const queue = [start.tileX, start.tileY];
    const edits: EditModeEdit[] = [];
    for (let head = 0; head < queue.length; head += 2) {
        const tileX = queue[head];
        const tileY = queue[head + 1];
        const { region, index } = lookup(tileX, tileY)!;
        if (edits.length === maxTiles) return { error: "too-large" };
        edits.push({
            kind: "terrain",
            locId: overlayId,
            tileX,
            tileY,
            plane,
            shape: region.shapes[index],
            rotation: region.rotations[index],
        });
        for (const [nextX, nextY] of [[tileX + 1, tileY], [tileX - 1, tileY], [tileX, tileY + 1], [tileX, tileY - 1]]) {
            const key = nextX * WORLD_SIZE + nextY;
            if (seen.has(key)) continue;
            const next = lookup(nextX, nextY);
            if (next?.region.overlays[next.index] !== target) continue;
            seen.add(key);
            queue.push(nextX, nextY);
        }
    }
    return { edits };
}
