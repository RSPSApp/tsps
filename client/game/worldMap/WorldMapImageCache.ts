import { MapManager } from "../MapManager";
import type { MinimapIcon } from "../../render/loader/SdMapData";
import type { WorldMapArchiveRenderer } from "../../rs/map/WorldMapArchiveRenderer";
import { isTouchDevice } from "../../common/utils/DeviceUtil";
import {
    BASE_PENDING_WORLDMAP_TILE_LOADS,
    BASE_PENDING_WORLDMAP_TILE_LOADS_MOBILE,
    MAX_FAILED_WORLDMAP_IDS,
    MAX_FAILED_WORLDMAP_IDS_MOBILE,
    MAX_PENDING_WORLDMAP_TILE_LOADS,
    MAX_PENDING_WORLDMAP_TILE_LOADS_MOBILE,
    MAX_WORLDMAP_IMAGE_BYTES,
    MAX_WORLDMAP_IMAGE_BYTES_MOBILE,
    WORLDMAP_TILE_RETRY_MS,
    type WorldMapImageTile,
    type WorldMapRetainTile,
    type WorldMapStateHolder,
} from "./WorldMapTypes";

export type WorldMapImageDeps = {
    getMinimapImageKey: (mapX: number, mapY: number, level?: number) => number;
    getWorldMapArchiveRenderer: () => Pick<WorldMapArchiveRenderer, "loadTile"> | undefined;
    cancelTileLoads?: (clearCache?: boolean) => void;
    loadMapElement: (elementId: number) => any;
    getWidgetManager: () => any;
    evictTextureKey: (key: string) => void;
    scheduleRepaint: () => void;
};

function getWorldMapImageByteLimit(): number {
    return isTouchDevice ? MAX_WORLDMAP_IMAGE_BYTES_MOBILE : MAX_WORLDMAP_IMAGE_BYTES;
}

/** Bits of an image key holding its pixels per tile (getWorldMapImageKey). */
const PIXELS_PER_TILE_SHIFT = 18;
const PIXELS_PER_TILE_MASK = 0xf << PIXELS_PER_TILE_SHIFT;
const MAX_PIXELS_PER_TILE = 8;

/**
 * Pixels per tile tiles are rendered at: the client draws regions at ceil(zoom) and scales them.
 * Ours: the target zoom, not the zoom mid-animation. The client renders each in-between size
 * synchronously and drops it a few cycles later; a worker would only finish them after the
 * animation, so only the size the map settles on is requested, and the draw scales whatever
 * size is cached meanwhile (getWorldMapImageSource).
 */
function getRequestPixelsPerTile(state: WorldMapStateHolder): number {
    const zoom = state.worldMapState.getTargetZoomScale?.() ?? state.worldMapState.getZoomScale?.() ?? 1;
    return Math.max(1, Math.min(MAX_PIXELS_PER_TILE, Math.ceil(zoom)));
}

function getWorldMapImagePendingLimit(state: WorldMapStateHolder): number {
    const baseLimit = isTouchDevice
        ? BASE_PENDING_WORLDMAP_TILE_LOADS_MOBILE
        : BASE_PENDING_WORLDMAP_TILE_LOADS;
    const maxLimit = isTouchDevice
        ? MAX_PENDING_WORLDMAP_TILE_LOADS_MOBILE
        : MAX_PENDING_WORLDMAP_TILE_LOADS;
    return Math.max(baseLimit, Math.min(maxLimit, state.retainedWorldMapImageIds.size));
}

function getFailedWorldMapIdLimit(): number {
    return isTouchDevice ? MAX_FAILED_WORLDMAP_IDS_MOBILE : MAX_FAILED_WORLDMAP_IDS;
}

export function getWorldMapImageKey(
    state: WorldMapStateHolder,
    deps: WorldMapImageDeps,
    mapX: number,
    mapY: number,
    level: number = 0,
): number {
    const baseKey = deps.getMinimapImageKey(mapX, mapY, level);
    const pixelsPerTile = getRequestPixelsPerTile(state);
    const areaId = Math.max(0, state.worldMapState.getCurrentMapAreaId() | 0) & 0x1ff;
    return baseKey | ((pixelsPerTile & 0xf) << PIXELS_PER_TILE_SHIFT) | (areaId << 22);
}

