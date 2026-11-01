import { Model } from "../model/Model";
import { Scene } from "./Scene";

/**
 * How high a ground item stands on each tile holding a loc that supports items (a crate, a table):
 * the tallest such model, as the real client's obj stack does. Packed as level, tileX, tileY,
 * height per tile, with scene tile indices.
 */
export function collectObjSurfaceHeights(scene: Scene): Int32Array {
    const packed: number[] = [];
    for (let level = 0; level < scene.levels; level++) {
        for (let x = 0; x < scene.sizeX; x++) {
            for (let y = 0; y < scene.sizeY; y++) {
                let height = 0;
                for (const loc of scene.tiles[level][x][y]?.locs ?? []) {
                    if ((loc.flags & 256) === 0 || !(loc.entity instanceof Model)) continue;
                    loc.entity.calculateBoundsCylinder();
                    height = Math.max(height, loc.entity.height);
                }
                if (height > 0) packed.push(level, x, y, height);
            }
        }
    }
    return Int32Array.from(packed);
}

/** The height from `collectObjSurfaceHeights` at a scene tile, or 0. */
export function objSurfaceHeightAt(packed: Int32Array | undefined, level: number, x: number, y: number): number {
    if (!packed) return 0;
    for (let i = 0; i < packed.length; i += 4) {
        if (packed[i] === level && packed[i + 1] === x && packed[i + 2] === y) return packed[i + 3];
    }
    return 0;
}
