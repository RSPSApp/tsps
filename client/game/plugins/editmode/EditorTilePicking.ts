import { rayIntersectsBox, rayIntersectsTriangle, type Ray } from "../../math/Raycast";
import { Scene } from "../../../rs/scene/Scene";
import type { EditModeTile } from "./types";

export interface EditorPickMap {
    heightMapData: Int16Array;
    heightMapSize: number;
    borderSize: number;
    getRenderBaseWorldX(): number;
    getRenderBaseWorldY(): number;
    getLocalTileSpan(): number;
}

/** Pick the edited floor's heightfield, including tiles with no rendered floor mesh. */
export function pickEditorTile(ray: Ray, plane: number, maps: readonly EditorPickMap[]): EditModeTile | undefined {
    let bestT = Infinity;
    let best: EditModeTile | undefined;
    for (const map of maps) {
        const size = map.heightMapSize, span = map.getLocalTileSpan();
        if (!size || !span || !map.heightMapData || map.heightMapData.length < (plane + 1) * size * size) continue;
        const baseX = map.getRenderBaseWorldX(), baseY = map.getRenderBaseWorldY();
        const bounds = rayIntersectsBox(ray, [baseX, -1000, baseY], [baseX + span, 1000, baseY + span]);
        if (!bounds) continue;
        const enter = Math.max(bounds.tMin, 0), exit = Math.min(bounds.tMax, bestT);
        if (enter > exit || exit <= 0) continue;
        const point = ray.at(Math.min(enter + 1e-6, exit));
        let x = Math.max(0, Math.min(span - 1, Math.floor(point[0] - baseX)));
        let y = Math.max(0, Math.min(span - 1, Math.floor(point[2] - baseY)));
        const dx = ray.direction[0], dy = ray.direction[2];
        const stepX = Math.sign(dx), stepY = Math.sign(dy);
        const deltaX = dx ? Math.abs(1 / dx) : Infinity;
        const deltaY = dy ? Math.abs(1 / dy) : Infinity;
        let nextX = dx ? (baseX + x + (stepX > 0 ? 1 : 0) - ray.origin[0]) / dx : Infinity;
        let nextY = dy ? (baseY + y + (stepY > 0 ? 1 : 0) - ray.origin[2]) / dy : Infinity;
        const height = (x: number, y: number) => {
            const index = plane * size * size + Math.min(y + map.borderSize, size - 1) * size + Math.min(x + map.borderSize, size - 1);
            return -map.heightMapData[index] * Scene.UNITS_TILE_HEIGHT_BASIS / 128;
        };
        // Walk only the tiles crossed by the ray, as the scene terrain picker does.
        for (let i = 0; i < span * 2 + 4; i++) {
            if (x < 0 || y < 0 || x >= span || y >= span) break;
            const a: [number, number, number] = [baseX + x, height(x, y), baseY + y];
            const b: [number, number, number] = [baseX + x + 1, height(x + 1, y), baseY + y];
            const c: [number, number, number] = [baseX + x + 1, height(x + 1, y + 1), baseY + y + 1];
            const d: [number, number, number] = [baseX + x, height(x, y + 1), baseY + y + 1];
            const t = Math.min(rayIntersectsTriangle(ray, a, b, c) ?? Infinity, rayIntersectsTriangle(ray, a, c, d) ?? Infinity);
            if (t >= enter - 1e-4 && t <= exit + 1e-4 && t < bestT) {
                bestT = t;
                best = { tileX: baseX + x, tileY: baseY + y, plane };
            }
            const next = Math.min(nextX, nextY);
            if (!Number.isFinite(next) || next > exit || next > bestT) break;
            if (nextX === next) { x += stepX; nextX += deltaX; }
            if (nextY === next) { y += stepY; nextY += deltaY; }
        }
    }
    return best;
}
