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

export function stepNpcSequenceTrack(host: WebGLOsrsRendererHost, 
        frameIndex: number,
        animTick: number,
        loopCount: number,
        frameCount: number,
        lengths: number[] | undefined,
        seqType: any,
        clearOnFinish: boolean,
    ): {
        frameIndex: number;
        animTick: number;
        loopCount: number;
        frameAdvanced: boolean;
        cleared: boolean;
    } {

        let fi = Math.max(0, frameIndex | 0);
        let tick = Math.max(0, animTick | 0);
        let loops = Math.max(0, loopCount | 0);
        const safeFrameCount = Math.max(1, frameCount | 0);
        let frameAdvanced = false;
        let cleared = false;

        if (fi >= safeFrameCount) {
            fi = 0;
        }

        if (!seqType) {
            const currLen = ((lengths ? lengths[fi] : 0) ?? 0) | 0;
            tick = (tick + 1) | 0;
            if (tick > currLen) {
                tick = 1;
                fi++;
                frameAdvanced = true;
            }
            if (fi >= safeFrameCount) {
                if (clearOnFinish) {
                    cleared = true;
                } else {
                    fi = 0;
                    tick = 0;
                    loops = 0;
                }
            }
            return { frameIndex: fi, animTick: tick, loopCount: loops, frameAdvanced, cleared };
        }

        if (!!seqType?.isSkeletalSeq?.() || (seqType?.skeletalId ?? -1) >= 0) {
            const frameStep = (seqType.frameStep ?? -1) | 0;
            const maxLoops = (seqType.maxLoops ?? 0) | 0;

            fi++;
            tick = 0;
            frameAdvanced = true;

            if (fi >= safeFrameCount) {
                if (frameStep > 0) {
                    fi -= frameStep;
                    if (clearOnFinish) {
                        loops++;
                        cleared = loops >= maxLoops || fi < 0 || fi >= safeFrameCount;
                    } else {
                        const looping = !!seqType.looping;
                        if (looping) loops++;
                        if (fi < 0 || fi >= safeFrameCount || (looping && loops >= maxLoops)) {
                            fi = 0;
                            tick = 0;
                            loops = 0;
                        }
                    }
                } else if (clearOnFinish) {
                    cleared = true;
                } else {
                    fi = 0;
                    tick = 0;
                    loops = 0;
                }
            }

            return { frameIndex: fi, animTick: tick, loopCount: loops, frameAdvanced, cleared };
        }

        const frameStep = (seqType.frameStep ?? -1) | 0;
        const maxLoops = (seqType.maxLoops ?? 0) | 0;
        tick = (tick + 1) | 0;
        const safeFrameIndex = lengths ? Math.min(fi, Math.max(0, lengths.length - 1)) : fi;
        const currLen = ((lengths ? lengths[safeFrameIndex] : 0) ?? 0) | 0;
        if (tick > currLen) {
            tick = 1;
            fi++;
            frameAdvanced = true;
        }

        if (fi >= safeFrameCount) {
            if (frameStep > 0) {
                fi -= frameStep;
                if (clearOnFinish) {
                    loops++;
                    cleared = loops >= maxLoops || fi < 0 || fi >= safeFrameCount;
                } else {
                    const looping = !!seqType.looping;
                    if (looping) loops++;
                    if (fi < 0 || fi >= safeFrameCount || (looping && loops >= maxLoops)) {
                        fi = 0;
                        tick = 0;
                        loops = 0;
                    }
                }
            } else if (clearOnFinish) {
                cleared = true;
            } else {
                fi = 0;
                tick = 0;
                loops = 0;
            }
        }

        return { frameIndex: fi, animTick: tick, loopCount: loops, frameAdvanced, cleared };
    
}

