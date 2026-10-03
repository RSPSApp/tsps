import { type Boat, FINE_UNITS_PER_TILE } from "./Boat";

/** Answers whether a boat hull may cover a main-world tile. */
export type SailableTileCheck = (x: number, y: number, level: number) => boolean;

/** Hull sample spacing in fine units (half a tile), so thin hulls still cover every tile. */
const SAMPLE_STEP = 64;

/**
 * Main-world tiles covered by the boat's hull at a candidate position and facing. The hull
 * rectangle is sampled every half tile and rotated about the boat's centre.
 *
 * Based on rsmod's `BoatCollision.kt` (https://github.com/rsmod/rsmod, ISC license), but it
 * uses the world entity type's hull bounds instead of the whole template zone.
 */
export function hullTiles(boat: Boat, fineX: number, fineY: number, angle: number): Set<number> {
    const radians = (angle * Math.PI) / 1024;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const { offsetX, offsetY, width, length } = boat.hull;
    const tiles = new Set<number>();
    for (let lx = -width / 2 + SAMPLE_STEP / 2; lx < width / 2; lx += SAMPLE_STEP) {
        for (let ly = -length / 2 + SAMPLE_STEP / 2; ly < length / 2; ly += SAMPLE_STEP) {
            const x = lx + offsetX;
            const y = ly + offsetY;
            // Same rotation as angleToFineDelta: local "forward" (0, -1) maps to the facing.
            const wx = fineX + x * cos + y * sin;
            const wy = fineY + y * cos - x * sin;
            tiles.add(packTile(Math.floor(wx / FINE_UNITS_PER_TILE), Math.floor(wy / FINE_UNITS_PER_TILE)));
        }
    }
    return tiles;
}

/**
 * Whether the boat may move to a candidate position and facing. Only tiles the hull newly
 * covers are checked, so a boat that ends up overlapping land can still sail off it.
 */
export function canOccupy(
    boat: Boat,
    fineX: number,
    fineY: number,
    angle: number,
    isSailable: SailableTileCheck,
): boolean {
    const before = hullTiles(boat, boat.fineX, boat.fineY, boat.angle);
    for (const tile of hullTiles(boat, fineX, fineY, angle)) {
        if (before.has(tile)) continue;
        if (!isSailable(unpackTileX(tile), unpackTileY(tile), boat.level)) return false;
    }
    return true;
}

function packTile(x: number, y: number): number {
    return x * 0x8000 + y;
}

function unpackTileX(tile: number): number {
    return Math.floor(tile / 0x8000);
}

function unpackTileY(tile: number): number {
    return tile % 0x8000;
}
