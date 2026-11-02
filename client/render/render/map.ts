import { LocAnimated } from "../loc/LocAnimated";
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
import { cancelPendingMapUploads } from "./streaming";

export function resolveLocReloadBatchMap(host: WebGLOsrsRendererHost, 
        batchId: number,
        mapId: number,
        mapData: SdMapData | undefined,
    ): void {

        const batch = host.pendingLocReloadBatches.get(batchId);
        if (!batch) {
            if (mapData) {
                host.mapsToLoad.push(mapData);
            }
            return;
        }

        if (mapData) {
            batch.loaded.set(mapId, mapData);
        }
        batch.pendingMapIds.delete(mapId);

        if (batch.pendingMapIds.size > 0) {
            return;
        }

        // Commit the whole loc-reload batch together so multi-square gates don't show half-updates.
        for (const expectedMapId of batch.mapIds) {
            const ready = batch.loaded.get(expectedMapId);
            if (!ready) continue;
            host.mapsToLoad.push(ready);
            host.queuedLocReloadBatchByMap.set(expectedMapId, batch.id);
        }
        host.pendingLocReloadBatches.delete(batchId);
    
}

export function beginLocReloadBatch(host: WebGLOsrsRendererHost, maps: Array<{ mapX: number; mapY: number }>): void {

        if (maps.length === 0) return;

        const ordered = maps
            .map((map) => ({
                mapX: map.mapX | 0,
                mapY: map.mapY | 0,
                mapId: getMapSquareId(map.mapX, map.mapY),
            }))
            .sort((a, b) => a.mapId - b.mapId);
        const mapIds = ordered.map((entry) => entry.mapId);
        const batchId = host.nextLocReloadBatchId++;
        host.pendingLocReloadBatches.set(batchId, {
            id: batchId,
            mapIds,
            pendingMapIds: new Set<number>(mapIds),
            loaded: new Map<number, SdMapData>(),
        });

        for (const entry of ordered) {
            void host.queueLoadMap(entry.mapX, entry.mapY, undefined, batchId);
        }
    
}

/** A partial loc build that no longer fits the drawn square: build all of it instead. */
function reloadWholeSquare(host: WebGLOsrsRendererHost, mapX: number, mapY: number): void {
    // Instances rebuild their whole scene; map streaming is off while they are active.
    if (host.instanceActive) {
        host.scheduleInstanceLocRebuild();
        return;
    }
    host.pendingLocUpdates.add(getMapSquareId(mapX, mapY));
    void host.queueLoadMap(mapX, mapY);
}

