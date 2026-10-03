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

export function sampleBridgeHeightForWorldTile<T extends MapSquare>(
    mapManager: MapManager<T>,
    worldX: number,
    worldY: number,
    basePlane: number,
    strategy: BridgePlaneStrategy = BridgePlaneStrategy.RENDER,
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
    const localPxX = Math.floor((worldX - mapWorldX) * 128);
    const localPxY = Math.floor((worldY - mapWorldY) * 128);

    let tileX = localPxX >> 7;
    let tileY = localPxY >> 7;
    const maxTileIndex = (map.getLocalTileSpan?.() ?? Scene.MAP_SQUARE_SIZE) - 1;
    tileX = Math.max(0, Math.min(maxTileIndex, tileX));
    tileY = Math.max(0, Math.min(maxTileIndex, tileY));

    const offX = localPxX & 0x7f;
    const offY = localPxY & 0x7f;

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
    // The >>7 interpolation truncates, so scale into world units *before* dividing;
    // scaling afterwards loses precision.
    const h00 = ((data[base + iz * size + ix] || 0) * Scene.UNITS_TILE_HEIGHT_BASIS) | 0;
    const h10 = ((data[base + iz * size + ix1] || 0) * Scene.UNITS_TILE_HEIGHT_BASIS) | 0;
    const h01 = ((data[base + iz1 * size + ix] || 0) * Scene.UNITS_TILE_HEIGHT_BASIS) | 0;
    const h11 = ((data[base + iz1 * size + ix1] || 0) * Scene.UNITS_TILE_HEIGHT_BASIS) | 0;

    const delta0 = (h00 * (128 - offX) + h10 * offX) >> 7;
    const delta1 = (h01 * (128 - offX) + h11 * offX) >> 7;
    const hWorld = (delta0 * (128 - offY) + delta1 * offY) >> 7;

    return {
        plane: resolvedPlane,
        // Convert world units -> tile units (1 tile = 128 world units).
        // World Y is negative-up, so return negative height.
        height: -(hWorld / 128.0),
        valid: true,
    };
}
