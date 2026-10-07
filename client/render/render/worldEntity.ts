import Denque from "denque";
import { mat4, vec2, vec3, vec4 } from "gl-matrix";
import { button, folder } from "leva";
import { Schema } from "leva/dist/declarations/src/types";
import {
    DrawCall,
    Framebuffer,
    App as PicoApp,
    PicoGL,
    Program,
    Renderbuffer,
    Texture,
    Timer,
    UniformBuffer,
    VertexArray,
    VertexBuffer,
} from "picogl";

import {
    getClientCycle,
    getCurrentTick,
    getServerTickPhaseNow,
    isServerConnected,
    sendEmote,
    sendInteractFollow,
    sendInteractStop,
    subscribeTick,
} from "../../network/ServerConnection";
import { sendLogin } from "../../network/ServerConnection";
import { flushPackets } from "../../network/packet";
import { createTextureArray } from "../../picogl/PicoTexture";
import { RS_TO_RADIANS } from "../../rs/MathConstants";
import { CollisionFlag } from "../../common/CollisionFlag";
import {
    getWorldLocChanges,
    getWorldLocSpawns,
    getWorldTerrainOverrides,
} from "../../common/gamemode/GamemodeContentStore";
import { OsrsMenuEntry } from "../../rs/MenuEntry";
import { MenuTargetType } from "../../rs/MenuEntry";
import type { OverlayFloorType } from "../../rs/config/floortype/OverlayFloorType";
import { LocModelLoader } from "../../rs/config/loctype/LocModelLoader";
import { LocModelType } from "../../rs/config/loctype/LocModelType";
import { NpcModelLoader } from "../../rs/config/npctype/NpcModelLoader";
import { NpcDrawPriority, NpcType } from "../../rs/config/npctype/NpcType";
import { PlayerAppearance } from "../../rs/config/player/PlayerAppearance";
import { PlayerModelLoader } from "../../rs/config/player/PlayerModelLoader";
import { decodeInteractionIndex } from "../../rs/interaction/InteractionIndex";
import { getMapIndexFromTile, getMapPlaneId, getMapSquareId } from "../../rs/map/MapFileIndex";
import { Model } from "../../rs/model/Model";
import { ModelData } from "../../rs/model/ModelData";
import { Scene } from "../../rs/scene/Scene";
import { getUiScale } from "../../ui/UiScale";
import { ClickCrossOverlay } from "../../ui/devoverlay/ClickCrossOverlay";
import { GroundItemOverlay } from "../../ui/devoverlay/GroundItemOverlay";
import { HealthBarOverlay } from "../../ui/devoverlay/HealthBarOverlay";
import { HitsplatOverlay } from "../../ui/devoverlay/HitsplatOverlay";
import {
    InteractHighlightDrawTarget,
    InteractHighlightOverlay,
} from "../../ui/devoverlay/InteractHighlightOverlay";
import { LoadingMessageOverlay } from "../../ui/devoverlay/LoadingMessageOverlay";
import { LoginOverlay } from "../../ui/devoverlay/LoginOverlay";
import { OverheadPrayerOverlay } from "../../ui/devoverlay/OverheadPrayerOverlay";
import { OverheadTextOverlay } from "../../ui/devoverlay/OverheadTextOverlay";
import {
    HealthBarEntry,
    HitsplatEntry,
    OverheadPrayerEntry,
    OverheadTextEntry,
    type OverlayUpdateArgs,
    RenderPhase,
} from "../../ui/devoverlay/Overlay";
import { OverlayManager } from "../../ui/devoverlay/OverlayManager";
import type { TileMarkerOverlay } from "../../ui/devoverlay/TileMarkerOverlay";
import { TileTextOverlay } from "../../ui/devoverlay/TileTextOverlay";
import { WidgetsOverlay } from "../../ui/devoverlay/WidgetsOverlay";
import { MENU_ACTION_DEPRIORITIZE_OFFSET, MenuAction, menuAction } from "../../ui/menu/MenuAction";
import { worldEntriesToSimple } from "../../ui/menu/MenuBridge";
import type { MenuClickContext, SimpleMenuEntry } from "../../ui/menu/MenuEngine";
import { chooseDefaultMenuEntry, shouldLeftClickOpenMenu } from "../../ui/menu/MenuEngine";
import { MenuOpcode } from "../../ui/menu/MenuState";
import { Model2DRenderer } from "../../ui/model/Model2DRenderer";
import {
    canTargetGroundItem,
    canTargetNpc,
    canTargetObject,
    canTargetPlayer,
} from "../../widgets/WidgetFlags";
import { WidgetLoader } from "../../widgets/WidgetLoader";
import { WidgetManager } from "../../widgets/WidgetManager";
import { layoutWidgets } from "../../widgets/layout/WidgetLayout";
import { collectWidgetsAtPoint } from "../../widgets/menu/utils";
import {
    getCanvasCssSize,
    isIos,
    isMobileMode,
    isTouchDevice,
    isWebGL2Supported,
} from "../../common/utils/DeviceUtil";
import { clamp } from "../../common/utils/MathUtil";
import { ClientState } from "../../game/ClientState";
import { GameRenderer } from "../../game/GameRenderer";
import type { HitsplatEventPayload } from "../../game/GameRenderer";
import { OsrsRendererType, WEBGL } from "../../game/GameRenderers";
import { ClickMode, getMousePos } from "../../game/InputManager";
import { OsrsClient } from "../../game/OsrsClient";
import { ActorAnimationClip } from "../../game/actor/ActorAnimation";
import {
    ActorHealthBarsState,
    ActorHitsplatState,
    HealthBarBarState,
    HealthBarDefinitionState,
    HealthBarUpdateState,
    MAX_HITSPLAT_SLOTS,
    createActorHealthBarsState,
    createActorHitsplatState,
} from "../../game/actor/ActorOverlayState";
import type { ClientGroundItemStack, GroundItemOverlayEntry } from "../../game/data/ground/GroundItemStore";
import { NpcEcs } from "../../game/ecs/NpcEcs";
import type { PlayerAnimKey } from "../../game/ecs/PlayerEcs";
import { GameState, LoginIndex } from "../../game/login";
import { Ray, rayIntersectsBox } from "../../game/math/Raycast";
import { isMouseInUIRegion as checkMouseInUIRegion } from "../../game/menu/WorldMenuBuilder";
import {
    advanceAnimation,
    computeMovementOrientation,
    computeMovementStep,
    interpolateRotation,
    parseInteractionTarget,
} from "../../game/movement/NpcClientTick";
import type { TileMarkersPluginConfig } from "../../game/plugins/tilemarkers/types";
import { computeRoofPlaneLimit } from "../../game/roof/RoofVisibility";
import { sampleBridgeHeightForWorldTile } from "../../game/scene/BridgeHeightSampler";
import {
    BridgePlaneStrategy,
    resolveBridgePromotedPlane,
    resolveCollisionSamplePlaneForLocal,
    resolveCollisionSamplePlaneForWorldTile,
    resolveGroundItemStackPlane,
    resolveHeightSamplePlaneForLocal,
    resolveInteractionPlaneForLocal,
    resolveInteractionPlaneForWorldTile,
} from "../../game/scene/PlaneResolver";
import { SceneRaycastHit, SceneRaycaster } from "../../game/scene/SceneRaycaster";
import {
    TILE_FLAG_BRIDGE,
    getTileRenderFlagAt as lookupTileRenderFlagAt,
} from "../../game/scene/TileRenderFlags";
import { LoadingRequirement } from "../../game/state/LoadingTracker";
import type { PlayerSpotAnimationEvent } from "../../game/sync/PlayerSyncTypes";
import { RAD_TO_RS_UNITS, computeFacingRotation } from "../../game/utils/rotation";
import { AnimationFrames } from "../AnimationFrames";
import { ChatheadFactory } from "../ChatheadFactory";
import { type DrawBackend, createDrawBackend } from "../DrawBackend";
import { DrawRange, NULL_DRAW_RANGE, newDrawRange } from "../DrawRange";
import { InteractType } from "../InteractType";
import { profiler } from "../PerformanceProfiler";
import { PlayerChatheadFactory } from "../PlayerChatheadFactory";
import { resolveFogRange } from "../RenderDistancePolicy";
import { WebGLMapSquare } from "../WebGLMapSquare";
import { WorldEntityAnimator } from "../WorldEntityAnimator";
import { SceneBuffer } from "../buffer/SceneBuffer";
import { getModelFaces, isModelFaceTransparent } from "../buffer/SceneBuffer";
import { GfxManager } from "../gfx/GfxManager";
import { GfxRenderer } from "../gfx/GfxRenderer";
import { buildGroundItemGeometry } from "../ground/GroundItemMeshBuilder";
import { type MinimapIcon, SdMapData } from "../loader/SdMapData";
import { SdMapDataLoader } from "../loader/SdMapDataLoader";
import { SdMapLoaderInput } from "../loader/SdMapLoaderInput";
import { isDoorLocType } from "../loc/SceneLocs";
import {
    DynamicNpcAnimLoader,
    DynamicNpcFrameGeometry,
    DynamicNpcSequenceMeta,
} from "../npc/DynamicNpcAnimLoader";
import { PlayerRenderer } from "../player/PlayerRenderer";
import { ProjectileManager } from "../projectiles/ProjectileManager";
import { ProjectileRenderer } from "../projectiles/ProjectileRenderer";
import {
    FRAME_FXAA_PROGRAM,
    FRAME_PROGRAM,
    createMainProgram,
    createNpcProgram,
    createPlayerProgram,
    createProjectileProgram,
} from "../shaders/Shaders";
import { KNOWN_WATER_TEXTURE_IDS } from "../water/WaterTextureIds";
import type { WebGLOsrsRendererHost } from "./hostInterface";
import { RENDER_CONSTANTS } from "./constants";

