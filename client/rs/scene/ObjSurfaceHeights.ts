import { Model } from "../model/Model";
import { Scene } from "./Scene";

/**
 * How high a ground item stands on each tile holding a loc that supports items (a crate, a table):
 * the tallest such model, as the real client's obj stack does. A grid by [level][tileX][tileY], with
 * scene tile indices, like Scene.tileRenderFlags. A door-only build has no loc models, so all 0.
 */
export function collectObjSurfaceHeights(scene: Scene): Int16Array[][] {
    const heights: Int16Array[][] = [];
    for (let level = 0; level < scene.levels; level++) {
        heights[level] = [];
        for (let x = 0; x < scene.sizeX; x++) {
            const column = (heights[level][x] = new Int16Array(scene.sizeY));
            for (let y = 0; y < scene.sizeY; y++) {
                for (const loc of scene.tiles[level][x][y]?.locs ?? []) {
                    if ((loc.flags & 256) === 0 || !(loc.entity instanceof Model)) continue;
                    loc.entity.calculateBoundsCylinder();
                    column[y] = Math.max(column[y], loc.entity.height);
                }
            }
        }
    }
    return heights;
}

/** The height from `collectObjSurfaceHeights` at a scene tile, or 0. */
export function objSurfaceHeightAt(heights: Int16Array[][] | undefined, level: number, x: number, y: number): number {
    return heights?.[level]?.[x]?.[y] ?? 0;
}
