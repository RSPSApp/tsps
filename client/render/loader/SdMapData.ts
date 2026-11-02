import { CollisionData } from "../../rs/scene/CollisionMap";
import { DrawRange } from "../DrawRange";
import { LocAnimatedData } from "../loc/LocAnimatedData";
import { NpcData } from "../npc/NpcData";
import type { SdMapLoaderInput } from "./SdMapLoaderInput";

/**
 * Minimap icon entry: position + sprite ID for dynamic rendering
 */
export interface MinimapIcon {
    localX: number; // Local tile X within map square (0-63)
    localY: number; // Local tile Y within map square (0-63)
    elementId: number; // Map element ID from the object map function
    category: number; // Map element category, or -1 if unset
    spriteId: number; // Sprite ID to load (resolved from MapElementType.spriteId)
    worldMapVisible?: boolean;
    name?: string;
    textColor?: number;
    textSize?: number;
    horizontalAlignment?: number;
    verticalAlignment?: number;
    sourcePlane?: number;
    sourceX?: number;
    sourceY?: number;
    displayPlane?: number;
    displayX?: number;
    displayY?: number;
}

/**
 * GPU data for a mutable group of location models. Terrain deliberately lives
 * outside this payload so a loc packet can replace objects without recreating
 * the map-square terrain mesh.
 */
export type LocGeometryData = {
    vertices: Uint8Array;
    indices: Int32Array;

    modelTextureData: Uint16Array;
    modelTextureDataAlpha: Uint16Array;
    modelTextureDataLod: Uint16Array;
    modelTextureDataLodAlpha: Uint16Array;
    modelTextureDataInteract: Uint16Array;
    modelTextureDataInteractAlpha: Uint16Array;
    modelTextureDataInteractLod: Uint16Array;
    modelTextureDataInteractLodAlpha: Uint16Array;

    drawRanges: DrawRange[];
    drawRangesAlpha: DrawRange[];
    drawRangesPlanes: Uint8Array;
    drawRangesAlphaPlanes: Uint8Array;
    drawRangesLod: DrawRange[];
    drawRangesLodAlpha: DrawRange[];
    drawRangesLodPlanes: Uint8Array;
    drawRangesLodAlphaPlanes: Uint8Array;
    drawRangesInteract: DrawRange[];
    drawRangesInteractAlpha: DrawRange[];
    drawRangesInteractPlanes: Uint8Array;
    drawRangesInteractAlphaPlanes: Uint8Array;
    drawRangesInteractLod: DrawRange[];
    drawRangesInteractLodAlpha: DrawRange[];
    drawRangesInteractLodPlanes: Uint8Array;
    drawRangesInteractLodAlphaPlanes: Uint8Array;
};

