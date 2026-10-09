/**
 * World entity deck scenes for the WebGPU backend: port of render/render/worldEntity.ts.
 *
 * The server sends each boat's deck as an instance-style scene in its own coordinate space
 * (REBUILD_WORLDENTITY); WORLDENTITY_INFO carries where it is drawn in the world. The scene is
 * loaded as a WebGPUMapSquare under a reserved map id (200 + entityIndex), registered with
 * MapManager as a world-entity map (never pruned, always visible, excluded from world-tile
 * lookups) and drawn through WorldEntityAnimator's view-space placement matrix.
 */
import { Scene } from "../../rs/scene/Scene";
import { getMapSquareId } from "../../rs/map/MapFileIndex";
import { getClientCycle } from "../../network/ServerConnection";
import { WorldEntityAnimator } from "../WorldEntityAnimator";
import type { SdMapLoaderInput } from "../loader/SdMapLoaderInput";
import type { WebGPUMapSquare } from "./WebGPUMapSquare";
import type { WebGPURenderer } from "./WebGPURenderer";

const CHUNK_SIZE = 8;

export interface WorldEntityOverlay {
    entityIndex: number;
    configId: number;
    templateChunks: number[][][];
    regionX: number;
    regionY: number;
    worldX: number;
    worldY: number;
    sizeX: number;
    sizeZ: number;
    extraLocs: Array<{ id: number; x: number; y: number; level: number; shape: number; rotation: number }>;
    extraNpcs?: Array<{ id: number; x: number; y: number; level: number }>;
    basePlane: number;
    deckHeight?: number;
}

export function overlayMapId(entityIndex: number): number {
    return getMapSquareId(200 + entityIndex, 200 + entityIndex);
}

export function ensureWorldEntityAnimator(renderer: WebGPURenderer): void {
    if (renderer.worldEntityAnimator) return;
    renderer.worldEntityAnimator = new WorldEntityAnimator(
        renderer.osrsClient.worldEntityTypeLoader,
        renderer.osrsClient.seqTypeLoader,
        renderer.osrsClient.skeletalSeqLoader,
    );
}