export function ensureNpcDynamicSequenceMeta(host: WebGLOsrsRendererHost, 
        map: WebGLMapSquare,
        npcIndex: number,
        npcTypeId: number,
        seqId: number,
        forceDynamic: boolean = false,
    ): DynamicNpcSequenceMeta | undefined {

        const extraAnims = map.npcExtraAnims?.[npcIndex];
        if (!forceDynamic && extraAnims?.[seqId]) {
            return undefined;
        }

        if (!host.dynamicNpcAnimLoader?.isReady()) {
            return undefined;
        }

        const meta = host.dynamicNpcAnimLoader.getSequenceMeta(npcTypeId, seqId);
        if (!meta) {
            return undefined;
        }

        if (!map.npcExtraFrameLengths) {
            map.npcExtraFrameLengths = [];
        }
        const extraLengths = map.npcExtraFrameLengths[npcIndex] ?? {};
        extraLengths[seqId] = meta.frameLengths;
        map.npcExtraFrameLengths[npcIndex] = extraLengths;

        return meta;
    
}

export function uploadDynamicNpcGeometry(host: WebGLOsrsRendererHost, 
        geometry: DynamicNpcFrameGeometry,
        transparent: boolean,
    ): number {

        if (!host.npcProgram) return 0;

        const vertices = transparent ? geometry.alphaVertices : geometry.opaqueVertices;
        const indices = transparent ? geometry.alphaIndices : geometry.opaqueIndices;
        if (!vertices || !indices || vertices.length === 0 || indices.length === 0) return 0;

        const uploadKey = `${geometry.key}:${transparent ? "alpha" : "opaque"}`;

        const needsRecreate =
            !host.dynamicNpcInterleavedBuffer ||
            vertices.length > (host.dynamicNpcBufferVertexSize ?? 0) ||
            indices.length > (host.dynamicNpcBufferIndexSize ?? 0);

        if (needsRecreate) {
            if (host.dynamicNpcInterleavedBuffer) {
                host.dynamicNpcInterleavedBuffer.delete();
                host.dynamicNpcIndexBuffer?.delete();
                host.dynamicNpcVertexArray?.delete();
                host.dynamicNpcDrawCall = undefined;
            }

            host.dynamicNpcInterleavedBuffer = host.app.createInterleavedBuffer(ACTOR_VERTEX_STRIDE, vertices);
            host.dynamicNpcIndexBuffer = host.app.createIndexBuffer(PicoGL.UNSIGNED_INT, indices);
            host.dynamicNpcBufferVertexSize = vertices.length;
            host.dynamicNpcBufferIndexSize = indices.length;
            host.dynamicNpcUploadedGeometryKey = undefined;

            host.dynamicNpcVertexArray = host.app
                .createVertexArray()
                .vertexAttributeBuffer(0, host.dynamicNpcInterleavedBuffer, {
                    type: PicoGL.UNSIGNED_INT,
                    size: 4,
                    stride: ACTOR_VERTEX_STRIDE,
                    integer: true as any,
                })
                .indexBuffer(host.dynamicNpcIndexBuffer);

            if (host.dynamicNpcVertexArray && host.sceneUniformBuffer) {
                host.dynamicNpcDrawCall = host.configureDrawCall(
                    host.app
                        .createDrawCall(host.npcProgram, host.dynamicNpcVertexArray)
                        .uniformBlock("SceneUniforms", host.sceneUniformBuffer)
                        .drawRanges(host.dynamicNpcSingleDrawRange),
                );
                if (host.textureArray) {
                    host.dynamicNpcDrawCall.texture("u_textures", host.textureArray);
                }
                if (host.textureMaterials) {
                    host.dynamicNpcDrawCall.texture("u_textureMaterials", host.textureMaterials);
                }
                if (host.waterTextures) {
                    host.dynamicNpcDrawCall.texture("u_waterTextures", host.waterTextures);
                }
            }
        }

        if (host.dynamicNpcUploadedGeometryKey !== uploadKey) {
            (host.dynamicNpcInterleavedBuffer as any).data(vertices);
            (host.dynamicNpcIndexBuffer as any).data(indices);
            host.dynamicNpcUploadedGeometryKey = uploadKey;
        }

        return indices.length;
    
}

