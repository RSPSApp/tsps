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
import { cleanUpRenderer } from "./handlers";

export function clearSessionCaches(host: WebGLOsrsRendererHost, ): void {

        // Clear NPC type caches (grow with each unique NPC type seen)
        host.npcDefaultHeightCache.clear();
        host.npcNameCache.clear();

        // Clear hitsplat/health bar state
        host.npcHitsplats.clear();
        host.playerHitsplats.clear();
        host.npcHealthBars.clear();
        host.playerHealthBars.clear();
        host.hitsplatSeenNpc.clear();
        host.actorServerTilesSeenNpc.clear();

        // Clear loc overrides and spawns (door state changes accumulate)
        host.locOverrides.clear();
        host.addedLocs.clear();
        for (const timer of host.locAnimTimers.values()) {
            clearTimeout(timer);
        }
        host.locAnimTimers.clear();
        host.locSpawns.clear();
        host.terrainOverrides.clear();
        host.mapRegionReplacements.clear();
        host.gamemodeWorldLocOverrideKeys.clear();
        host.gamemodeWorldLocSpawnKeys.clear();
        host.gamemodeWorldTerrainOverrideKeys.clear();
        host.mapsToLoad.clear();
        host.pendingStreamMapsByGeneration.clear();
        host.observedGridRevision = -1;
        host.activeStreamGeneration = 0;
        host.activeStreamExpectedMapIds.clear();
        host.pendingLocUpdates.clear();
        host.pendingLocGeometryUpdates.clear();
        host.pendingDoorLocUpdates.clear();
        host.pendingLocReloadMaps.clear();
        host.pendingLocReloadBatches.clear();
        host.queuedLocReloadBatchByMap.clear();
        host.nextLocReloadBatchId = 1;
        if (host.pendingLocReloadFlushTimer) {
            clearTimeout(host.pendingLocReloadFlushTimer);
            host.pendingLocReloadFlushTimer = undefined;
        }

        // Clear ground item rendering caches
        host.groundItemStacks.clear();
        host.groundItemStackHashes.clear();
        host.clearInteractHighlightActiveTarget();
        host.clearInteractHighlightHoverTarget();
        host.interactHighlightDrawTargets.length = 0;

        // Clear minimap icons
        host.minimapIcons.clear();

        // Clear cached overlay state
        host.cachedSceneOverlayUpdateArgs = null;
        host.cachedOverlayUpdateArgs = null;

        // Clear debug counts
        host.projectileRenderDebugCounts.clear();

        // Clear cached type IDs
        host.cachedLocIds.clear();
        host.cachedObjIds.clear();
        host.cachedNpcIds.clear();
        host.interactLocModelLoader?.clearCache();
        host.interactNpcModelLoader?.clearCache();
        host.sceneRaycaster?.clearCache();
        host.clearDynamicNpcAnimRuntimeState();

        // Reset camera follow state for next login
        host.followCamFocalInitialized = false;
        host.followCamFocalLastClientCycle = -1;
        host.cameraTerrainPitchPressure = 0;
        host.clearCameraShake();
        host.mapDataLoadedNotified = false;
    
}

export async function cleanUp(host: WebGLOsrsRendererHost, ): Promise<void> {

        cleanUpRenderer(host);
        host.canvas.removeEventListener("touchstart", host.onCanvasTouchStart, true);
        if (isMobileMode && typeof window !== "undefined") {
            window.removeEventListener("resize", host.onMobileLoginViewportChange);
            window.removeEventListener("orientationchange", host.onMobileLoginViewportChange);
            window.visualViewport?.removeEventListener("resize", host.onMobileLoginViewportChange);
            window.visualViewport?.removeEventListener("scroll", host.onMobileLoginViewportChange);
        }
        host.destroyMobileLoginInput();
        host.playerHealthBars.clear();
        try {
            host.overlayManager?.dispose();
            host.hitsplatTickUnsub?.();
            host.hitsplatTickUnsub = undefined;
        } catch {}
        host.overlayManager = undefined;
        host.interactHighlightOverlay = undefined;
        host.healthBarOverlay = undefined;
        host.tileMarkerOverlay = undefined;
        host.playerRenderer.cleanupAppearanceCache();
        host.clearPlayerGeometryRuntimeState();
        host.clearInteractHighlightActiveTarget();
        host.clearInteractHighlightHoverTarget();
        host.interactHighlightDrawTargets.length = 0;
        host.interactLocModelLoader = undefined;
        host.interactNpcModelLoader = undefined;
        host.npcHealthBars.clear();
        host.osrsClient.workerPool.resetLoader(host.dataLoader);

        host.quadArray?.delete();
        host.quadArray = undefined;

        host.quadPositions?.delete();
        host.quadPositions = undefined;

        // Uniforms
        host.osrsClient.clientPlugins.disposeRenderer(host);
        host.sceneUniformBuffer?.delete();
        host.sceneUniformBuffer = undefined;

        // Framebuffers
        host.framebuffer?.delete();
        host.framebuffer = undefined;

        host.colorTarget?.delete();
        host.colorTarget = undefined;

        host.depthTarget?.delete();
        host.depthTarget = undefined;

        host.textureFramebuffer?.delete();
        host.textureFramebuffer = undefined;

        host.textureColorTarget?.delete();
        host.textureColorTarget = undefined;

        host.textureDepthTarget?.delete();
        host.textureDepthTarget = undefined;

        // Textures
        host.textureArray?.delete();
        host.textureArray = undefined;

        host.textureMaterials?.delete();
        host.textureMaterials = undefined;

        host.waterTextures?.delete();
        host.waterTextures = undefined;

        host.drawBackend?.dispose();
        host.drawBackend = undefined;

        for (const texture of host.actorDataTextures) {
            texture?.delete();
        }
        host.actorDataTextures = [undefined, undefined];
        host.actorDataTextureBuffer.length = 0;

        host.clearMaps();
        host.disposeDynamicNpcAnimState();

        if (host.shadersPromise) {
            for (const shader of await host.shadersPromise) {
                shader.delete();
            }
            host.shadersPromise = undefined;
        }
        console.log("Renderer cleaned up");
    
}