export function loadMap(host: WebGLOsrsRendererHost, 
        mainProgram: Program,
        mainAlphaProgram: Program,
        npcProgram: Program,
        textureArray: Texture,
        textureMaterials: Texture,
        waterTextures: Texture,
        sceneUniformBuffer: UniformBuffer,
        mapData: SdMapData,
    ): void {

        const { mapX, mapY } = mapData;
        const mapId = getMapSquareId(mapX, mapY);
        const existing = host.mapManager.getMap(mapX, mapY);
        const isLocUpdate = host.pendingLocUpdates.has(mapId);
        const isLocGeometryUpdate = !isLocUpdate && host.pendingLocGeometryUpdates.has(mapId);
        const isDoorOnlyUpdate =
            !isLocUpdate && !isLocGeometryUpdate && host.pendingDoorLocUpdates.has(mapId);

        // A door-only payload is valid only while the original map square is
        // still resident and no broader loc update has superseded it.
        if (mapData.doorOnly && (!isDoorOnlyUpdate || !(existing instanceof WebGLMapSquare))) {
            host.pendingDoorLocUpdates.delete(mapId);
            reloadWholeSquare(host, mapX, mapY);
            return;
        }
        if (mapData.locOnly && (!isLocGeometryUpdate || !(existing instanceof WebGLMapSquare))) {
            host.pendingLocGeometryUpdates.delete(mapId);
            reloadWholeSquare(host, mapX, mapY);
            return;
        }

        if (
            (isLocUpdate || isLocGeometryUpdate || isDoorOnlyUpdate) &&
            existing instanceof WebGLMapSquare
        ) {
            WebGLMapSquare.cancelPreparedLoad(mapData);
            if (isDoorOnlyUpdate && mapData.doorOnly) {
                existing.refreshDoorGeometry(
                    host.app,
                    mainProgram,
                    mainAlphaProgram,
                    textureArray,
                    textureMaterials,
                    waterTextures,
                    sceneUniformBuffer,
                    mapData,
                    existing.timeLoaded,
                );
            } else if (isLocGeometryUpdate && mapData.locOnly) {
                existing.refreshLocGeometry(
                    host.osrsClient.seqTypeLoader,
                    host.app,
                    mainProgram,
                    mainAlphaProgram,
                    textureArray,
                    textureMaterials,
                    waterTextures,
                    sceneUniformBuffer,
                    mapData,
                    getClientCycle() | 0,
                    existing.timeLoaded,
                );
            } else {
                existing.refreshSceneGeometry(
                    host.osrsClient.seqTypeLoader,
                    host.osrsClient.seqFrameLoader,
                    host.app,
                    mainProgram,
                    mainAlphaProgram,
                    textureArray,
                    textureMaterials,
                    waterTextures,
                    sceneUniformBuffer,
                    mapData,
                    getClientCycle() | 0,
                    existing.timeLoaded,
                );
            }

            if (!mapData.doorOnly) {
                host.registerMinimapData(mapData);
            }

            host.mapManager.addMap(mapX, mapY, existing);
            // Ground items stand on the locs just rebuilt; a door-only build changes none of those.
            if (!mapData.doorOnly) {
                if (host.rebuildGroundItemsForMap(existing, host.groundItemStacks.get(mapId))) {
                    host.groundItemStackHashes.delete(mapId);
                }
            }
            host.pendingLocUpdates.delete(mapId);
            host.pendingLocGeometryUpdates.delete(mapId);
            host.pendingDoorLocUpdates.delete(mapId);
            host.updateTextureArray(mapData.loadedTextures);
            return;
        }

        host.registerMinimapData(mapData);

        const frameCount = host.stats.frameCount;
        // The grid appears atomically; individual upload times must not fade its squares separately.
        const reuseTime = existing instanceof WebGLMapSquare ? existing.timeLoaded : -1.0;
        const reuseFrame = existing instanceof WebGLMapSquare ? existing.frameLoaded : frameCount;

        const loadedMap = WebGLMapSquare.load(
            host.osrsClient.seqTypeLoader,
            host.osrsClient.seqFrameLoader,
            host.osrsClient.npcTypeLoader,
            host.osrsClient.basTypeLoader,
            host.app,
            mainProgram,
            mainAlphaProgram,
            npcProgram,
            textureArray,
            textureMaterials,
            waterTextures,
            sceneUniformBuffer,
            mapData,
            reuseTime,
            getClientCycle() | 0,
            reuseFrame,
            host.osrsClient.npcEcs,
        );

        if (host.carriedLocAnimations) {
            LocAnimated.carryOver(host.carriedLocAnimations, loadedMap.locsAnimated);
            host.carriedLocAnimations = null;
        }

        // For instances, set base world position for height sampling.
        // The height data is at source coordinates, not instance coordinates.
        if (mapData.renderPosX != null) {
            (loadedMap as any).baseWorldX =
                (mapData.renderPosX - mapData.borderSize / Scene.MAP_SQUARE_SIZE) *
                Scene.MAP_SQUARE_SIZE;
            (loadedMap as any).baseWorldY =
                (mapData.renderPosY! - mapData.borderSize / Scene.MAP_SQUARE_SIZE) *
                Scene.MAP_SQUARE_SIZE;
        }
        host.mapManager.addMap(mapX, mapY, loadedMap);
        if (host.rebuildGroundItemsForMap(loadedMap, host.groundItemStacks.get(mapId))) {
            host.groundItemStackHashes.delete(mapId);
        }

        host.updateTextureArray(mapData.loadedTextures);

        host.pendingLocUpdates.delete(mapId);
        host.pendingLocGeometryUpdates.delete(mapId);
        host.pendingDoorLocUpdates.delete(mapId);
    
}

export function isValidMapData(host: WebGLOsrsRendererHost, mapData: SdMapData): boolean {

        return (
            mapData.cacheName === host.osrsClient.loadedCache?.info?.name &&
            mapData.loadNpcs === host.loadNpcs &&
            mapData.smoothTerrain === host.smoothTerrain
        );
    
}

export function clearMaps(host: WebGLOsrsRendererHost, ): void {
        cancelPendingMapUploads(host);
        host.mapManager.cleanUp();
        host.mapsToLoad.clear();
        host.pendingStreamMapsByGeneration.clear();
        host.observedGridRevision = -1;
        host.activeStreamGeneration = 0;
        host.activeStreamExpectedMapIds.clear();
        host.pendingLocUpdates.clear();
        host.pendingLocGeometryUpdates.clear();
        host.pendingDoorLocUpdates.clear();
        host.pendingLocReloadMaps.clear();
        host.locReloadVersions.clear();
        host.pendingLocReloadBatches.clear();
        host.queuedLocReloadBatchByMap.clear();
        host.nextLocReloadBatchId = 1;
        if (host.pendingLocReloadFlushTimer) {
            clearTimeout(host.pendingLocReloadFlushTimer);
            host.pendingLocReloadFlushTimer = undefined;
        }
        host.minimapIcons.clear();
        host.clearDynamicNpcAnimRuntimeState();
    
}

export function getMinimapIcons(host: WebGLOsrsRendererHost, mapX: number, mapY: number, level: number = 0): MinimapIcon[] | undefined {

        return host.minimapIcons.get(getMapPlaneId(mapX | 0, mapY | 0, level | 0));
    
}

export function setMaxLevel(host: WebGLOsrsRendererHost, maxLevel: number): void {

        const updated = host.maxLevel !== maxLevel;
        host.maxLevel = maxLevel;
        if (updated) {
            host.clearMaps();
        }
    
}