export async function loadWorldEntityScene(host: WebGLOsrsRendererHost, 
        entityIndex: number,
        templateChunks: number[][][],
        regionX: number,
        regionY: number,
        worldX: number,
        worldY: number,
        sizeX: number,
        sizeZ: number,
        extraLocs: Array<{
            id: number;
            x: number;
            y: number;
            level: number;
            shape: number;
            rotation: number;
        }>,
        configId: number = -1,
        extraNpcs?: Array<{ id: number; x: number; y: number; level: number }>,
        basePlane: number = 0,
    ): Promise<void> {

        if (!host.osrsClient.loadedCache) return;

        const loadToken = host.nextWorldEntityLoadToken++;
        host.worldEntityLoadTokens.set(entityIndex, loadToken);
        const existingEntity = host.osrsClient.worldViewManager.getWorldEntity(entityIndex);
        // A rebuild (a facility built, deck locs changed) keeps the current deck drawn, placed
        // and animating until the new one replaces it in place (MapManager.addMap), so the
        // boat doesn't vanish while the new scene builds.
        const previous = host.worldEntityOverlays.get(entityIndex);
        const rebuilding = previous !== undefined;

        const sceneTilesX = (templateChunks[0]?.length ?? 13) * 8;
        const sceneTilesY = (templateChunks[0]?.[0]?.length ?? 13) * 8;
        const sceneSizeHalf = sceneTilesX / 2;
        const entityWorldBaseX = worldX - sceneSizeHalf;
        const entityWorldBaseY = worldY - sceneTilesY / 2;

        // Use a unique mapX/Y for the overlay that won't collide with real map squares
        const overlayMapX = 200 + entityIndex;
        const overlayMapY = 200 + entityIndex;
        const overlayMapId = getMapSquareId(overlayMapX, overlayMapY);
        host.mapManager.loadingMapIds.add(overlayMapId);

        console.log(
            `[WebGLOsrsRenderer] Loading world entity overlay: entity=${entityIndex} config=${configId} source=(${regionX},${regionY}) worldPos=(${worldX},${worldY}) renderBase=(${entityWorldBaseX},${entityWorldBaseY})`,
        );

        host.worldEntityOverlays.set(entityIndex, {
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
        });

        // Register with WorldViewManager
        host.osrsClient.worldViewManager.createWorldView(entityIndex, sceneTilesX, sceneTilesY, {
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
        }, existingEntity);

        if (configId >= 0 && (!rebuilding || previous.configId !== configId)) {
            host.ensureWorldEntityAnimator();
            host.worldEntityAnimator?.addEntity(entityIndex, configId, host.lastTick);
        }

        // Collect extra locs from addedLocs that fall within the source region
        const CHUNK_SIZE = 8;
        const sceneBaseX = (regionX - 6) * CHUNK_SIZE;
        const sceneBaseY = (regionY - 6) * CHUNK_SIZE;
        const sceneMaxX = sceneBaseX + 13 * CHUNK_SIZE;
        const sceneMaxY = sceneBaseY + 13 * CHUNK_SIZE;
        const allExtraLocs: typeof extraLocs = [...extraLocs];
        for (const loc of host.addedLocs.values()) {
            if (
                loc.x >= sceneBaseX &&
                loc.x < sceneMaxX &&
                loc.y >= sceneBaseY &&
                loc.y < sceneMaxY
            ) {
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
        console.log(
            `[WebGLOsrsRenderer] World entity overlay: ${allExtraLocs.length} extra locs, ${
                extraNpcs?.length ?? 0
            } extra NPCs`,
        );

        // Loc animations (and replaced locs) on the deck, keyed by deck tile like extra locs.
        const deckLocOverrides = new Map(
            [...host.locOverrides].filter(([key]) => {
                const [x, y] = key.split(",").map(Number);
                return x >= sceneBaseX && x < sceneMaxX && y >= sceneBaseY && y < sceneMaxY;
            }),
        );

        const input: SdMapLoaderInput = {
            mapX: overlayMapX,
            mapY: overlayMapY,
            maxLevel: Math.max(0, Math.min(Scene.MAX_LEVELS - 1, host.maxLevel | 0)),
            loadNpcs: host.loadNpcs,
            smoothTerrain: host.smoothTerrain,
            minimizeDrawCalls: !host.hasMultiDraw,
            loadedTextureIds: host.loadedTextureIds,
            instance: { templateChunks, regionX, regionY },
            overrideRenderPos: { x: entityWorldBaseX, y: entityWorldBaseY },
            extraLocs: allExtraLocs.length > 0 ? allExtraLocs : undefined,
            extraNpcs: extraNpcs && extraNpcs.length > 0 ? extraNpcs : undefined,
            locOverrides: deckLocOverrides.size > 0 ? deckLocOverrides : undefined,
        };

        const mapData = await host.osrsClient.workerPool.queueLoad<
            SdMapLoaderInput,
            SdMapData | undefined,
            SdMapDataLoader
        >(host.dataLoader, input);

        if (host.worldEntityLoadTokens.get(entityIndex) !== loadToken) {
            return;
        }

        if (mapData) {
            console.log(
                `[WebGLOsrsRenderer] World entity overlay loaded: entity=${entityIndex} vertices=${
                    mapData.vertices?.length ?? 0
                }`,
            );
            host.mapsToLoad.push(mapData);
            host.mapManager.loadingMapIds.add(overlayMapId);
            host.mapManager.worldEntityMapIds.add(overlayMapId);
        } else {
            host.mapManager.loadingMapIds.delete(overlayMapId);
        }
    
}

export function ensureWorldEntityOverlaysLoaded(host: WebGLOsrsRendererHost, nowMs: number): void {

        for (const [entityIndex, overlay] of host.worldEntityOverlays) {
            const overlayMapX = 200 + entityIndex;
            const overlayMapY = 200 + entityIndex;
            const overlayMapId = getMapSquareId(overlayMapX, overlayMapY);
            if (host.mapManager.mapSquares.has(overlayMapId)) continue;
            if (host.mapManager.loadingMapIds.has(overlayMapId)) continue;

            const retryAfter = host.worldEntityReloadAfterMs.get(entityIndex) ?? 0;
            if (nowMs < retryAfter) continue;

            host.worldEntityReloadAfterMs.set(entityIndex, nowMs + 250);
            console.warn(
                `[WebGLOsrsRenderer] Missing world entity overlay map, reloading entity=${entityIndex}`,
            );
            void host.loadWorldEntityScene(
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

export function scheduleWorldEntityLocRebuild(host: WebGLOsrsRendererHost, entityIndex: number): void {

        if (host.worldEntityLocRebuildTimer !== null) return;
        host.worldEntityLocRebuildTimer = setTimeout(() => {
            host.worldEntityLocRebuildTimer = null;
            const overlay = host.worldEntityOverlays.get(entityIndex);
            if (!overlay) return;
            console.log(`[WebGLOsrsRenderer] Rebuilding world entity overlay with deferred locs`);
            host.loadWorldEntityScene(
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

export function ensureWorldEntityAnimator(host: WebGLOsrsRendererHost, ): void {

        if (host.worldEntityAnimator) return;
        host.worldEntityAnimator = new WorldEntityAnimator(
            host.osrsClient.worldEntityTypeLoader,
            host.osrsClient.seqTypeLoader,
            host.osrsClient.skeletalSeqLoader,
        );
    
}

export function getWorldEntityIndexForMapId(host: WebGLOsrsRendererHost, mapId: number): number | undefined {

        for (const [entityIndex] of host.worldEntityOverlays) {
            const overlayMapX = 200 + entityIndex;
            const overlayMapY = 200 + entityIndex;
            if (getMapSquareId(overlayMapX, overlayMapY) === mapId) {
                return entityIndex;
            }
        }
        return undefined;
    
}

export function getOverlayMapForEntity(host: WebGLOsrsRendererHost, entityIndex: number): WebGLMapSquare | undefined {

        const overlayMapId = getMapSquareId(200 + entityIndex, 200 + entityIndex);
        return host.mapManager.mapSquares.get(overlayMapId);
    
}

export function getWorldEntityTransformForMap(host: WebGLOsrsRendererHost, map: WebGLMapSquare): Float32Array {

        if (!host.mapManager.worldEntityMapIds.has(map.id)) {
            return WebGLMapSquare.IDENTITY_MAT4;
        }
        const entityIndex = host.getWorldEntityIndexForMapId(map.id);
        if (entityIndex === undefined) return WebGLMapSquare.IDENTITY_MAT4;
        return host.worldEntityAnimator?.getTransform(entityIndex) ?? WebGLMapSquare.IDENTITY_MAT4;
    
}

export function getWorldEntityTransformForMapOrOverlap(host: WebGLOsrsRendererHost, map: WebGLMapSquare): Float32Array {

        const direct = host.getWorldEntityTransformForMap(map);
        if (direct !== WebGLMapSquare.IDENTITY_MAT4) return direct;
        for (const [entityIndex, overlay] of host.worldEntityOverlays) {
            const entityMapX = Math.floor(overlay.worldX / 64) | 0;
            const entityMapY = Math.floor(overlay.worldY / 64) | 0;
            if (map.mapX === entityMapX && map.mapY === entityMapY) {
                return (
                    host.worldEntityAnimator?.getTransform(entityIndex) ??
                    WebGLMapSquare.IDENTITY_MAT4
                );
            }
        }
        return WebGLMapSquare.IDENTITY_MAT4;
    
}

export function getWorldEntityDeckHeight(host: WebGLOsrsRendererHost, _overworldTileX: number, _overworldTileY: number): number {

        for (const [, overlay] of host.worldEntityOverlays) {
            if (overlay.deckHeight !== undefined && overlay.deckHeight !== 0) {
                return overlay.deckHeight;
            }
        }
        return 0;
    
}

export function getNpcModelYOffset(host: WebGLOsrsRendererHost, deckHeight: number = 0): number {

        // npc.vert.glsl subtracts this uniform. Invert the shared clearance so
        // NPCs use the same effective world-space offset as players.
        return -(deckHeight + RENDER_CONSTANTS.ACTOR_GROUND_CLEARANCE_MODEL_UNITS);
    
}

export function getWorldEntityTransformForTile(host: WebGLOsrsRendererHost, tileX: number, tileY: number): Float32Array {

        for (const [entityIndex, overlay] of host.worldEntityOverlays) {
            const halfSize = (overlay.sizeX * 8) / 2;
            const minX = overlay.worldX - halfSize;
            const maxX = overlay.worldX + halfSize;
            const minY = overlay.worldY - halfSize;
            const maxY = overlay.worldY + halfSize;
            if (tileX >= minX && tileX < maxX && tileY >= minY && tileY < maxY) {
                return (
                    host.worldEntityAnimator?.getTransform(entityIndex) ??
                    WebGLMapSquare.IDENTITY_MAT4
                );
            }
        }
        return WebGLMapSquare.IDENTITY_MAT4;
    
}

/**
 * Forgets the locs added inside a world entity's deck scene. A despawned boat's entity index,
 * and so its deck coordinates, is reused for the next boat, which would otherwise show the old
 * boat's parts wherever its own don't overwrite them. Only for a despawn: a scene rebuilt in
 * place keeps the locs sent for it.
 */
export function clearWorldEntityLocs(host: WebGLOsrsRendererHost, entityIndex: number): void {
    const view = host.osrsClient.worldViewManager.getWorldView(entityIndex);
    if (!view || view.isTopLevel()) return;
    const inScene = (key: string): boolean => {
        const [x, y] = key.split(",").map(Number);
        return view.containsTile(x, y);
    };
    for (const locs of [host.addedLocs, host.locOverrides, host.locSpawns] as Map<string, unknown>[]) {
        for (const key of Array.from(locs.keys())) {
            if (inScene(key)) locs.delete(key);
        }
    }
}

export function clearWorldEntity(host: WebGLOsrsRendererHost, entityIndex: number): void {

        const overlayMapX = 200 + entityIndex;
        const overlayMapY = 200 + entityIndex;
        const overlayMapId = getMapSquareId(overlayMapX, overlayMapY);
        host.mapManager.worldEntityMapIds.delete(overlayMapId);
        host.mapManager.loadingMapIds.delete(overlayMapId);
        host.mapManager.removeMap(overlayMapX, overlayMapY);
        host.worldEntityOverlays.delete(entityIndex);
        host.worldEntityLoadTokens.delete(entityIndex);
        host.worldEntityReloadAfterMs.delete(entityIndex);
        host.worldEntityAnimator?.removeEntity(entityIndex);
        host.osrsClient.worldViewManager.removeWorldView(entityIndex);
    
}