export type SdMapData = {
    mapX: number;
    mapY: number;

    /** Main-thread-only source snapshot for lazily requested minimap floors. */
    minimapInput?: SdMapLoaderInput;

    /** Main-thread-only timing data enabled by `?map-profile=1`. */
    mapProfile?: { queuedAt: number; workerReadyAt: number };

    cacheName: string;

    maxLevel: number;
    loadNpcs: boolean;

    smoothTerrain: boolean;

    /** True when this payload only contains replacement door geometry. */
    doorOnly?: boolean;

    /** True when this payload only contains replacement non-door loc geometry. */
    locOnly?: boolean;

    borderSize: number;
    heightMapSize: number;

    /** Override u_mapPos for the shader. When set, positions geometry at these
     *  world coordinates instead of mapX*64/mapY*64. Used by instances. */
    renderPosX?: number;
    renderPosY?: number;

    tileRenderFlags: Uint8Array[][];
    /** Where ground items stand on a loc: see collectObjSurfaceHeights. */
    objSurfaceHeights?: Int16Array[][];
    tileOverlays?: Int16Array[][];
    /** Per-level, per-tile HD ground recipe grid, same [level][x][y] indexing as tileRenderFlags. */
    groundMaterials?: Uint8Array[][];
    /** Per-level, per-tile ground colour (0xRRGGBB, 0 = none), same indexing as groundMaterials. */
    groundColors?: Uint32Array[][];
    collisionDatas: CollisionData[];

    minimapBlobs?: Blob[];
    minimapIcons: MinimapIcon[][];
    worldMapIcons: MinimapIcon[][];

    vertices: Uint8Array;
    indices: Int32Array;
    /** Static and animated non-door locs, kept separate from terrain. */
    loc: LocGeometryData;
    doorVertices: Uint8Array;
    doorIndices: Int32Array;
    npcVertices: Uint8Array;
    npcIndices: Int32Array;

    modelTextureData: Uint16Array;
    modelTextureDataAlpha: Uint16Array;

    modelTextureDataLod: Uint16Array;
    modelTextureDataLodAlpha: Uint16Array;

    modelTextureDataInteract: Uint16Array;
    modelTextureDataInteractAlpha: Uint16Array;

    modelTextureDataInteractLod: Uint16Array;
    modelTextureDataInteractLodAlpha: Uint16Array;

    doorModelTextureData: Uint16Array;
    doorModelTextureDataAlpha: Uint16Array;

    doorModelTextureDataLod: Uint16Array;
    doorModelTextureDataLodAlpha: Uint16Array;

    doorModelTextureDataInteract: Uint16Array;
    doorModelTextureDataInteractAlpha: Uint16Array;

    doorModelTextureDataInteractLod: Uint16Array;
    doorModelTextureDataInteractLodAlpha: Uint16Array;

    heightMapTextureData: Int16Array;
    waterMaskTextureData: Uint8Array;

    // CPU-side terrain triangles used for click/hover tile picking.
    // Vertices are local tile-space xyz triples, grouped by terrainPickTileOffsets.
    // Planes pack two values per triangle: bits 0-1 hold the height plane the
    // geometry sits on (bridge columns are shifted down, so it is one above the
    // grid level there) and bits 2-3 hold the draw plane the tile is emitted under.
    terrainPickTileOffsets: Uint32Array;
    terrainPickVertices: Float32Array;
    terrainPickPlanes: Uint8Array;

    drawRanges: DrawRange[];
    drawRangesAlpha: DrawRange[];
    drawRangesPlanes: Uint8Array;
    drawRangesAlphaPlanes: Uint8Array;

    drawRangesLod: DrawRange[];
    drawRangesLodAlpha: DrawRange[];
    drawRangesLodPlanes: Uint8Array;
    drawRangesLodAlphaPlanes: Uint8Array;

    drawRangesInteract: DrawRange[];
    drawRangesInteractAlpha: DrawRange[];
    drawRangesInteractPlanes: Uint8Array;
    drawRangesInteractAlphaPlanes: Uint8Array;

    drawRangesInteractLod: DrawRange[];
    drawRangesInteractLodAlpha: DrawRange[];
    drawRangesInteractLodPlanes: Uint8Array;
    drawRangesInteractLodAlphaPlanes: Uint8Array;

    doorDrawRanges: DrawRange[];
    doorDrawRangesAlpha: DrawRange[];
    doorDrawRangesPlanes: Uint8Array;
    doorDrawRangesAlphaPlanes: Uint8Array;

    doorDrawRangesLod: DrawRange[];
    doorDrawRangesLodAlpha: DrawRange[];
    doorDrawRangesLodPlanes: Uint8Array;
    doorDrawRangesLodAlphaPlanes: Uint8Array;

    doorDrawRangesInteract: DrawRange[];
    doorDrawRangesInteractAlpha: DrawRange[];
    doorDrawRangesInteractPlanes: Uint8Array;
    doorDrawRangesInteractAlphaPlanes: Uint8Array;

    doorDrawRangesInteractLod: DrawRange[];
    doorDrawRangesInteractLodAlpha: DrawRange[];
    doorDrawRangesInteractLodPlanes: Uint8Array;
    doorDrawRangesInteractLodAlphaPlanes: Uint8Array;

    locsAnimated: LocAnimatedData[];
    npcs: NpcData[];

    loadedTextures: Map<number, Int32Array>;

    // Bridge surface flags per level (1 = bridge surface on level 0 after demotion).
    bridgeSurfaceFlags: Uint8Array[][];

    // Per-level mapping of interior 64x64 tiles to loc IDs present at that tile origin.
    // Compressed sparse row (CSR) format per level to keep memory small and transferable:
    // - offsets[level]: Uint32Array of length 64*64 + 1
    // - ids[level]: Int32Array concatenating all loc ids for that level
    // - typeRots[level]: Uint8Array parallel to ids, packed as:
    //   bits 0..5 = LocModelType, bits 6..7 = rotation (0..3)
    tilePresenceByLevel?: Uint8Array[];
    tileLocOffsetsByLevel: Uint32Array[];
    tileLocIdsByLevel: Int32Array[];
    tileLocTypeRotByLevel: Uint8Array[];

};