/**
 * The cached size of a map square that draws best at the zoom drawn now, which mid-animation
 * may not be the requested size. The smallest size at or above ceil(zoom) stays sharp when
 * shrunk (the client's own choice once rendered); failing that, the largest smaller one is
 * stretched until the wanted size renders.
 */
function findBestCachedImageId(state: WorldMapStateHolder, mapId: number): number | undefined {
    const zoom = state.worldMapState.getZoomScale?.() ?? 1;
    const needed = Math.max(1, Math.min(MAX_PIXELS_PER_TILE, Math.ceil(zoom)));
    const squareKey = mapId & ~PIXELS_PER_TILE_MASK;
    for (let size = needed; size <= MAX_PIXELS_PER_TILE; size++) {
        const id = squareKey | (size << PIXELS_PER_TILE_SHIFT);
        if (state.worldMapImageTiles.has(id)) return id;
    }
    for (let size = needed - 1; size >= 1; size--) {
        const id = squareKey | (size << PIXELS_PER_TILE_SHIFT);
        if (state.worldMapImageTiles.has(id)) return id;
    }
    return undefined;
}

function updateWorldMapImageRequestEpoch(state: WorldMapStateHolder, deps: WorldMapImageDeps): number {
    const zoomBucket = Math.max(1, Math.round((state.worldMapState.zoomPercentage || 100) / 25));
    // The widget's size in pixels, not displayWidth/Height in tiles: those follow the zoom while
    // it eases in, and a new key every cycle would cancel the loads the new zoom just started.
    const width = state.worldMapState.getDisplayPixelWidth?.() ?? state.worldMapState.displayWidth;
    const height = state.worldMapState.getDisplayPixelHeight?.() ?? state.worldMapState.displayHeight;
    const viewportKey = [
        state.worldMapState.getCurrentMapAreaId(),
        (state.worldMapState.displayX | 0) >> 6,
        (state.worldMapState.displayY | 0) >> 6,
        zoomBucket,
        (width | 0) >> 6,
        (height | 0) >> 6,
    ].join(":");
    if (viewportKey !== state.worldMapImageRequestViewportKey) {
        state.worldMapImageRequestViewportKey = viewportKey;
        state.worldMapImageRequestEpoch = (state.worldMapImageRequestEpoch + 1) | 0;
        state.failedWorldMapImageIds.clear();
        deps.cancelTileLoads?.();
        state.pendingWorldMapImageIds.clear();
    }
    return state.worldMapImageRequestEpoch;
}

function rememberFailedWorldMapImage(state: WorldMapStateHolder, mapId: number): void {
    if (state.failedWorldMapImageIds.has(mapId)) return;
    const limit = getFailedWorldMapIdLimit();
    while (state.failedWorldMapImageIds.size >= limit) {
        const first = state.failedWorldMapImageIds.keys().next().value;
        if (first === undefined) break;
        state.failedWorldMapImageIds.delete(first);
    }
    state.failedWorldMapImageIds.set(mapId, performance.now());
}

function hasRecentlyFailedWorldMapImage(state: WorldMapStateHolder, mapId: number): boolean {
    const failedAt = state.failedWorldMapImageIds.get(mapId);
    if (failedAt === undefined) return false;
    if (performance.now() - failedAt < WORLDMAP_TILE_RETRY_MS) return true;
    state.failedWorldMapImageIds.delete(mapId);
    return false;
}

function invalidateWorldMapIconCacheForId(state: WorldMapStateHolder, mapId: number): void {
    state.worldMapIconCache.delete(mapId);
}