/** Port of loadWorldEntityScene: builds the deck scene and queues it as an overlay map. */
export async function loadWorldEntityScene(
    renderer: WebGPURenderer,
    entityIndex: number,
    templateChunks: number[][][],
    regionX: number,
    regionY: number,
    worldX: number,
    worldY: number,
    sizeX: number,
    sizeZ: number,
    extraLocs: WorldEntityOverlay["extraLocs"],
    configId: number = -1,
    extraNpcs?: WorldEntityOverlay["extraNpcs"],
    basePlane: number = 0,
): Promise<void> {
    if (!renderer.osrsClient.loadedCache) return;

    const loadToken = renderer.nextWorldEntityLoadToken++;
    renderer.worldEntityLoadTokens.set(entityIndex, loadToken);
    const existingEntity = renderer.osrsClient.worldViewManager.getWorldEntity(entityIndex);
    // A rebuild keeps the current deck drawn (and placed) until the new one replaces it.
    const previous = renderer.worldEntityOverlays.get(entityIndex);
    const rebuilding = previous !== undefined;

    const sceneTilesX = (templateChunks[0]?.length ?? 13) * CHUNK_SIZE;
    const sceneTilesY = (templateChunks[0]?.[0]?.length ?? 13) * CHUNK_SIZE;
    const entityWorldBaseX = worldX - sceneTilesX / 2;
    const entityWorldBaseY = worldY - sceneTilesY / 2;

    const mapX = 200 + entityIndex;
    const mapY = 200 + entityIndex;
    const mapId = getMapSquareId(mapX, mapY);
    renderer.mapManager.loadingMapIds.add(mapId);

    renderer.worldEntityOverlays.set(entityIndex, {
        entityIndex,
        configId,
        templateChunks,
        regionX,
        regionY,
        worldX,
        worldY,
        sizeX,
        sizeZ,
        extraLocs,
        extraNpcs,
        basePlane,
        deckHeight: rebuilding && previous.configId === configId ? previous.deckHeight : undefined,
    });

    renderer.osrsClient.worldViewManager.createWorldView(
        entityIndex,
        sceneTilesX,
        sceneTilesY,
        {
            baseX: Math.floor(entityWorldBaseX),
            baseY: Math.floor(entityWorldBaseY),
            configId,
            templateChunks,
            regionX,
            regionY,
            worldX,
            worldY,
            sizeXEntity: sizeX,
            sizeZEntity: sizeZ,
            extraLocs,
            extraNpcs,
        },
        existingEntity,
    );

    if (configId >= 0 && (!rebuilding || previous.configId !== configId)) {
        ensureWorldEntityAnimator(renderer);
        renderer.worldEntityAnimator?.addEntity(entityIndex, configId, getClientCycle() | 0);
    }

    // Locs added since the template was captured, inside the deck's source region.
    const sceneBaseX = (regionX - 6) * CHUNK_SIZE;
    const sceneBaseY = (regionY - 6) * CHUNK_SIZE;
    const sceneMaxX = sceneBaseX + 13 * CHUNK_SIZE;
    const sceneMaxY = sceneBaseY + 13 * CHUNK_SIZE;
    const allExtraLocs = [...extraLocs];
    for (const loc of renderer.addedLocs.values()) {
        if (loc.x >= sceneBaseX && loc.x < sceneMaxX && loc.y >= sceneBaseY && loc.y < sceneMaxY) {
            allExtraLocs.push({
                id: loc.locId,
                x: loc.x,
                y: loc.y,
                level: loc.level,
                shape: loc.shape,
                rotation: loc.rotation,
            });
        }
    }

    const deckLocOverrides = new Map(
        [...renderer.locOverrides].filter(([key]) => {
            const [x, y] = key.split(",").map(Number);
            return x >= sceneBaseX && x < sceneMaxX && y >= sceneBaseY && y < sceneMaxY;
        }),
    );

    const input: Omit<SdMapLoaderInput, "loadedTextureIds"> = {
        mapX,
        mapY,
        maxLevel: Scene.MAX_LEVELS - 1,
        // As for every WebGPU map, NPCs are drawn from the live ECS, not baked.
        loadNpcs: false,
        smoothTerrain: true,
        minimizeDrawCalls: true,
        instance: { templateChunks, regionX, regionY },
        overrideRenderPos: { x: entityWorldBaseX, y: entityWorldBaseY },
        extraLocs: allExtraLocs.length > 0 ? allExtraLocs : undefined,
        locOverrides: deckLocOverrides.size > 0 ? deckLocOverrides : undefined,
    };

    let mapData;
    try {
        mapData = await renderer.loadSceneData(input);
    } catch (error) {
        console.error(`[webgpu] world entity scene load failed for entity ${entityIndex}`, error);
        mapData = undefined;
    }

    if (renderer.worldEntityLoadTokens.get(entityIndex) !== loadToken) return;

    if (mapData) {
        renderer.mapManager.worldEntityMapIds.add(mapId);
        renderer.queueWorldEntityMapData(mapData);
    } else {
        renderer.mapManager.loadingMapIds.delete(mapId);
    }
}

/** Reloads a world entity's overlay map after it went missing (MapManager cleanUp/GC). */
export function ensureWorldEntityOverlaysLoaded(renderer: WebGPURenderer, nowMs: number): void {
    for (const [entityIndex, overlay] of renderer.worldEntityOverlays) {
        const mapId = overlayMapId(entityIndex);
        if (renderer.mapManager.mapSquares.has(mapId)) continue;
        if (renderer.mapManager.loadingMapIds.has(mapId)) continue;

        const retryAfter = renderer.worldEntityReloadAfterMs.get(entityIndex) ?? 0;
        if (nowMs < retryAfter) continue;

        renderer.worldEntityReloadAfterMs.set(entityIndex, nowMs + 250);
        console.warn(`[webgpu] missing world entity overlay map, reloading entity=${entityIndex}`);
        void loadWorldEntityScene(
            renderer,
            overlay.entityIndex,
            overlay.templateChunks,
            overlay.regionX,
            overlay.regionY,
            overlay.worldX,
            overlay.worldY,
            overlay.sizeX,
            overlay.sizeZ,
            overlay.extraLocs,
            overlay.configId,
            overlay.extraNpcs,
            overlay.basePlane,
        );
    }
}

