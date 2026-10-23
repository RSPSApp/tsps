import { Frustum } from "../game/Frustum";
import { DrawRange } from "./DrawRange";

const box = [[0, 0, 0], [0, 0, 0]];

export function sceneryRangeVisible(range: DrawRange, baseX: number, baseZ: number,
    playerX: number, playerZ: number, distance: number, lodDistance: number, lod: boolean,
    camera: Frustum, shadow?: Frustum): boolean {
    if (!shadow && range.chunk) {
        const x = range.chunk[0] + baseX, z = range.chunk[1] + baseZ;
        const near = Math.max(x - playerX, playerX - x - 8, z - playerZ, playerZ - z - 8, 0);
        if ((near > lodDistance) !== lod) return false;
    }
    const bounds = range.bounds;
    // Animation ranges without bounds stay conservative rather than disappearing.
    if (!bounds) return true;
    return sceneryBoundsVisible(bounds, baseX, baseZ, playerX, playerZ, distance, camera, shadow);
}

export function sceneryBoundsVisible(bounds: readonly number[], baseX: number, baseZ: number,
    playerX: number, playerZ: number, distance: number, camera: Frustum, shadow?: Frustum): boolean {
    box[0][0] = bounds[0] + baseX; box[0][1] = bounds[1]; box[0][2] = bounds[2] + baseZ;
    box[1][0] = bounds[3] + baseX; box[1][1] = bounds[4]; box[1][2] = bounds[5] + baseZ;
    if (shadow) return shadow.intersectsBox(box);
    const near = Math.max(box[0][0] - playerX, playerX - box[1][0], box[0][2] - playerZ, playerZ - box[1][2], 0);
    return near <= distance && camera.intersectsBox(box);
}