function isWorldMapImageIcon(icon: unknown): icon is MinimapIcon {
    if (!icon || typeof icon !== "object") return false;
    const candidate = icon as MinimapIcon;
    if (
        !Number.isInteger(candidate.localX) ||
        candidate.localX < 0 ||
        candidate.localX >= 64 ||
        !Number.isInteger(candidate.localY) ||
        candidate.localY < 0 ||
        candidate.localY >= 64 ||
        !Number.isSafeInteger(candidate.elementId) ||
        candidate.elementId < 0 ||
        !Number.isSafeInteger(candidate.category) ||
        !Number.isSafeInteger(candidate.spriteId)
    ) {
        return false;
    }
    for (const key of [
        "textColor",
        "textSize",
        "horizontalAlignment",
        "verticalAlignment",
        "sourcePlane",
        "sourceX",
        "sourceY",
        "displayPlane",
        "displayX",
        "displayY",
    ] as const) {
        const value = candidate[key];
        if (value !== undefined && !Number.isSafeInteger(value)) return false;
    }
    for (const key of ["sourcePlane", "displayPlane"] as const) {
        const plane = candidate[key];
        if (plane !== undefined && (plane < 0 || plane > 3)) return false;
    }
    for (const key of ["sourceX", "sourceY", "displayX", "displayY"] as const) {
        const coord = candidate[key];
        if (coord !== undefined && (coord < 0 || coord > 0x3fff)) return false;
    }
    return (
        (candidate.worldMapVisible === undefined || typeof candidate.worldMapVisible === "boolean") &&
        (candidate.name === undefined || typeof candidate.name === "string")
    );
}

export function clearWorldMapIconCache(state: WorldMapStateHolder): void {
    state.worldMapIconCache.clear();
    state.worldMapIconCacheAreaId = state.worldMapState.getCurrentMapAreaId();
}

function releaseWorldMapImageTile(
    state: WorldMapStateHolder,
    deps: WorldMapImageDeps,
    tile: WorldMapImageTile,
): void {
    deps.evictTextureKey(tile.key);
    state.worldMapImageBytes = Math.max(0, (state.worldMapImageBytes ?? 0) - (tile.bytes ?? 0));
}

function clearWorldMapIconsForImageKey(
    state: WorldMapStateHolder,
    mapId: number,
): void {
    const tileKey = mapId & ~PIXELS_PER_TILE_MASK;
    for (const id of state.worldMapImageTiles.keys()) {
        if (id !== mapId && (id & ~PIXELS_PER_TILE_MASK) === tileKey) {
            invalidateWorldMapIconCacheForId(state, mapId);
            return;
        }
    }
    const level = (mapId >>> 16) & 0x3;
    const mapSquare = mapId & 0xffff;
    const areaId = (mapId >>> 22) & 0x1ff;
    state.worldMapState.removeTileIcons(
        (mapSquare >>> 8) & 0xff,
        mapSquare & 0xff,
        level,
        areaId,
    );
    invalidateWorldMapIconCacheForId(state, mapId);
}

/**
 * Least recently drawn first, until the tiles fit the byte budget. Tiles on screen (and their
 * stand-ins) are never evicted, even past the budget.
 */
function pruneWorldMapImages(state: WorldMapStateHolder, deps: WorldMapImageDeps): void {
    const limit = getWorldMapImageByteLimit();
    if ((state.worldMapImageBytes ?? 0) <= limit) return;
    const ids = Array.from(state.worldMapImageTiles.keys()).filter(
        (id) => !state.retainedWorldMapImageIds.has(id),
    );
    ids.sort(
        (a, b) =>
            (state.worldMapImageAccess.get(a) ?? -Infinity) -
            (state.worldMapImageAccess.get(b) ?? -Infinity),
    );
    for (const id of ids) {
        if (state.worldMapImageBytes <= limit) break;
        const tile = state.worldMapImageTiles.get(id);
        if (tile) {
            releaseWorldMapImageTile(state, deps, tile);
        }
        state.worldMapImageTiles.delete(id);
        state.worldMapImageAccess.delete(id);
        clearWorldMapIconsForImageKey(state, id);
    }
}