/** Rebuilds a deck after its locs changed (LOC_ADD_CHANGE arrives after the first build). */
export function scheduleWorldEntityLocRebuild(renderer: WebGPURenderer, entityIndex: number): void {
    if (renderer.worldEntityLocRebuildTimer !== null) return;
    renderer.worldEntityLocRebuildTimer = setTimeout(() => {
        renderer.worldEntityLocRebuildTimer = null;
        const overlay = renderer.worldEntityOverlays.get(entityIndex);
        if (!overlay) return;
        void loadWorldEntityScene(
            renderer,
            overlay.entityIndex,
            overlay.templateChunks,
            overlay.regionX,
            overlay.regionY,
            overlay.worldX,
            overlay.worldY,
            overlay.sizeX,
            overlay.sizeZ,
            overlay.extraLocs,
            overlay.configId,
            overlay.extraNpcs,
            overlay.basePlane,
        );
    }, 150);
}

/** The deck map drawn for an entity, once its scene has been applied. */
export function getOverlayMapForEntity(
    renderer: WebGPURenderer,
    entityIndex: number,
): WebGPUMapSquare | undefined {
    const mapX = 200 + entityIndex;
    return renderer.mapManager.getMap(mapX, mapX);
}

/** The entity a world-entity overlay map id belongs to, if any. */
export function getWorldEntityIndexForMapId(
    renderer: WebGPURenderer,
    mapId: number,
): number | undefined {
    for (const entityIndex of renderer.worldEntityOverlays.keys()) {
        if (overlayMapId(entityIndex) === mapId) return entityIndex;
    }
    return undefined;
}

/**
 * When a deck map is applied: all interaction/height queries on it use the deck plane, and the
 * deck height (port of render/frame/render.ts) is measured once from the map's own height map.
 */
export function configureWorldEntityOverlayMap(
    renderer: WebGPURenderer,
    square: WebGPUMapSquare,
): void {
    const entityIndex = getWorldEntityIndexForMapId(renderer, square.id);
    if (entityIndex === undefined) return;
    const overlay = renderer.worldEntityOverlays.get(entityIndex);
    if (!overlay) return;

    const weType = renderer.osrsClient.worldEntityTypeLoader?.load(overlay.configId);
    const basePlane = overlay.basePlane || (weType?.basePlane ?? 0);
    square.interactionPlane = basePlane;

    if (overlay.deckHeight !== undefined && overlay.deckHeight !== 0) return;
    if (basePlane === 0) {
        overlay.deckHeight = 0;
        return;
    }
    if (!square.heightMapData) return;
    const size = square.heightMapSize;
    const x = 48 + 4;
    const y = 48 + 4;
    if (x >= 0 && x < size && y >= 0 && y < size) {
        const raw = square.heightMapData[basePlane * size * size + y * size + x] ?? 0;
        overlay.deckHeight = -(raw * 8);
    }
}

/** Forgets the locs added inside a despawning boat's deck scene (indexes get reused). */
export function clearWorldEntityLocs(renderer: WebGPURenderer, entityIndex: number): void {
    const view = renderer.osrsClient.worldViewManager.getWorldView(entityIndex);
    if (!view || view.isTopLevel()) return;
    const inScene = (key: string): boolean => {
        const [x, y] = key.split(",").map(Number);
        return view.containsTile(x, y);
    };
    for (const locs of [renderer.addedLocs, renderer.locOverrides, renderer.locSpawns] as Map<
        string,
        unknown
    >[]) {
        for (const key of Array.from(locs.keys())) {
            if (inScene(key)) locs.delete(key);
        }
    }
}

/** Removes a despawned boat: its overlay map, world view, animator entry and tokens. */
export function clearWorldEntity(renderer: WebGPURenderer, entityIndex: number): void {
    const mapX = 200 + entityIndex;
    const mapId = getMapSquareId(mapX, mapX);
    renderer.mapManager.worldEntityMapIds.delete(mapId);
    renderer.mapManager.loadingMapIds.delete(mapId);
    renderer.mapManager.removeMap(mapX, mapX);
    renderer.worldEntityOverlays.delete(entityIndex);
    renderer.worldEntityLoadTokens.delete(entityIndex);
    renderer.worldEntityReloadAfterMs.delete(entityIndex);
    renderer.worldEntityAnimator?.removeEntity(entityIndex);
    renderer.osrsClient.worldViewManager.removeWorldView(entityIndex);
}

/** Clears every deck on logout; the next login gets fresh REBUILD_WORLDENTITY packets. */
export function clearWorldEntities(renderer: WebGPURenderer): void {
    for (const entityIndex of Array.from(renderer.worldEntityOverlays.keys())) {
        clearWorldEntity(renderer, entityIndex);
    }
    renderer.worldEntityAnimator?.clear();
    renderer.worldEntityAnimator = undefined;
}
