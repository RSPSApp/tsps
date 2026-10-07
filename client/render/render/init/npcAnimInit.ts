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

import { ACTOR_VERTEX_STRIDE } from "../../buffer/ActorNormals";
import {
    getClientCycle,
    getCurrentTick,
    getServerTickPhaseNow,
    isServerConnected,
    sendEmote,
    sendInteractFollow,
    sendInteractStop,
    subscribeTick,
} from "../../../network/ServerConnection";
import { sendLogin } from "../../../network/ServerConnection";
import { flushPackets } from "../../../network/packet";
import { createTextureArray } from "../../../picogl/PicoTexture";
import { RS_TO_RADIANS } from "../../../rs/MathConstants";
import { CollisionFlag } from "../../../common/CollisionFlag";
import {
    getWorldLocChanges,
    getWorldLocSpawns,
    getWorldTerrainOverrides,
} from "../../../common/gamemode/GamemodeContentStore";
import { OsrsMenuEntry } from "../../../rs/MenuEntry";
import { MenuTargetType } from "../../../rs/MenuEntry";
import type { OverlayFloorType } from "../../../rs/config/floortype/OverlayFloorType";
import { LocModelLoader } from "../../../rs/config/loctype/LocModelLoader";
import { LocModelType } from "../../../rs/config/loctype/LocModelType";
import { NpcModelLoader } from "../../../rs/config/npctype/NpcModelLoader";
import { NpcDrawPriority, NpcType } from "../../../rs/config/npctype/NpcType";
import { PlayerAppearance } from "../../../rs/config/player/PlayerAppearance";
import { PlayerModelLoader } from "../../../rs/config/player/PlayerModelLoader";
import { decodeInteractionIndex } from "../../../rs/interaction/InteractionIndex";
import { getMapIndexFromTile, getMapPlaneId, getMapSquareId } from "../../../rs/map/MapFileIndex";
import { Model } from "../../../rs/model/Model";
import { ModelData } from "../../../rs/model/ModelData";
import { Scene } from "../../../rs/scene/Scene";
import { getUiScale } from "../../../ui/UiScale";
import { ClickCrossOverlay } from "../../../ui/devoverlay/ClickCrossOverlay";
import { GroundItemOverlay } from "../../../ui/devoverlay/GroundItemOverlay";
import { HealthBarOverlay } from "../../../ui/devoverlay/HealthBarOverlay";
import { HitsplatOverlay } from "../../../ui/devoverlay/HitsplatOverlay";
import {
    InteractHighlightDrawTarget,
    InteractHighlightOverlay,
} from "../../../ui/devoverlay/InteractHighlightOverlay";
import { LoadingMessageOverlay } from "../../../ui/devoverlay/LoadingMessageOverlay";
import { LoginOverlay } from "../../../ui/devoverlay/LoginOverlay";
import { OverheadPrayerOverlay } from "../../../ui/devoverlay/OverheadPrayerOverlay";
import { OverheadTextOverlay } from "../../../ui/devoverlay/OverheadTextOverlay";
import {
    HealthBarEntry,
    HitsplatEntry,
    OverheadPrayerEntry,
    OverheadTextEntry,
    type OverlayUpdateArgs,
    RenderPhase,
} from "../../../ui/devoverlay/Overlay";
import { OverlayManager } from "../../../ui/devoverlay/OverlayManager";
import type { TileMarkerOverlay } from "../../../ui/devoverlay/TileMarkerOverlay";
import { TileTextOverlay } from "../../../ui/devoverlay/TileTextOverlay";
import { WidgetsOverlay } from "../../../ui/devoverlay/WidgetsOverlay";
import { MENU_ACTION_DEPRIORITIZE_OFFSET, MenuAction, menuAction } from "../../../ui/menu/MenuAction";
import { worldEntriesToSimple } from "../../../ui/menu/MenuBridge";
import type { MenuClickContext, SimpleMenuEntry } from "../../../ui/menu/MenuEngine";
import { chooseDefaultMenuEntry, shouldLeftClickOpenMenu } from "../../../ui/menu/MenuEngine";
import { MenuOpcode } from "../../../ui/menu/MenuState";
import { Model2DRenderer } from "../../../ui/model/Model2DRenderer";
import {
    canTargetGroundItem,
    canTargetNpc,
    canTargetObject,
    canTargetPlayer,
} from "../../../widgets/WidgetFlags";
import { WidgetLoader } from "../../../widgets/WidgetLoader";
import { WidgetManager } from "../../../widgets/WidgetManager";
import { layoutWidgets } from "../../../widgets/layout/WidgetLayout";
import { collectWidgetsAtPoint } from "../../../widgets/menu/utils";
import {
    getCanvasCssSize,
    isIos,
    isMobileMode,
    isTouchDevice,
    isWebGL2Supported,
} from "../../../common/utils/DeviceUtil";
import { clamp } from "../../../common/utils/MathUtil";
import { ClientState } from "../../../game/ClientState";
import { GameRenderer } from "../../../game/GameRenderer";
import type { HitsplatEventPayload } from "../../../game/GameRenderer";
import { OsrsRendererType, WEBGL } from "../../../game/GameRenderers";
import { ClickMode, getMousePos } from "../../../game/InputManager";
import { OsrsClient } from "../../../game/OsrsClient";
import { ActorAnimationClip } from "../../../game/actor/ActorAnimation";
import {
    ActorHealthBarsState,
    ActorHitsplatState,
    HealthBarBarState,
    HealthBarDefinitionState,
    HealthBarUpdateState,
    MAX_HITSPLAT_SLOTS,
    createActorHealthBarsState,
    createActorHitsplatState,
} from "../../../game/actor/ActorOverlayState";
import type { ClientGroundItemStack, GroundItemOverlayEntry } from "../../../game/data/ground/GroundItemStore";
import { NpcEcs } from "../../../game/ecs/NpcEcs";
import type { PlayerAnimKey } from "../../../game/ecs/PlayerEcs";
import { GameState, LoginIndex } from "../../../game/login";
import { Ray, rayIntersectsBox } from "../../../game/math/Raycast";
import { isMouseInUIRegion as checkMouseInUIRegion } from "../../../game/menu/WorldMenuBuilder";
import {
    advanceAnimation,
    computeMovementOrientation,
    computeMovementStep,
    interpolateRotation,
    parseInteractionTarget,
} from "../../../game/movement/NpcClientTick";
import type { TileMarkersPluginConfig } from "../../../game/plugins/tilemarkers/types";
import { computeRoofPlaneLimit } from "../../../game/roof/RoofVisibility";
import { sampleBridgeHeightForWorldTile } from "../../../game/scene/BridgeHeightSampler";
import {
    BridgePlaneStrategy,
    resolveBridgePromotedPlane,
    resolveCollisionSamplePlaneForLocal,
    resolveCollisionSamplePlaneForWorldTile,
    resolveGroundItemStackPlane,
    resolveHeightSamplePlaneForLocal,
    resolveInteractionPlaneForLocal,
    resolveInteractionPlaneForWorldTile,
} from "../../../game/scene/PlaneResolver";
import { SceneRaycastHit, SceneRaycaster } from "../../../game/scene/SceneRaycaster";
import {
    TILE_FLAG_BRIDGE,
    getTileRenderFlagAt as lookupTileRenderFlagAt,
} from "../../../game/scene/TileRenderFlags";
import { LoadingRequirement } from "../../../game/state/LoadingTracker";
import type { PlayerSpotAnimationEvent } from "../../../game/sync/PlayerSyncTypes";
import { RAD_TO_RS_UNITS, computeFacingRotation } from "../../../game/utils/rotation";
import { AnimationFrames } from "../../AnimationFrames";
import { ChatheadFactory } from "../../ChatheadFactory";
import { type DrawBackend, createDrawBackend } from "../../DrawBackend";
import { DrawRange, NULL_DRAW_RANGE, newDrawRange } from "../../DrawRange";
import { InteractType } from "../../InteractType";
import { profiler } from "../../PerformanceProfiler";
import { PlayerChatheadFactory } from "../../PlayerChatheadFactory";
import { resolveFogRange } from "../../RenderDistancePolicy";
import { WebGLMapSquare } from "../../WebGLMapSquare";
import { WorldEntityAnimator } from "../../WorldEntityAnimator";
import { SceneBuffer } from "../../buffer/SceneBuffer";
import { getModelFaces, isModelFaceTransparent } from "../../buffer/SceneBuffer";
import { GfxManager } from "../../gfx/GfxManager";
import { GfxRenderer } from "../../gfx/GfxRenderer";
import { buildGroundItemGeometry } from "../../ground/GroundItemMeshBuilder";
import { type MinimapIcon, SdMapData } from "../../loader/SdMapData";
import { SdMapDataLoader } from "../../loader/SdMapDataLoader";
import { SdMapLoaderInput } from "../../loader/SdMapLoaderInput";
import { isDoorLocType } from "../../loc/SceneLocs";
import {
    DynamicNpcAnimLoader,
    DynamicNpcFrameGeometry,
    DynamicNpcSequenceMeta,
} from "../../npc/DynamicNpcAnimLoader";
import { PlayerRenderer } from "../../player/PlayerRenderer";
import { ProjectileManager } from "../../projectiles/ProjectileManager";
import { ProjectileRenderer } from "../../projectiles/ProjectileRenderer";
import {
    FRAME_FXAA_PROGRAM,
    FRAME_PROGRAM,
    createMainProgram,
    createNpcProgram,
    createPlayerProgram,
    createProjectileProgram,
} from "../../shaders/Shaders";
import { KNOWN_WATER_TEXTURE_IDS } from "../../water/WaterTextureIds";
import type { WebGLOsrsRendererHost } from "../hostInterface";
import { RENDER_CONSTANTS } from "../constants";