function setWorldMapImageTile(
    state: WorldMapStateHolder,
    deps: WorldMapImageDeps,
    mapX: number,
    mapY: number,
    pixels: Uint8Array,
    width: number,
    height: number,
    level: number,
    icons: MinimapIcon[],
): void {
    const mapId = getWorldMapImageKey(state, deps, mapX, mapY, level);
    const oldTile = state.worldMapImageTiles.get(mapId);
    if (oldTile) {
        releaseWorldMapImageTile(state, deps, oldTile);
        state.worldMapImageTiles.delete(mapId);
        state.worldMapImageAccess.delete(mapId);
    }
    const bytes = (width | 0) * (height | 0) * 4;
    state.worldMapImageTiles.set(mapId, {
        key: `worldmap:${mapId}:${state.worldMapImageCacheEpoch}`,
        pixels,
        width: width | 0,
        height: height | 0,
        bytes,
    });
    state.worldMapImageBytes = (state.worldMapImageBytes ?? 0) + bytes;
    state.worldMapImageAccess.set(mapId, performance.now());
    state.worldMapState.setTileIcons(mapX | 0, mapY | 0, level | 0, icons);
    invalidateWorldMapIconCacheForId(state, mapId);
    pruneWorldMapImages(state, deps);
    deps.scheduleRepaint();
}

function queueLoadWorldMapImage(
    state: WorldMapStateHolder,
    deps: WorldMapImageDeps,
    mapX: number,
    mapY: number,
    level: number,
    cacheEpoch: number,
): void {
    const mapId = getWorldMapImageKey(state, deps, mapX, mapY, level);
    if (state.pendingWorldMapImageIds.has(mapId)) {
        return;
    }
    if (hasRecentlyFailedWorldMapImage(state, mapId)) {
        return;
    }
    if (state.worldMapImageTiles.has(mapId)) {
        return;
    }
    if (state.pendingWorldMapImageIds.size >= getWorldMapImagePendingLimit(state)) {
        return;
    }

    const archiveRenderer = deps.getWorldMapArchiveRenderer();
    const area = state.worldMapState.currentArea;
    const pixelsPerTile = getRequestPixelsPerTile(state);
    if (!archiveRenderer) {
        rememberFailedWorldMapImage(state, mapId);
        return;
    }

    state.pendingWorldMapImageIds.add(mapId);
    const requestEpoch = state.worldMapImageRequestEpoch;
    const current = () => cacheEpoch === state.worldMapImageCacheEpoch && requestEpoch === state.worldMapImageRequestEpoch;
    void Promise.resolve()
        .then(() => current() ? archiveRenderer.loadTile(area, mapX | 0, mapY | 0, pixelsPerTile) : undefined)
        .then((tile) => {
            if (!current()) {
                return;
            }
            if (mapId !== getWorldMapImageKey(state, deps, mapX, mapY, level)) {
                return;
            }
            const tileWidth = tile?.width;
            const tileHeight = tile?.height;
            if (
                tile?.pixels instanceof Uint8Array &&
                typeof tileWidth === "number" &&
                typeof tileHeight === "number" &&
                Number.isSafeInteger(tileWidth) &&
                Number.isSafeInteger(tileHeight) &&
                tileWidth > 0 &&
                tileHeight > 0 &&
                tile.pixels.length >= tileWidth * tileHeight * 4
            ) {
                setWorldMapImageTile(
                    state,
                    deps,
                    mapX | 0,
                    mapY | 0,
                    tile.pixels,
                    tileWidth | 0,
                    tileHeight | 0,
                    level | 0,
                    Array.isArray(tile.icons) ? tile.icons.filter(isWorldMapImageIcon) : [],
                );
                return;
            }
            rememberFailedWorldMapImage(state, mapId);
        })
        .catch((err) => {
            if (!current()) {
                return;
            }
            console.log("[WorldMapController] Failed to load world map image tile", {
                mapX,
                mapY,
                level,
                err,
            });
            rememberFailedWorldMapImage(state, mapId);
        })
        .finally(() => {
            if (current()) state.pendingWorldMapImageIds.delete(mapId);
        });
}

function getWorldMapImageSourceInternal(
    state: WorldMapStateHolder,
    deps: WorldMapImageDeps,
    mapX: number,
    mapY: number,
    level: number,
    accessPriority: number,
    allowStandIn: boolean,
): WorldMapImageTile | undefined {
    updateWorldMapImageRequestEpoch(state, deps);
    const mapId = getWorldMapImageKey(state, deps, mapX, mapY, level);
    const accessTime = performance.now() + Math.max(0, accessPriority);
    const tile = state.worldMapImageTiles.get(mapId);
    if (tile) {
        state.worldMapImageAccess.set(mapId, accessTime);
    } else if (
        !allowStandIn ||
        state.retainedWorldMapImageIds.size === 0 ||
        state.retainedWorldMapImageIds.has(mapId)
    ) {
        // A square drawn only mid-ease, outside the view the zoom settles on, isn't requested:
        // it draws a stand-in and leaves the screen before its render would land.
        queueLoadWorldMapImage(state, deps, mapX, mapY, level, state.worldMapImageCacheEpoch);
    }
    if (!allowStandIn) return tile;
    const drawId = findBestCachedImageId(state, mapId);
    if (drawId === undefined) return undefined;
    state.worldMapImageAccess.set(drawId, accessTime);
    return state.worldMapImageTiles.get(drawId);
}

