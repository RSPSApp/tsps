import type { MinimapIcon } from "../../render/loader/SdMapData";
import type { WorldMapState } from "../../rs/map/WorldMapArea";
import type { RenderedWorldMapPoint } from "@runelite/client/ui/overlay/worldmap/worldMapLayout";

export const WORLD_MAP_ELEMENT_TOOLTIP_SCRIPT_ID = 7325;
export const WORLD_MAP_ELEMENT_TOOLTIP_CLEAR_SCRIPT_ID = 7326;

/**
 * Rendered tile images kept, in bytes of RGBA texture. The client's region sprite cache holds
 * 37748736 bytes (WorldMapRegion.regionSpriteCache, each sprite charged 4 bytes a pixel), so a
 * few zoom levels of the area being browsed stay cached: zooming back shows them at once.
 */
export const MAX_WORLDMAP_IMAGE_BYTES = 37748736;
/** Ours: a phone's GPU budget is smaller, so it keeps a third of that. */
export const MAX_WORLDMAP_IMAGE_BYTES_MOBILE = 12582912;
export const BASE_PENDING_WORLDMAP_TILE_LOADS = 8;
export const BASE_PENDING_WORLDMAP_TILE_LOADS_MOBILE = 4;
export const MAX_PENDING_WORLDMAP_TILE_LOADS = 128;
export const MAX_PENDING_WORLDMAP_TILE_LOADS_MOBILE = 48;
export const MAX_FAILED_WORLDMAP_IDS = 256;
export const MAX_FAILED_WORLDMAP_IDS_MOBILE = 64;
export const WORLDMAP_TILE_RETRY_MS = 2500;

export type WorldMapRenderedIcon = {
    elementId: number;
    category: number;
    coord1: number;
    coord2: number;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
};

/** Where the world map was last drawn: its device rect, the centred display tile and its scale. */
export type WorldMapViewport = {
    x: number;
    y: number;
    width: number;
    height: number;
    displayX: number;
    displayY: number;
    pixelsPerTileX: number;
    pixelsPerTileY: number;
};

export type WorldMapImageTile = {
    key: string;
    pixels?: Uint8Array;
    width: number;
    height: number;
    /** The texture's size in bytes, charged against MAX_WORLDMAP_IMAGE_BYTES. */
    bytes: number;
};

export type WorldMapRetainTile = {
    mapX: number;
    mapY: number;
    level?: number;
    sourceTile?: { mapX: number; mapY: number; level?: number };
};

/** Shared state surface for world-map submodules. */
export type WorldMapStateHolder = {
    worldMapState: WorldMapState;
    worldMapDragStartMouseX: number;
    worldMapDragStartMouseY: number;
    worldMapDragStartDisplayX: number;
    worldMapDragStartDisplayY: number;
    worldMapDragPixelsPerTileX: number;
    worldMapDragPixelsPerTileY: number;
    worldMapClickStartMouseX: number;
    worldMapClickStartMouseY: number;
    worldMapClickStartTimeMs: number;
    pendingWorldMapDragDisplayX: number | undefined;
    pendingWorldMapDragDisplayY: number | undefined;
    renderedWorldMapIcons: WorldMapRenderedIcon[];
    /** RuneLite plugin points drawn this frame, for their tooltip and click-to-jump. */
    renderedWorldMapPoints: RenderedWorldMapPoint[];
    hoveredWorldMapIcons: Map<string, WorldMapRenderedIcon>;
    worldMapImageTiles: Map<number, WorldMapImageTile>;
    /** Sum of worldMapImageTiles' bytes. */
    worldMapImageBytes: number;
    worldMapImageAccess: Map<number, number>;
    pendingWorldMapImageIds: Set<number>;
    failedWorldMapImageIds: Map<number, number>;
    retainedWorldMapImageIds: Set<number>;
    worldMapImageRequestViewportKey: string;
    worldMapImageRequestEpoch: number;
    worldMapImageCacheEpoch: number;
    worldMapIconCache: Map<number, MinimapIcon[] | undefined>;
    worldMapIconCacheAreaId: number;
    worldMapImageRepaintQueued: boolean;
    worldMapWidgetUid: number;
};
