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

export async function loadInstanceScene(host: WebGLOsrsRendererHost, 
        templateChunks: number[][][],
        regionX: number,
        regionY: number,
    ): Promise<void> {

        if (!host.osrsClient.loadedCache) return;

        // The server replays its spawned locs after every rebuild.
        host.addedLocs.clear();
        host.locOverrides.clear();
        host.locSpawns.clear();

        // Suppress normal map streaming while the instance is active
        host.instanceActive = true;
        host.instanceTemplateChunks = templateChunks;
        host.instanceRegionX = regionX;
        host.instanceRegionY = regionY;

        // regionX/Y are chunk coordinates from the REBUILD_REGION packet.
        // The player tile = regionX*8, regionY*8. Map square = tile / 64.
        const playerMapX = ((regionX * 8) / Scene.MAP_SQUARE_SIZE) | 0;
        const playerMapY = ((regionY * 8) / Scene.MAP_SQUARE_SIZE) | 0;

        console.log(
            `[WebGLOsrsRenderer] Loading instance scene at map (${playerMapX}, ${playerMapY}) from region (${regionX}, ${regionY})...`,
        );

        // The current scene stays drawn while the new one builds; it is swapped out in the
        // same frame the new one is loaded (replaceSceneWithInstance), so nothing flashes.
        // LOC_ADD_CHANGE packets arrive right after REBUILD_REGION in the same batch: start
        // once they are in, so the scene is built once, with them.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (!host.instanceActive || host.instanceTemplateChunks !== templateChunks) return;
        if (host.instanceLocRebuildTimer !== null) {
            clearTimeout(host.instanceLocRebuildTimer);
            host.instanceLocRebuildTimer = null;
        }

        await host.doInstanceSceneBuild(templateChunks, regionX, regionY, playerMapX, playerMapY);
    
}

export async function doInstanceSceneBuild(host: WebGLOsrsRendererHost, 
        templateChunks: number[][][],
        regionX: number,
        regionY: number,
        playerMapX: number,
        playerMapY: number,
    ): Promise<void> {

        // Only the latest build is applied: a newer rebuild (or loc rebuild) supersedes this one.
        const build = ++host.instanceBuildSeq;
        const extraLocs = host.getInstanceExtraLocs(playerMapX, playerMapY);

        const input: SdMapLoaderInput = {
            mapX: playerMapX,
            mapY: playerMapY,
            maxLevel: Math.max(0, Math.min(Scene.MAX_LEVELS - 1, host.maxLevel | 0)),
            loadNpcs: host.loadNpcs,
            smoothTerrain: host.smoothTerrain,
            minimizeDrawCalls: !host.hasMultiDraw,
            loadedTextureIds: host.loadedTextureIds,
            instance: { templateChunks, regionX, regionY },
            locOverrides: host.locOverrides,
            terrainOverrides: host.terrainOverrides,
            mapRegionReplacements: host.mapRegionReplacements,
            extraLocs,
        };

        const mapData = await host.osrsClient.workerPool.queueLoad<
            SdMapLoaderInput,
            SdMapData | undefined,
            SdMapDataLoader
        >(host.dataLoader, input);

        if (build !== host.instanceBuildSeq || !host.instanceActive) return;

        if (mapData) {
            console.log(
                `[WebGLOsrsRenderer] Instance scene loaded: vertices=${
                    mapData.vertices?.length ?? 0
                } indices=${mapData.indices?.length ?? 0} mapX=${mapData.mapX} mapY=${
                    mapData.mapY
                } border=${mapData.borderSize} extraLocs=${extraLocs?.length ?? 0}`,
            );
            // Clear any in-flight normal map loads that arrived during the async instance build
            host.mapsToLoad.clear();
            host.pendingStreamMapsByGeneration.clear();
            // Bypass grid/generation checks — instance scenes are always valid
            host.pendingInstanceScene = mapData;
            host.mapsToLoad.push(mapData);
            // Register the map in MapManager so it isn't pruned
            host.mapManager.loadingMapIds.add(getMapSquareId(playerMapX, playerMapY));
        } else {
            console.warn("[WebGLOsrsRenderer] Instance scene load returned no data");
        }
    
}

/**
 * Called as a built instance scene is applied: drops whatever was drawn before (the previous
 * instance scene or the normal map) in the same step, and loads the new one without the
 * fog fade-in, so the swap happens between two frames.
 */
export function replaceSceneWithInstance(host: WebGLOsrsRendererHost, mapData: SdMapData): void {

        host.pendingInstanceScene = null;
        host.osrsClient.clearMinimapImageUrls();
        host.clearMaps();
        host.skipMapFadeIn = true;
        host.mapManager.loadingMapIds.add(getMapSquareId(mapData.mapX, mapData.mapY));
        // Its NPCs belong to this one square now, wherever in the scene they stand.
        host.instanceSceneMap = { mapX: mapData.mapX | 0, mapY: mapData.mapY | 0 };
        host.osrsClient.rehomeNpcs?.(getMapSquareId(mapData.mapX, mapData.mapY));
    
}

export function getInstanceExtraLocs(host: WebGLOsrsRendererHost, 
        playerMapX: number,
        playerMapY: number,
    ): SdMapLoaderInput["extraLocs"] {

        if (host.addedLocs.size === 0) return undefined;

        // Instance scene is built as a single map square at (playerMapX, playerMapY).
        // Collect all addedLocs — the scene builder will filter by bounds.
        const locs: Array<{
            id: number;
            x: number;
            y: number;
            level: number;
            shape: number;
            rotation: number;
        }> = [];
        for (const loc of host.addedLocs.values()) {
            locs.push({
                id: loc.locId,
                x: loc.x,
                y: loc.y,
                level: loc.level,
                shape: loc.shape,
                rotation: loc.rotation,
            });
        }
        return locs.length > 0 ? locs : undefined;
    
}

export function scheduleInstanceLocRebuild(host: WebGLOsrsRendererHost, ): void {

        if (host.instanceLocRebuildTimer !== null) {
            clearTimeout(host.instanceLocRebuildTimer);
        }
        host.instanceLocRebuildTimer = setTimeout(() => {
            host.instanceLocRebuildTimer = null;
            if (!host.instanceActive || !host.instanceTemplateChunks) return;
            const playerMapX = ((host.instanceRegionX * 8) / Scene.MAP_SQUARE_SIZE) | 0;
            const playerMapY = ((host.instanceRegionY * 8) / Scene.MAP_SQUARE_SIZE) | 0;
            console.log(
                `[WebGLOsrsRenderer] Rebuilding instance scene with ${host.addedLocs.size} extra locs`,
            );
            host.doInstanceSceneBuild(
                host.instanceTemplateChunks,
                host.instanceRegionX,
                host.instanceRegionY,
                playerMapX,
                playerMapY,
            );
        }, 100);
    
}

export function clearInstance(host: WebGLOsrsRendererHost, ): void {

        host.instanceActive = false;
        host.pendingInstanceScene = null;
        host.instanceSceneMap = null;
        host.osrsClient.clearMinimapImageUrls();
        host.instanceTemplateChunks = null;
        if (host.instanceLocRebuildTimer !== null) {
            clearTimeout(host.instanceLocRebuildTimer);
            host.instanceLocRebuildTimer = null;
        }
        host.addedLocs.clear();
        host.locOverrides.clear();
        host.locSpawns.clear();
        host.clearMaps();
        host.osrsClient.rehomeNpcs?.();
        console.log("[WebGLOsrsRenderer] Instance cleared, normal map streaming resumed");
    
}