export function getWorldMapImageTile(
    state: WorldMapStateHolder,
    deps: WorldMapImageDeps,
    mapX: number,
    mapY: number,
    level: number = 0,
    accessPriority: number = 0,
): WorldMapImageTile | undefined {
    if (mapX < 0 || mapY < 0 || mapX >= MapManager.MAX_MAP_X || mapY >= MapManager.MAX_MAP_Y) {
        return undefined;
    }
    return getWorldMapImageSourceInternal(state, deps, mapX, mapY, level, accessPriority, false);
}

/**
 * The image to draw for a map square: the one rendered for the current zoom, or while that
 * renders, the same square at another zoom (the draw scales it to the square's size).
 */
export function getWorldMapImageSource(
    state: WorldMapStateHolder,
    deps: WorldMapImageDeps,
    mapX: number,
    mapY: number,
    level: number = 0,
    accessPriority: number = 0,
): WorldMapImageTile | undefined {
    if (mapX < 0 || mapY < 0 || mapX >= MapManager.MAX_MAP_X || mapY >= MapManager.MAX_MAP_Y) {
        return undefined;
    }
    return getWorldMapImageSourceInternal(state, deps, mapX, mapY, level, accessPriority, true);
}

export function markWorldMapImageTextureUploaded(
    state: WorldMapStateHolder,
    key: string,
): void {
    for (const tile of state.worldMapImageTiles.values()) {
        if (tile.key === key) {
            delete tile.pixels;
            return;
        }
    }
}

export function retainWorldMapImageTiles(
    state: WorldMapStateHolder,
    deps: WorldMapImageDeps,
    tiles: WorldMapRetainTile[],
): void {
    const retained = new Set<number>();
    for (const tile of tiles) {
        const retainedTile = tile.sourceTile ?? tile;
        const mapX = retainedTile.mapX | 0;
        const mapY = retainedTile.mapY | 0;
        if (
            mapX < 0 ||
            mapY < 0 ||
            mapX >= MapManager.MAX_MAP_X ||
            mapY >= MapManager.MAX_MAP_Y
        ) {
            continue;
        }
        const mapId = getWorldMapImageKey(state, deps, mapX, mapY, retainedTile.level ?? 0);
        retained.add(mapId);
        // The size drawn mid-zoom, or until mapId renders, must outlive tiles loading around it.
        const drawId = findBestCachedImageId(state, mapId);
        if (drawId !== undefined) retained.add(drawId);
    }
    state.retainedWorldMapImageIds = retained;
    pruneWorldMapImages(state, deps);
}

export function clearWorldMapImages(
    state: WorldMapStateHolder,
    deps: WorldMapImageDeps,
    clearIconCache: () => void,
    clearRenderCaches: () => void,
): void {
    state.worldMapImageCacheEpoch = (state.worldMapImageCacheEpoch + 1) | 0;
    deps.cancelTileLoads?.(true);
    for (const tile of state.worldMapImageTiles.values()) {
        releaseWorldMapImageTile(state, deps, tile);
    }
    state.worldMapImageTiles.clear();
    state.worldMapImageBytes = 0;
    state.worldMapImageAccess.clear();
    state.worldMapState.clearTileIcons();
    clearIconCache();
    clearRenderCaches();
    state.pendingWorldMapImageIds.clear();
    state.failedWorldMapImageIds.clear();
    state.retainedWorldMapImageIds.clear();
    state.worldMapImageRequestViewportKey = "";
    state.worldMapImageRequestEpoch = 0;
    deps.scheduleRepaint();
}

export { scheduleWorldMapImageRepaint } from "./WorldMapRepaint";