export function clearDynamicNpcAnimRuntimeState(host: WebGLOsrsRendererHost, ): void {

        host.dynamicNpcAnimLoader?.clear();
        host.dynamicNpcDrawCall = undefined;
        host.dynamicNpcVertexArray?.delete();
        host.dynamicNpcVertexArray = undefined;
        host.dynamicNpcInterleavedBuffer?.delete();
        host.dynamicNpcInterleavedBuffer = undefined;
        host.dynamicNpcIndexBuffer?.delete();
        host.dynamicNpcIndexBuffer = undefined;
        host.dynamicNpcBufferVertexSize = 0;
        host.dynamicNpcBufferIndexSize = 0;
        host.dynamicNpcUploadedGeometryKey = undefined;
    
}

export function disposeDynamicNpcAnimState(host: WebGLOsrsRendererHost, ): void {

        host.clearDynamicNpcAnimRuntimeState();
        host.dynamicNpcAnimLoader = undefined;
    
}

export function clearPlayerGeometryRuntimeState(host: WebGLOsrsRendererHost): void {
        host.playerDrawCall = undefined;
        host.playerDrawCallAlpha = undefined;
        host.playerPoseTexture?.delete();
        host.playerPoseTexture = undefined;
        host.playerDrawRanges = undefined;
        host.playerDrawRangesAlpha = undefined;
        host.playerVertexArray?.delete();
        host.playerVertexArray = undefined;
        host.playerVertexArrayAlpha?.delete();
        host.playerVertexArrayAlpha = undefined;
        host.playerInterleavedBuffer?.delete();
        host.playerInterleavedBuffer = undefined;
        host.playerIndexBuffer?.delete();
        host.playerIndexBuffer = undefined;
        host.playerInterleavedBufferAlpha?.delete();
        host.playerInterleavedBufferAlpha = undefined;
        host.playerIndexBufferAlpha?.delete();
        host.playerIndexBufferAlpha = undefined;
        host.playerSlotBuffer?.delete();
        host.playerSlotBuffer = undefined;
}

