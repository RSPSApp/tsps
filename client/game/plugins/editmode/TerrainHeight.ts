import type { EditModeTile } from "./types";

export type TileCorner = "sw" | "se" | "ne" | "nw";

/** Terrain stores height in bytes of 1/16 tile, measured up from the plane below. */
const HEIGHT_BYTES_PER_TILE = 16;
const MAX_HEIGHT_BYTE = 255;

export interface VertexRange {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

export function heightToByte(height: number, below: number): number {
    return Math.max(0, Math.min(MAX_HEIGHT_BYTE, Math.round((below - height) * HEIGHT_BYTES_PER_TILE)));
}

export function cornerVertex(tile: EditModeTile, corner: TileCorner): VertexRange {
    const x = tile.tileX + (corner === "se" || corner === "ne" ? 1 : 0);
    const y = tile.tileY + (corner === "nw" || corner === "ne" ? 1 : 0);
    return { minX: x, maxX: x, minY: y, maxY: y };
}

/**
 * Moves a block of vertices by delta height bytes. `smoothing` rings of vertices around it take a
 * share that falls off with distance, so the surrounding ground slopes up to meet the block.
 */
export function adjustHeightBytes(
    vertices: VertexRange,
    delta: number,
    smoothing: number,
    read: (x: number, y: number) => number | undefined,
): { tileX: number; tileY: number; height: number }[] {
    const changed: { tileX: number; tileY: number; height: number }[] = [];
    for (let x = vertices.minX - smoothing; x <= vertices.maxX + smoothing; x++) {
        for (let y = vertices.minY - smoothing; y <= vertices.maxY + smoothing; y++) {
            const current = read(x, y);
            if (current === undefined) continue;
            const distance = Math.max(vertices.minX - x, x - vertices.maxX, vertices.minY - y, y - vertices.maxY, 0);
            const share = Math.sign(delta) * Math.round(Math.abs(delta) * (smoothing + 1 - distance) / (smoothing + 1));
            let height = Math.max(0, Math.min(MAX_HEIGHT_BYTE, current + share));
            // The map format reads a stored 1 as 0, so that height cannot exist.
            if (height === 1) height = delta > 0 ? 2 : 0;
            if (height !== current) changed.push({ tileX: x, tileY: y, height });
        }
    }
    return changed;
}
