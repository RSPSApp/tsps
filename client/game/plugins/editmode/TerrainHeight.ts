import type { EditModeTile } from "./types";
import { WORLD_COORD_MAX } from "./EditorCoordinates";

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

/** Heights are stored at south-west vertices. Level the far north and east edges as well. */
export function levelFoundation(
    low: EditModeTile,
    width: number,
    depth: number,
    sample: (tile: EditModeTile) => number | undefined,
    keep: (tile: EditModeTile) => boolean,
    isMapped: (tile: EditModeTile) => boolean = () => true,
): { tile: EditModeTile; height: number }[] {
    const maxX = low.tileX + width;
    const maxY = low.tileY + depth;
    if (maxX - 1 > WORLD_COORD_MAX || maxY - 1 > WORLD_COORD_MAX) throw new Error("The foundation would reach past the map edge");
    const core: number[] = [];
    let minimum = -Infinity;
    let maximum = Infinity;
    const below = (tile: EditModeTile) => tile.plane === 0 ? 0 : sample({ ...tile, plane: tile.plane - 1 });
    for (let x = low.tileX; x <= Math.min(maxX, WORLD_COORD_MAX); x++) for (let y = low.tileY; y <= Math.min(maxY, WORLD_COORD_MAX); y++) {
        const tile = { tileX: x, tileY: y, plane: low.plane };
        if (!isMapped(tile)) continue;
        const base = below(tile);
        const current = sample(tile);
        if (base === undefined || current === undefined) {
            if (x === maxX || y === maxY) continue;
            throw new Error("Move the camera closer so the whole stamp footprint is visible");
        }
        core.push(current);
        minimum = Math.max(minimum, base - 255 / HEIGHT_BYTES_PER_TILE);
        maximum = Math.min(maximum, base);
    }
    if (minimum > maximum) throw new Error("The ground below varies too much for a level foundation on this plane");
    core.sort((a, b) => a - b);
    const target = Math.max(minimum, Math.min(maximum, core[core.length >> 1]));
    const blend = 2;
    const edits: { tile: EditModeTile; height: number }[] = [];
    for (let x = Math.max(0, low.tileX - blend); x <= Math.min(WORLD_COORD_MAX, maxX + blend); x++) {
        for (let y = Math.max(0, low.tileY - blend); y <= Math.min(WORLD_COORD_MAX, maxY + blend); y++) {
            const tile = { tileX: x, tileY: y, plane: low.plane };
            if (!isMapped(tile)) continue;
            const ring = Math.max(low.tileX - x, x - maxX, low.tileY - y, y - maxY, 0);
            if (ring && keep(tile)) continue;
            const base = below(tile);
            const current = sample(tile);
            if (base === undefined || current === undefined) continue;
            const next = target + (current - target) * ring / (blend + 1);
            const byte = heightToByte(next, base);
            const height = byte === 1 ? 0 : byte;
            if (height !== heightToByte(current, base)) edits.push({ tile, height });
        }
    }
    return edits;
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
