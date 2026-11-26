import type { MinimapGeometry } from './SceneGeometry';

export type MinimapProjectionInput = {
    plane: number;
    scale: number;
    worldX: number;
    worldY: number;
    centerX: number;
    centerY: number;
    project(relX: number, relY: number): { x: number; y: number };
    /** Device-pixel hit test against the same mask the minimap paints through. */
    contains(x: number, y: number): boolean;
    now?: number;
};

/** Shared projection for visible pins and off-map direction indicators, at any zoom. */
export function createMinimapGeometry(input: MinimapProjectionInput): MinimapGeometry {
    const inside = (x: number, y: number, padding: number) =>
        [[0, 0], [-padding, -padding], [-padding, padding], [padding, -padding], [padding, padding]]
            .every(([dx, dy]) => input.contains(x + dx, y + dy));
    const project = (x: number, y: number) => input.project((x - input.worldX) * 4, (input.worldY - y) * 4);
    return {
        drawnAt: input.now ?? performance.now(), plane: input.plane, scale: input.scale,
        worldToMinimap(x, y) {
            const relX = (x - input.worldX) * 4;
            const relY = (input.worldY - y) * 4;
            // RuneLite's localToMinimap stops at 80 minimap pixels before zoom is applied.
            if (relX * relX + relY * relY >= 80 * 80) return undefined;
            const p = input.project(relX, relY);
            return [p.x, p.y];
        },
        projectMarker(x, y, padding = 6 * input.scale) {
            const p = project(x, y);
            if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return undefined;
            const dx = p.x - input.centerX, dy = p.y - input.centerY;
            const angle = Math.atan2(dy, dx);
            if (inside(p.x, p.y, padding)) return { ...p, edge: false, angle };
            if (!inside(input.centerX, input.centerY, padding)) return undefined;
            let low = 0, high = 1;
            for (let i = 0; i < 20; i++) {
                const t = (low + high) / 2;
                if (inside(input.centerX + dx * t, input.centerY + dy * t, padding)) low = t;
                else high = t;
            }
            return { x: input.centerX + dx * low, y: input.centerY + dy * low, edge: true, angle };
        },
    };
}
