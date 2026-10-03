import { Scene } from "../../rs/scene/Scene";
import type { MapManager, MapSquare } from "../MapManager";
import { clampPlane } from "../utils/PlaneUtil";
import {
    TILE_FLAG_BRIDGE,
    TileFlagMapSquare,
    getTileRenderFlagLocal,
    getTileRenderFlagAt,
    hasBridgeColumnLocal,
    isBridgeSurfaceLocal,
} from "./TileRenderFlags";

export type ResolveTilePlaneFn = (tileX: number, tileY: number, plane: number) => number;

export enum BridgePlaneStrategy {
    RENDER = "render",
    OCCUPANCY = "occupancy",
    EFFECTIVE = "effective",
}

/**
 * Which plane to use for height sampling.
 * This is intentionally not named "effective plane": it is for height selection.
 */
export function resolveHeightSamplePlaneForLocal(
    map: TileFlagMapSquare | undefined,
    basePlane: number,
    localTileX: number,
    localTileY: number,
): number {
    const plane = clampPlane(basePlane);
    if (
        plane < 3 &&
        (getTileRenderFlagLocal(map, 1, localTileX, localTileY) & TILE_FLAG_BRIDGE) !== 0
    ) {
        return plane + 1;
    }
    return plane;
}

/**
 * Which plane to use for collision sampling (movement/pathing).
 */
export function resolveCollisionSamplePlaneForLocal(
    map: TileFlagMapSquare | undefined,
    basePlane: number,
    localTileX: number,
    localTileY: number,
): number {
    let plane = clampPlane(basePlane);
    const isSurface = isBridgeSurfaceLocal(map, plane, localTileX, localTileY);
    const hasBridgeColumn = hasBridgeColumnLocal(map, localTileX, localTileY);
    if (!isSurface && hasBridgeColumn) {
        plane = clampPlane(plane + 1);
    }
    return plane;
}

/**
 * Which plane to use for interaction semantics (tile selection / "where is the tile effectively").
 */
export function resolveInteractionPlaneForLocal(
    map: TileFlagMapSquare | undefined,
    basePlane: number,
    localTileX: number,
    localTileY: number,
): number {
    const plane = clampPlane(basePlane);
    const isSurface = isBridgeSurfaceLocal(map, plane, localTileX, localTileY);
    const hasBridgeColumn = hasBridgeColumnLocal(map, localTileX, localTileY);
    if (isSurface) {
        return plane;
    }
    if (plane === 0 && hasBridgeColumn) {
        return 1;
    }
    return plane;
}

export function resolveBridgePlaneForLocal(
    map: TileFlagMapSquare | undefined,
    basePlane: number,
    localTileX: number,
    localTileY: number,
    strategy: BridgePlaneStrategy = BridgePlaneStrategy.RENDER,
): number {
    switch (strategy) {
        case BridgePlaneStrategy.RENDER:
            return resolveHeightSamplePlaneForLocal(map, basePlane, localTileX, localTileY);
        case BridgePlaneStrategy.OCCUPANCY:
            return resolveCollisionSamplePlaneForLocal(map, basePlane, localTileX, localTileY);
        case BridgePlaneStrategy.EFFECTIVE:
            return resolveInteractionPlaneForLocal(map, basePlane, localTileX, localTileY);
        default:
            return clampPlane(basePlane);
    }
}

/**
 * Promotes a plane upwards while the level above carries the bridge flag, so
 * entities standing on a bridge surface resolve to the bridge's render plane.
 */
export function resolveBridgePromotedPlane<T extends MapSquare>(
    mapManager: MapManager<T>,
    rawPlane: number,
    tile: { x: number; y: number } | undefined,
): number {
    if (!tile) {
        return clampPlane(rawPlane);
    }

    let plane = clampPlane(rawPlane);
    for (let i = 0; i < 2 && plane < 3; i++) {
        const flagsAbove = getTileRenderFlagAt(mapManager, plane + 1, tile.x, tile.y);
        if ((flagsAbove & TILE_FLAG_BRIDGE) === 0) {
            break;
        }
        plane++;
    }
    return plane;
}

/**
 * Which plane ground-item stacks are indexed on.
 *
 * Ground piles stay on the raw client plane; bridge promotion only applies when
 * sampling world height for rendering/click volumes.
 */
export function resolveGroundItemStackPlane(basePlane: number): number {
    return clampPlane(basePlane);
}

function resolveForWorldTile<T extends MapSquare>(
    mapManager: MapManager<T>,
    basePlane: number,
    tileX: number,
    tileY: number,
    localResolver: (
        map: TileFlagMapSquare | undefined,
        basePlane: number,
        localTileX: number,
        localTileY: number,
    ) => number,
): number {
    const map = mapManager.getMapForWorldTile(tileX, tileY) as
        | (T & TileFlagMapSquare)
        | undefined;
    if (!map) {
        return clampPlane(basePlane);
    }
    const localX = tileX - (map.getRenderBaseTileX?.() ?? map.mapX * Scene.MAP_SQUARE_SIZE);
    const localY = tileY - (map.getRenderBaseTileY?.() ?? map.mapY * Scene.MAP_SQUARE_SIZE);
    return localResolver(map, basePlane, localX, localY);
}

export function resolveCollisionSamplePlaneForWorldTile<T extends MapSquare>(
    mapManager: MapManager<T>,
    basePlane: number,
    tileX: number,
    tileY: number,
): number {
    return resolveForWorldTile(
        mapManager,
        basePlane,
        tileX,
        tileY,
        resolveCollisionSamplePlaneForLocal,
    );
}

export function resolveInteractionPlaneForWorldTile<T extends MapSquare>(
    mapManager: MapManager<T>,
    basePlane: number,
    tileX: number,
    tileY: number,
): number {
    return resolveForWorldTile(
        mapManager,
        basePlane,
        tileX,
        tileY,
        resolveInteractionPlaneForLocal,
    );
}
