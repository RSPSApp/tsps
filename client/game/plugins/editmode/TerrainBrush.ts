import { generateHeight } from "../../../rs/util/HeightCalc";
import type { EditModeTile } from "./types";

export type TerrainBrushAction =
    "overlay" | "underlay" | "raise" | "lower" | "smooth" | "flatten" | "ramp" | "natural" | "block" | "unblock";

export type BrushTiming = "live" | "release";
export type BrushDab = EditModeTile & { weight: number };
export type BrushPassState = {
    visited: Set<number>;
    active: Map<number, number>;
};

export function createBrushPassState(): BrushPassState {
    return { visited: new Set(), active: new Map() };
}

export type TerrainBrush = {
    action: TerrainBrushAction;
    radius: number;
    shape: "round" | "square";
    soft: boolean;
    step: number;
    blend: number;
    underlay?: number;
};

export const DEFAULT_TERRAIN_BRUSH: TerrainBrush = {
    action: "overlay", radius: 0, shape: "round", soft: true, step: 4, blend: 100,
};

export function isHeightBrush(action: TerrainBrushAction): boolean {
    return action === "raise" || action === "lower" || action === "smooth" ||
        action === "flatten" || action === "ramp" || action === "natural";
}

export function naturalHeightByte(tile: EditModeTile): number {
    return tile.plane === 0 ? generateHeight(tile.tileX + 932731, tile.tileY + 556238) : 30;
}

/** Samples the whole segment so quick mouse movement does not leave holes in a stroke. */
export function* strokeLine(start: EditModeTile, end: EditModeTile): Generator<EditModeTile> {
    const dx = end.tileX - start.tileX;
    const dy = end.tileY - start.tileY;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    if (!steps) {
        yield start;
        return;
    }
    for (let index = 0; index <= steps; index++) {
        yield { ...start, tileX: start.tileX + Math.round(dx * index / steps), tileY: start.tileY + Math.round(dy * index / steps) };
    }
}

export function* terrainDab(center: EditModeTile, brush: TerrainBrush): Generator<BrushDab> {
    const radius = brush.radius;
    const vertices = isHeightBrush(brush.action);
    for (let dx = -radius; dx <= radius + Number(vertices); dx++) {
        for (let dy = -radius; dy <= radius + Number(vertices); dy++) {
            const x = vertices ? dx - 0.5 : dx;
            const y = vertices ? dy - 0.5 : dy;
            const distance = brush.shape === "round" ? Math.hypot(x, y) : Math.max(Math.abs(x), Math.abs(y));
            const reach = radius + (vertices ? 0.75 : 0.25);
            if (distance > reach) continue;
            const tileX = center.tileX + dx;
            const tileY = center.tileY + dy;
            if (tileX < 0 || tileY < 0 || tileX >= 16384 || tileY >= 16384) continue;
            const weight = brush.soft && radius > 0 ? Math.min(1, 2 * (1 - distance / (reach + 0.5))) : 1;
            yield { tileX, tileY, plane: center.plane, weight };
        }
    }
}

export const MAX_BRUSH_TILES = 4096;

export function brushTileKey(tile: EditModeTile): number {
    return tile.tileX * 16384 + tile.tileY;
}

/** Keep the strongest pass at each tile, so overlapping dabs do not stack. */
export function brushFootprint(
    path: readonly EditModeTile[],
    brush: TerrainBrush,
    weights = new Map<number, number>(),
): BrushDab[] {
    const updated = new Map<number, BrushDab>();
    for (let i = 0; i < path.length; i++) {
        for (const center of strokeLine(path[Math.max(0, i - 1)], path[i])) {
            for (const dab of terrainDab(center, brush)) {
                const key = brushTileKey(dab);
                const previous = weights.get(key);
                if (previous === undefined ? weights.size >= MAX_BRUSH_TILES : previous >= dab.weight) continue;
                weights.set(key, dab.weight);
                updated.set(key, dab);
            }
        }
    }
    return [...updated.values()];
}

/** Keep the strongest weight until a tile leaves the footprint. Reentry starts a new pass. */
export function* brushPasses(
    path: readonly EditModeTile[],
    brush: TerrainBrush,
    state = createBrushPassState(),
): Generator<(BrushDab & { entered: boolean })[]> {
    for (let i = 0; i < path.length; i++) {
        const centers = strokeLine(path[Math.max(0, i - 1)], path[i]);
        if (i > 0) centers.next();
        for (const center of centers) {
            const active = new Map<number, number>();
            const changed: (BrushDab & { entered: boolean })[] = [];
            for (const dab of terrainDab(center, brush)) {
                const key = brushTileKey(dab);
                if (!state.visited.has(key) && state.visited.size >= MAX_BRUSH_TILES) continue;
                state.visited.add(key);
                const previous = state.active.get(key);
                active.set(key, Math.max(previous ?? 0, dab.weight));
                if (previous === undefined || dab.weight > previous) changed.push({ ...dab, entered: previous === undefined });
            }
            state.active = active;
            if (changed.length) yield changed;
        }
    }
}

export function sculptHeight(current: number, target: number, weight: number): number {
    const result = Math.min(255, Math.max(0, Math.round(current + (target - current) * weight)));
    return result === 1 ? (target > current ? 2 : 0) : result;
}
