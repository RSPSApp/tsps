import { Scene } from "../../rs/scene/Scene";
import type { MapManager, MapSquare } from "../MapManager";
import { clampPlane } from "../utils/PlaneUtil";
import { BridgePlaneStrategy, resolveBridgePlaneForLocal } from "./PlaneResolver";
import type { TileFlagMapSquare } from "./TileRenderFlags";

type HeightMapBridgeMapSquare = TileFlagMapSquare & {
    borderSize?: number;
    heightMapSize?: number;
    heightMapData?: Int16Array;
};

export interface BridgeHeightSample {
    plane: number;
    height: number;
    /** True when actual height data was available; false if returning fallback (e.g., map not loaded). */
    valid: boolean;
}

/** The rendered terrain keeps its higher-diagonal surface for scenery and depth. */
export function interpolateTerrainHeight(h00: number, h10: number, h01: number, h11: number,
    x: number, y: number): number {
    const first = x + y <= 1
        ? h00 + (h10 - h00) * x + (h01 - h00) * y
        : h11 + (h01 - h11) * (1 - x) + (h10 - h11) * (1 - y);
    const second = x <= y
        ? h00 + (h01 - h00) * y + (h11 - h01) * x
        : h00 + (h10 - h00) * x + (h11 - h10) * y;
    return Math.max(first, second);
}

/** Actor grounding uses getTileHeight's bilinear surface, independent of terrain triangles. */
export function interpolateActorHeight(h00: number, h10: number, h01: number, h11: number,
    x: number, y: number): number {
    const row0 = h00 + (h10 - h00) * x;
    const row1 = h01 + (h11 - h01) * x;
    return row0 + (row1 - row0) * y;
}

export function sampleBridgeHeightForWorldTile<T extends MapSquare>(
    mapManager: MapManager<T>, worldX: number, worldY: number, basePlane: number,
    strategy: BridgePlaneStrategy = BridgePlaneStrategy.RENDER,
): BridgeHeightSample {
    return sampleHeightForWorldTile(mapManager, worldX, worldY, basePlane, strategy, false);
}

/** Actor origins use the native floor without changing scenery's rendered surface. */
export function sampleActorHeightForWorldTile<T extends MapSquare>(
    mapManager: MapManager<T>, worldX: number, worldY: number, basePlane: number,
    strategy: BridgePlaneStrategy = BridgePlaneStrategy.RENDER,
): BridgeHeightSample {
    return sampleHeightForWorldTile(mapManager, worldX, worldY, basePlane, strategy, false, interpolateActorHeight);
}

/** Scripted cameras keep getTileHeight's integer rounding; actor positions stay smooth. */
export function sampleCameraHeightForWorldTile<T extends MapSquare>(
    mapManager: MapManager<T>, worldX: number, worldY: number, basePlane: number,
): number | undefined {
    const sample = sampleHeightForWorldTile(mapManager, worldX, worldY, basePlane, BridgePlaneStrategy.RENDER, true);
    return sample.valid ? sample.height : undefined;
}

function sampleHeightForWorldTile<T extends MapSquare>(
    mapManager: MapManager<T>, worldX: number, worldY: number, basePlane: number,
    strategy: BridgePlaneStrategy, cameraBilinear: boolean, interpolate = interpolateTerrainHeight,
): BridgeHeightSample {
    const map = mapManager.getMapForWorldTile(worldX, worldY) as HeightMapBridgeMapSquare | undefined;
    const result: BridgeHeightSample = {
        plane: clampPlane(basePlane),
        height: 0,
        valid: false,
    };
    if (!map || !map.heightMapData || typeof map.heightMapSize !== "number") {
        return result;
    }

    const mapWorldX = map.getRenderBaseTileX?.() ?? map.mapX * Scene.MAP_SQUARE_SIZE;
    const mapWorldY = map.getRenderBaseTileY?.() ?? map.mapY * Scene.MAP_SQUARE_SIZE;
    const localPxX = (worldX - mapWorldX) * 128;
    const localPxY = (worldY - mapWorldY) * 128;

    let tileX = localPxX >> 7;
    let tileY = localPxY >> 7;
    const maxTileIndex = (map.getLocalTileSpan?.() ?? Scene.MAP_SQUARE_SIZE) - 1;
    tileX = Math.max(0, Math.min(maxTileIndex, tileX));
    tileY = Math.max(0, Math.min(maxTileIndex, tileY));

    const offX = localPxX / 128 - Math.floor(localPxX / 128);
    const offY = localPxY / 128 - Math.floor(localPxY / 128);

    const resolvedPlane = resolveBridgePlaneForLocal(map, basePlane, tileX, tileY, strategy);

    const size = map.heightMapSize;
    const base = resolvedPlane * size * size;
    const borderSize = typeof map.borderSize === "number" ? map.borderSize : 0;

    const ix = tileX + borderSize;
    const iz = tileY + borderSize;
    const ix1 = Math.min(ix + 1, size - 1);
    const iz1 = Math.min(iz + 1, size - 1);

    const data = map.heightMapData;
    // Height map stores magnitude values in units of (Scene.UNITS_TILE_HEIGHT_BASIS),
    // mirroring the GPU shader path (see `height-map.glsl`: texel * 8).
    const h00 = ((data[base + iz * size + ix] || 0) * Scene.UNITS_TILE_HEIGHT_BASIS) | 0;
    const h10 = ((data[base + iz * size + ix1] || 0) * Scene.UNITS_TILE_HEIGHT_BASIS) | 0;
    const h01 = ((data[base + iz1 * size + ix] || 0) * Scene.UNITS_TILE_HEIGHT_BASIS) | 0;
    const h11 = ((data[base + iz1 * size + ix1] || 0) * Scene.UNITS_TILE_HEIGHT_BASIS) | 0;

    let hWorld: number;
    if (cameraBilinear) {
        const fineX = Math.floor(offX * 128), fineY = Math.floor(offY * 128);
        const row0 = (h00 * (128 - fineX) + h10 * fineX) >> 7;
        const row1 = (h01 * (128 - fineX) + h11 * fineX) >> 7;
        hWorld = (row0 * (128 - fineY) + row1 * fineY) >> 7;
    } else hWorld = interpolate(h00, h10, h01, h11, offX, offY);

    return {
        plane: resolvedPlane,
        // Convert world units -> tile units (1 tile = 128 world units).
        // World Y is negative-up, so return negative height.
        height: -(hWorld / 128.0),
        valid: true,
    };
}