export function initDynamicNpcAnimLoader(host: WebGLOsrsRendererHost, ): void {

        host.disposeDynamicNpcAnimState();
        try {
            host.dynamicNpcAnimLoader = new DynamicNpcAnimLoader(
                host.osrsClient.npcTypeLoader,
                host.osrsClient.modelLoader,
                host.osrsClient.textureLoader,
                host.osrsClient.seqTypeLoader,
                host.osrsClient.seqFrameLoader,
                host.osrsClient.skeletalSeqLoader,
                host.osrsClient.varManager,
            );
            host.dynamicNpcAnimLoader.setTextureIdIndexMap(host.textureIdIndexMap);
        } catch (e) {
            console.warn("Failed to init dynamic NPC animation loader", e);
        }
    
}

export async function initPlayerGeometry(host: WebGLOsrsRendererHost, ): Promise<void> {

        if (!host.playerProgram || !host.textureArray || !host.textureMaterials) {
            await host.shadersPromise;
        }
        if (!host.playerProgram || !host.textureArray || !host.textureMaterials) {
            return;
        }
        clearPlayerGeometryRuntimeState(host);
        // Prepare empty dynamic GPU resources for player rendering. Base-model building is
        // handled in PlayerEcs and PlayerRenderer uploads per-frame geometry.
        const interleavedBuffer = host.app.createInterleavedBuffer(ACTOR_VERTEX_STRIDE, new Int32Array(0));
        const indexBuffer = host.app.createIndexBuffer(PicoGL.UNSIGNED_INT, new Int32Array(0));
        // 255 labels x 3 texels per row, a row per GPU-animated batch. PicoGL binds every sampler
        // a program declares, so each player draw call binds this one.
        const poseTexture = host.app.createTexture2D(255 * 3, 256, {
            internalFormat: PicoGL.RGBA32F,
            minFilter: PicoGL.NEAREST,
            magFilter: PicoGL.NEAREST,
            wrapS: PicoGL.CLAMP_TO_EDGE,
            wrapT: PicoGL.CLAMP_TO_EDGE,
        });
        host.playerPoseTexture = poseTexture;
        const playerSlotBuffer = host.app.createVertexBuffer(
            PicoGL.INT,
            1,
            new Int32Array(2048),
            PicoGL.DYNAMIC_DRAW,
        );
        const vertexArray = host.app
            .createVertexArray()
            .vertexAttributeBuffer(0, interleavedBuffer, {
                type: PicoGL.UNSIGNED_INT,
                size: 4,
                stride: ACTOR_VERTEX_STRIDE,
                integer: true as any,
            })
            .instanceAttributeBuffer(1, playerSlotBuffer, {
                type: PicoGL.INT,
                size: 1,
                integer: true as any,
            })
            .indexBuffer(indexBuffer);

        const drawCall = host.app
            .createDrawCall(host.playerProgramOpaque ?? host.playerProgram!, vertexArray)
            .uniformBlock("SceneUniforms", host.sceneUniformBuffer!)
            .uniform("u_timeLoaded", -1.0)
            .uniform("u_usePlayerSlotAttribute", false)
            .texture("u_textures", host.textureArray!)
            .texture("u_textureMaterials", host.textureMaterials!)
            .texture("u_poseTexture", poseTexture);

        // Transparent path: keep separate buffers (initially empty)
        const interleavedBufferAlpha = host.app.createInterleavedBuffer(ACTOR_VERTEX_STRIDE, new Int32Array(0));
        const indexBufferAlpha = host.app.createIndexBuffer(PicoGL.UNSIGNED_INT, new Int32Array(0));
        const vertexArrayAlpha = host.app
            .createVertexArray()
            .vertexAttributeBuffer(0, interleavedBufferAlpha, {
                type: PicoGL.UNSIGNED_INT,
                size: 4,
                stride: ACTOR_VERTEX_STRIDE,
                integer: true as any,
            })
            .instanceAttributeBuffer(1, playerSlotBuffer, {
                type: PicoGL.INT,
                size: 1,
                integer: true as any,
            })
            .indexBuffer(indexBufferAlpha);
        const drawCallAlpha = host.app
            .createDrawCall(host.playerProgram!, vertexArrayAlpha)
            .uniformBlock("SceneUniforms", host.sceneUniformBuffer!)
            .uniform("u_timeLoaded", -1.0)
            .uniform("u_usePlayerSlotAttribute", false)
            .texture("u_textures", host.textureArray!)
            .texture("u_textureMaterials", host.textureMaterials!)
            .texture("u_poseTexture", poseTexture);

        host.playerVertexArray = vertexArray;
        host.playerInterleavedBuffer = interleavedBuffer as any;
        host.playerIndexBuffer = indexBuffer as any;
        host.playerInterleavedBufferAlpha = interleavedBufferAlpha as any;
        host.playerIndexBufferAlpha = indexBufferAlpha as any;
        host.playerSlotBuffer = playerSlotBuffer as any;
        host.playerVertexArrayAlpha = vertexArrayAlpha;
        host.playerDrawCall = drawCall;
        host.playerDrawCallAlpha = drawCallAlpha;
        host.playerDrawRanges = [newDrawRange(0, 0, 1)];
        host.playerDrawRangesAlpha = [newDrawRange(0, 0, 1)];
    
}