export function resolveUnbatchedNpcGeometry(
        host: WebGLOsrsRendererHost,
        ecsId: number,
    ): DynamicNpcFrameGeometry | undefined {

        const loader = host.dynamicNpcAnimLoader;
        if (!loader?.isReady()) return undefined;

        const ecs = host.osrsClient.npcEcs;
        const npcTypeId = ecs.getNpcTypeId(ecsId) | 0;
        const actionSeqId = ecs.getSeqId(ecsId) | 0;
        const actionActive = actionSeqId >= 0 && (ecs.getSeqDelay?.(ecsId) | 0) === 0;
        const { movementSeqId, idleSeqId } = host.resolveNpcMovementSequenceIds(ecs, ecsId);
        const renderSeqId = actionActive ? actionSeqId : movementSeqId | 0;
        const overlaySeqId =
            actionActive &&
            host.shouldLayerNpcMovementSequence(
                actionSeqId,
                movementSeqId | 0,
                idleSeqId | 0,
            )
                ? movementSeqId | 0
                : -1;
        const frameId = actionActive
            ? ecs.getFrameIndex(ecsId) | 0
            : ecs.getMovementFrameIndex?.(ecsId) | 0;
        const overlayFrameId =
            overlaySeqId >= 0 ? ecs.getMovementFrameIndex?.(ecsId) | 0 : -1;

        let geometry: DynamicNpcFrameGeometry | undefined;
        try {
            if (renderSeqId >= 0) {
                geometry = loader.getFrameGeometry(
                    npcTypeId,
                    renderSeqId,
                    frameId,
                    overlaySeqId,
                    overlayFrameId,
                    Math.max(0, npcSmoothingCycle(host, ecsId)),
                );
            }
            const hasGraphics =
                !!geometry &&
                ((geometry.opaqueVertices.length > 0 && geometry.opaqueIndices.length > 0) ||
                    (geometry.alphaVertices.length > 0 && geometry.alphaIndices.length > 0));
            if (!hasGraphics) geometry = loader.getBaseGeometry(npcTypeId);
        } catch {
            try {
                geometry = loader.getBaseGeometry(npcTypeId);
            } catch {
                geometry = undefined;
            }
        }
        return geometry;

}

/** NPCs this close to the local player (in tiles) are drawn smoothed when the plugin is on. */
const NPC_SMOOTHING_RADIUS_TILES = 16;

/**
 * Animation smoothing for an NPC: -1 when it is not smoothed (drawn from the map's baked
 * frames), otherwise the cycles into its current frame (0..length) to blend toward the next
 * frame. Smoothed NPCs are drawn through the unbatched (CPU) path, which can blend frames.
 */
export function npcSmoothingCycle(host: WebGLOsrsRendererHost, ecsId: number): number {
    const client = host.osrsClient;
    const plugin = client.animationSmoothingPlugin;
    if (!plugin?.isEnabled() || !host.dynamicNpcAnimLoader?.isReady()) return -1;
    const ecs = client.npcEcs;
    if ((ecs.getWorldViewId(ecsId) | 0) >= 0) return -1;

    const playerIndex = client.playerEcs.getIndexForServerId(client.controlledPlayerServerId | 0);
    if (playerIndex === undefined) return -1;
    const radius = NPC_SMOOTHING_RADIUS_TILES * 128;
    const dx = (ecs.getWorldX(ecsId) | 0) - (client.playerEcs.getX(playerIndex) | 0);
    const dy = (ecs.getWorldY(ecsId) | 0) - (client.playerEcs.getY(playerIndex) | 0);
    if (Math.abs(dx) > radius || Math.abs(dy) > radius) return -1;

    const actionSeqId = ecs.getSeqId(ecsId) | 0;
    const action = actionSeqId >= 0 && (ecs.getSeqDelay?.(ecsId) | 0) === 0;
    const { movementSeqId, idleSeqId } = host.resolveNpcMovementSequenceIds(ecs, ecsId);
    const seqId = action ? actionSeqId : movementSeqId | 0;
    if (seqId < 0) return -1;
    // An action layered over movement is not blended (as in RuneLite).
    const layered =
        action &&
        host.shouldLayerNpcMovementSequence(actionSeqId, movementSeqId | 0, idleSeqId | 0);
    if (layered) return -1;
    if (!plugin.smoothsNpc(ecs.getNpcTypeId(ecsId) | 0, seqId, action)) return -1;
    const seqType: any = client.seqTypeLoader.load(seqId);
    if (!seqType || seqType.isSkeletalSeq?.() || !(seqType.frameIds?.length > 1)) return -1;
    const cycle = action ? ecs.getAnimTick(ecsId) : ecs.getMovementAnimTick(ecsId);
    return Math.max(0, cycle | 0);
}
