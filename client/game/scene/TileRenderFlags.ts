import { Scene } from "../../rs/scene/Scene";
import type { MapManager, MapSquare } from "../MapManager";
import { clampPlane } from "../utils/PlaneUtil";

/** Tile is part of a bridge column; level 1 geometry is linked down to ground level. */
export const TILE_FLAG_BRIDGE = 0x2;
/** Tile is under a roof (inside a building); drives roof hiding. */
export const TILE_FLAG_UNDER_ROOF = 0x4;
/** Tile geometry always renders on the lowest plane. */
export const TILE_FLAG_FORCE_LOWEST_PLANE = 0x8;

export interface TileFlagMapSquare extends MapSquare {
    getTileRenderFlag(level: number, tileX: number, tileY: number): number;
    isBridgeSurface?: (level: number, tileX: number, tileY: number) => boolean;
}

export function getTileRenderFlagLocal(
    map: TileFlagMapSquare | undefined,
    level: number,
    localTileX: number,
    localTileY: number,
): number {
    if (!map || typeof map.getTileRenderFlag !== "function") {
        return 0;
    }
    return map.getTileRenderFlag(level | 0, localTileX | 0, localTileY | 0) | 0;
}

export function isBridgeSurfaceLocal(
    map: TileFlagMapSquare | undefined,
    level: number,
    localTileX: number,
    localTileY: number,
): boolean {
    if (!map || typeof map.isBridgeSurface !== "function") {
        return false;
    }
    return !!map.isBridgeSurface(level | 0, localTileX | 0, localTileY | 0);
}

/** True when level 1 above this tile carries the bridge flag (tile is a bridge column). */
export function hasBridgeColumnLocal(
    map: TileFlagMapSquare | undefined,
    localTileX: number,
    localTileY: number,
): boolean {
    return (getTileRenderFlagLocal(map, 1, localTileX, localTileY) & TILE_FLAG_BRIDGE) !== 0;
}

export function getTileRenderFlagAt<T extends MapSquare>(
    mapManager: MapManager<T>,
    level: number,
    tileX: number,
    tileY: number,
): number {
    const map = mapManager.getMapForWorldTile(tileX, tileY) as
        | (T & TileFlagMapSquare)
        | undefined;
    if (!map) {
        return 0;
    }
    const localX = tileX - (map.getRenderBaseTileX?.() ?? map.mapX * Scene.MAP_SQUARE_SIZE);
    const localY = tileY - (map.getRenderBaseTileY?.() ?? map.mapY * Scene.MAP_SQUARE_SIZE);
    return getTileRenderFlagLocal(map, clampPlane(level), localX, localY);
}
