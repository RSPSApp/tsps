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

export function _resolveNpcAnimation(host: WebGLOsrsRendererHost, 
        map: WebGLMapSquare,
        npcIndex: number,
        ecs: NpcEcs,
        ecsId: number,
    ): AnimationFrames {

        const extraAnimMap = map.npcExtraAnims?.[npcIndex];
        const seqId = ecs.getSeqId(ecsId) | 0;
        const seqDelay = ecs.getSeqDelay?.(ecsId) | 0;
        if (seqId >= 0 && seqDelay === 0) {
            const extraAnim = extraAnimMap?.[seqId];
            if (extraAnim) {
                return extraAnim;
            }
        }
        const movementSeqId = host.resolveNpcMovementSequenceIds(ecs, ecsId).movementSeqId | 0;
        if (movementSeqId >= 0) {
            const extraMovementAnim = extraAnimMap?.[movementSeqId];
            if (extraMovementAnim) {
                return extraMovementAnim;
            }
        }
        const useWalk = ecs.isWalking(ecsId);
        return ((useWalk ? map.npcWalkFrames[npcIndex] : undefined) ??
            map.npcIdleFrames[npcIndex]) as AnimationFrames;
    
}

export function resolveNpcMovementSequenceIds(host: WebGLOsrsRendererHost, 
        ecs: NpcEcs,
        ecsId: number,
    ): { movementSeqId: number; idleSeqId: number; walkSeqId: number } {

        let movementSeqId = -1;
        let idleSeqId = -1;
        let walkSeqId = -1;
        const npcTypeId = ecs.getNpcTypeId?.(ecsId);
        if (typeof npcTypeId !== "number" || npcTypeId < 0) {
            return { movementSeqId, idleSeqId, walkSeqId };
        }

        try {
            const npcType = host.osrsClient.npcTypeLoader.load(npcTypeId | 0);
            if (!npcType) {
                return { movementSeqId, idleSeqId, walkSeqId };
            }

            const movementSet = Object.assign(npcType.getMovementSeqSet(host.osrsClient.basTypeLoader), ecs.getMovementOverrides(ecsId));
            idleSeqId = movementSet.idle | 0;
            walkSeqId = movementSet.walk | 0;
            const pathLength = ecs.getPathLengthLike?.(ecsId) | 0;
            if (pathLength <= 0) {
                movementSeqId = idleSeqId;
                // Turn-in-place: while still rotating toward the target
                // orientation, play the idle-rotate sequence (walk fallback).
                const rot = ecs.getRotation(ecsId) | 0;
                const targetRot = ecs.getTargetRot(ecsId) | 0;
                const delta = (targetRot - rot) & 2047;
                if (delta !== 0) {
                    const rotSpeed = ecs.getRotationSpeed(ecsId) | 0;
                    const stillTurning =
                        rotSpeed > 0 && delta >= rotSpeed && delta <= 2048 - rotSpeed;
                    if (stillTurning) {
                        const turnSeq =
                            delta > 1024 ? movementSet.turnLeft | 0 : movementSet.turnRight | 0;
                        const resolved = turnSeq >= 0 ? turnSeq : walkSeqId;
                        if (resolved >= 0) movementSeqId = resolved;
                    }
                }
                return { movementSeqId, idleSeqId, walkSeqId };
            }

            const movementOrientation = ecs.getCurrentStepRot(ecsId);
            if (movementOrientation === undefined) {
                movementSeqId = walkSeqId >= 0 ? walkSeqId : idleSeqId;
                return { movementSeqId, idleSeqId, walkSeqId };
            }

            let yaw = ((movementOrientation | 0) - (ecs.getRotation(ecsId) | 0)) & 2047;
            if (yaw > 1024) yaw -= 2048;

            let nextSeq = movementSet.walkBack | 0;
            if (yaw >= -256 && yaw <= 256) nextSeq = movementSet.walk | 0;
            else if (yaw >= 256 && yaw < 768) nextSeq = movementSet.walkRight | 0;
            else if (yaw >= -768 && yaw <= -256) nextSeq = movementSet.walkLeft | 0;
            if (nextSeq === -1) {
                nextSeq = movementSet.walk | 0;
            }

            let speed = 4;
            if (!!npcType.isClipped) {
                if (
                    (movementOrientation | 0) !== (ecs.getRotation(ecsId) | 0) &&
                    (ecs.getInteractionIndex?.(ecsId) | 0) < 0 &&
                    (ecs.getRotationSpeed(ecsId) | 0) !== 0
                ) {
                    speed = 2;
                }
                if (pathLength > 2) speed = 6;
                if (pathLength > 3) speed = 8;
                if ((ecs.getMovementDelayCounter?.(ecsId) | 0) > 0 && pathLength > 1) {
                    speed = 8;
                }
            } else {
                if (pathLength > 1) speed = 6;
                if (pathLength > 2) speed = 8;
                if ((ecs.getMovementDelayCounter?.(ecsId) | 0) > 0 && pathLength > 1) {
                    speed = 8;
                }
            }

            const rawTraversal = ecs.getCurrentStepSpeed(ecsId) | 0;
            if (rawTraversal >= 8) speed <<= 1;
            else if (rawTraversal <= 2) speed >>= 1;

            if (speed >= 8) {
                if (nextSeq === (movementSet.walk | 0) && (movementSet.run | 0) !== -1) {
                    nextSeq = movementSet.run | 0;
                } else if (
                    nextSeq === (movementSet.walkBack | 0) &&
                    (movementSet.runBack | 0) !== -1
                ) {
                    nextSeq = movementSet.runBack | 0;
                } else if (
                    nextSeq === (movementSet.walkLeft | 0) &&
                    (movementSet.runLeft | 0) !== -1
                ) {
                    nextSeq = movementSet.runLeft | 0;
                } else if (
                    nextSeq === (movementSet.walkRight | 0) &&
                    (movementSet.runRight | 0) !== -1
                ) {
                    nextSeq = movementSet.runRight | 0;
                }
            } else if (speed <= 2) {
                if (nextSeq === (movementSet.walk | 0) && (movementSet.crawl | 0) !== -1) {
                    nextSeq = movementSet.crawl | 0;
                } else if (
                    nextSeq === (movementSet.walkBack | 0) &&
                    (movementSet.crawlBack | 0) !== -1
                ) {
                    nextSeq = movementSet.crawlBack | 0;
                } else if (
                    nextSeq === (movementSet.walkLeft | 0) &&
                    (movementSet.crawlLeft | 0) !== -1
                ) {
                    nextSeq = movementSet.crawlLeft | 0;
                } else if (
                    nextSeq === (movementSet.walkRight | 0) &&
                    (movementSet.crawlRight | 0) !== -1
                ) {
                    nextSeq = movementSet.crawlRight | 0;
                }
            }

            movementSeqId = nextSeq | 0;
            if (movementSeqId < 0) {
                movementSeqId = walkSeqId >= 0 ? walkSeqId : idleSeqId;
            }
        } catch {}

        return { movementSeqId, idleSeqId, walkSeqId };
    
}

export function shouldLayerNpcMovementSequence(host: WebGLOsrsRendererHost, 
        actionSeqId: number,
        movementSeqId: number,
        idleSeqId: number,
    ): boolean {

        if (
            (actionSeqId | 0) < 0 ||
            (movementSeqId | 0) < 0 ||
            (movementSeqId | 0) === (idleSeqId | 0)
        ) {
            return false;
        }

        try {
            const seqType = host.osrsClient.seqTypeLoader.load(actionSeqId | 0) as any;
            if (seqType?.isSkeletalSeq?.()) {
                return Array.isArray(seqType.skeletalMasks);
            }
            return Array.isArray(seqType?.masks) && seqType.masks.length > 0;
        } catch {
            return false;
        }
    
}
