import { brushTileKey, DEFAULT_TERRAIN_BRUSH, MAX_BRUSH_TILES, strokeLine, terrainDab } from "./TerrainBrush";
import type { EditModeTile } from "./types";

export const MIN_SCATTER_DENSITY = 0.001;
export const MAX_SCATTER_DENSITY = 0.6;

type Offset = readonly [number, number];
type BrushMask = { offsets: Offset[]; entering: Map<number, Offset[]> };
const masks = new Map<number, BrushMask>();

function scatterMask(radius: number): BrushMask {
    const cached = masks.get(radius);
    if (cached) return cached;
    const offsets: Offset[] = [];
    for (const tile of terrainDab({ tileX: radius, tileY: radius, plane: 0 }, { ...DEFAULT_TERRAIN_BRUSH, radius, soft: false })) {
        offsets.push([tile.tileX - radius, tile.tileY - radius]);
    }
    const occupied = new Set(offsets.map(([x, y]) => x * 64 + y));
    const entering = new Map<number, Offset[]>();
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            entering.set(dx * 3 + dy, offsets.filter(([x, y]) => !occupied.has((x + dx) * 64 + y + dy)));
        }
    }
    const mask = { offsets, entering };
    masks.set(radius, mask);
    return mask;
}

export type ScatterPass = { visited: Set<number>; center?: EditModeTile };

/** A round dab only needs to visit the leading edge when its center moves one tile. */
export function* scatterBrushPasses(
    path: readonly EditModeTile[],
    radius: number,
    pass: ScatterPass = { visited: new Set() },
    allowReentry = true,
): Generator<EditModeTile> {
    const mask = scatterMask(radius);
    for (let index = 0; index < path.length; index++) {
        for (const center of strokeLine(path[Math.max(0, index - 1)], path[index])) {
            const previous = pass.center;
            const offsets = previous
                ? mask.entering.get((center.tileX - previous.tileX) * 3 + center.tileY - previous.tileY)!
                : mask.offsets;
            pass.center = center;
            for (const [dx, dy] of offsets) {
                const tileX = center.tileX + dx;
                const tileY = center.tileY + dy;
                if (tileX < 0 || tileY < 0 || tileX >= 16384 || tileY >= 16384) continue;
                const tile = { tileX, tileY, plane: center.plane };
                const key = brushTileKey(tile);
                if (pass.visited.has(key) ? !allowReentry : pass.visited.size >= MAX_BRUSH_TILES) continue;
                pass.visited.add(key);
                yield tile;
            }
        }
    }
}
