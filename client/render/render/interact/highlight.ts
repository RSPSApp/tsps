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
import { RENDER_CONSTANTS, InteractHighlightTarget, LocHighlightTarget } from "../constants";
import {
    buildItemModelHighlightTriangles,
    isItemHighlightTargetStillPresent,
} from "./highlightItem";

export function getInteractHighlightDrawTargets(host: WebGLOsrsRendererHost, ): ReadonlyArray<InteractHighlightDrawTarget> {

        const out = host.interactHighlightDrawTargets;
        out.length = 0;

        const config = host.osrsClient.clientPlugins.interactHighlightConfig();
        if (!config?.enabled) return out;

        host.syncInteractHighlightActiveTargetFromLocalInteraction();
        host.maybeExpireInteractHighlightTarget();

        const getWeTransform = (target: InteractHighlightTarget): Float32Array | undefined => {
            if (target.kind === "npc") {
                const wvId = host.osrsClient.npcEcs.getWorldViewId?.(target.ecsId) ?? -1;
                if (wvId >= 0) return host.worldEntityAnimator?.getTransform(wvId);
            }
            if (target.kind === "loc" && !target.overworldProxy) {
                const map = host.getPreferredMapForWorldTile(target.tileX, target.tileY);
                if (map && host.mapManager.worldEntityMapIds.has(map.id)) {
                    const weIdx = host.getWorldEntityIndexForMapId(map.id);
                    if (weIdx !== undefined) return host.worldEntityAnimator?.getTransform(weIdx);
                }
            }
            return undefined;
        };

        // Items have their own switches and colours (RuneLite's Items section).
        const showInteract = (target: InteractHighlightTarget | undefined): boolean =>
            !!target && (target.kind === "item" ? config.itemShowInteract : config.showInteract);
        const showHover = (target: InteractHighlightTarget | undefined): boolean =>
            !!target && (target.kind === "item" ? config.itemShowHover : config.showHover);

        if (showInteract(host.interactHighlightActiveTarget) && host.interactHighlightActiveTarget) {
            const trianglePoints = host.buildHighlightTrianglePoints(
                host.interactHighlightActiveTarget,
            );
            if (trianglePoints && trianglePoints.length >= 3) {
                out.push({
                    trianglePoints,
                    color:
                        host.interactHighlightActiveTarget.kind === "item"
                            ? config.itemInteractColor
                            : config.interactColor,
                    alpha: 0.45,
                    worldEntityTransform: getWeTransform(host.interactHighlightActiveTarget),
                });
            }
        }

        if (showHover(host.interactHighlightHoverTarget) && host.interactHighlightHoverTarget) {
            const showingActive =
                showInteract(host.interactHighlightActiveTarget) &&
                host.isSameInteractHighlightTarget(
                    host.interactHighlightHoverTarget,
                    host.interactHighlightActiveTarget,
                );
            if (!showingActive) {
                const trianglePoints = host.buildHighlightTrianglePoints(
                    host.interactHighlightHoverTarget,
                );
                if (trianglePoints && trianglePoints.length >= 3) {
                    out.push({
                        trianglePoints,
                        color:
                            host.interactHighlightHoverTarget.kind === "item"
                                ? config.itemHoverColor
                                : config.hoverColor,
                        alpha: 0.45,
                        worldEntityTransform: getWeTransform(host.interactHighlightHoverTarget),
                    });
                }
            }
        }

        return out;
    
}

export function syncInteractHighlightActiveTargetFromLocalInteraction(host: WebGLOsrsRendererHost, ): void {

        const interactionTarget = host.resolveInteractHighlightTargetFromLocalInteraction();
        if (interactionTarget) {
            if (
                !host.isSameInteractHighlightTarget(
                    interactionTarget,
                    host.interactHighlightActiveTarget,
                )
            ) {
                host.interactHighlightActiveTarget = interactionTarget;
            }
            host.interactHighlightClickTick = -1;
            host.interactHighlightActiveFromInteraction = true;
            return;
        }

        if (host.interactHighlightActiveFromInteraction) {
            host.clearInteractHighlightActiveTarget();
        }
    
}

export function resolveInteractHighlightTargetFromLocalInteraction(host: WebGLOsrsRendererHost, ):
        | InteractHighlightTarget
        | undefined {

        const controlledServerId = host.osrsClient.controlledPlayerServerId | 0;
        if (controlledServerId < 0) return undefined;

        const playerEcs = host.osrsClient.playerEcs;
        const controlledEcsId = playerEcs.getIndexForServerId(controlledServerId);
        if (controlledEcsId === undefined) return undefined;

        const interactionIndex = playerEcs.getInteractionIndex(controlledEcsId) | 0;
        if (interactionIndex < 0) return undefined;

        const decoded = decodeInteractionIndex(interactionIndex);
        if (!decoded) return undefined;
        if (decoded.type !== "npc") return undefined;

        return host.resolveNpcHighlightTargetFromServerId(decoded.id | 0);
    
}

export function maybeExpireInteractHighlightTarget(host: WebGLOsrsRendererHost, ): void {

        if (!host.interactHighlightActiveTarget) return;
        if (host.interactHighlightActiveTarget.kind === "loc") {
            if (!host.isLocHighlightTargetStillPresent(host.interactHighlightActiveTarget)) {
                host.clearInteractHighlightActiveTarget();
                return;
            }
        }
        if (host.interactHighlightActiveTarget.kind === "item") {
            if (!isItemHighlightTargetStillPresent(host, host.interactHighlightActiveTarget)) {
                host.clearInteractHighlightActiveTarget();
                return;
            }
        }
        if (host.interactHighlightActiveFromInteraction) return;
        const clickTick = host.interactHighlightClickTick | 0;
        if (clickTick < 0) return;
        if (!host.hasActiveDestinationMarker() && (getCurrentTick() | 0) > clickTick) {
            host.clearInteractHighlightActiveTarget();
        }
    
}

export function isLocHighlightTargetStillPresent(host: WebGLOsrsRendererHost, target: LocHighlightTarget): boolean {

        // Clear highlight if the player changed planes (e.g. climbing stairs)
        if ((host.getPlayerBasePlane() | 0) !== (target.plane | 0)) {
            return false;
        }
        const typeRot = host.resolveLocTypeRotAtTile(
            target.locId | 0,
            target.tileX | 0,
            target.tileY | 0,
            target.plane | 0,
        );
        if (typeof typeRot !== "number") {
            return false;
        }
        target.locModelType = (typeRot & 0x3f) | 0;
        target.locRotation = ((typeRot >> 6) & 0x3) | 0;
        return true;
    
}

export function hasActiveDestinationMarker(host: WebGLOsrsRendererHost, ): boolean {

        return (ClientState.destinationX | 0) !== 0 || (ClientState.destinationY | 0) !== 0;
    
}

export function isSameInteractHighlightTarget(host: WebGLOsrsRendererHost, 
        a: InteractHighlightTarget | undefined,
        b: InteractHighlightTarget | undefined,
    ): boolean {

        if (!a || !b) return false;
        if (a.kind !== b.kind) return false;
        if (a.kind === "loc" && b.kind === "loc") {
            return (
                (a.locId | 0) === (b.locId | 0) &&
                (a.tileX | 0) === (b.tileX | 0) &&
                (a.tileY | 0) === (b.tileY | 0) &&
                (a.plane | 0) === (b.plane | 0)
            );
        }
        if (a.kind === "npc" && b.kind === "npc") {
            return (a.serverId | 0) === (b.serverId | 0);
        }
        if (a.kind === "item" && b.kind === "item") {
            return (
                (a.itemId | 0) === (b.itemId | 0) &&
                (a.tileX | 0) === (b.tileX | 0) &&
                (a.tileY | 0) === (b.tileY | 0) &&
                (a.plane | 0) === (b.plane | 0)
            );
        }
        return false;
    
}

export function buildHighlightTrianglePoints(host: WebGLOsrsRendererHost, 
        target: InteractHighlightTarget,
    ): ReadonlyArray<readonly [number, number, number]> | undefined {

        if (target.kind === "loc") {
            return host.buildLocModelHighlightTriangles(target);
        }
        if (target.kind === "item") {
            return buildItemModelHighlightTriangles(host, target);
        }
        return host.buildNpcModelHighlightTriangles(target);
    
}

export function getInteractLocModelLoader(host: WebGLOsrsRendererHost, ): LocModelLoader | undefined {

        if (host.interactLocModelLoader) {
            return host.interactLocModelLoader;
        }
        const textureLoader = host.osrsClient.textureLoader;
        const modelLoader = host.osrsClient.modelLoader;
        const locTypeLoader = host.osrsClient.locTypeLoader;
        const seqTypeLoader = host.osrsClient.seqTypeLoader;
        const seqFrameLoader = host.osrsClient.seqFrameLoader;
        if (!textureLoader || !modelLoader || !locTypeLoader || !seqTypeLoader || !seqFrameLoader) {
            return undefined;
        }
        host.interactLocModelLoader = new LocModelLoader(
            locTypeLoader,
            modelLoader,
            textureLoader,
            seqTypeLoader,
            seqFrameLoader,
            host.osrsClient.skeletalSeqLoader,
        );
        return host.interactLocModelLoader;
    
}

export function getInteractNpcModelLoader(host: WebGLOsrsRendererHost, ): NpcModelLoader | undefined {

        if (host.interactNpcModelLoader) {
            return host.interactNpcModelLoader;
        }
        const textureLoader = host.osrsClient.textureLoader;
        const modelLoader = host.osrsClient.modelLoader;
        const npcTypeLoader = host.osrsClient.npcTypeLoader;
        const seqTypeLoader = host.osrsClient.seqTypeLoader;
        const seqFrameLoader = host.osrsClient.seqFrameLoader;
        if (!textureLoader || !modelLoader || !npcTypeLoader || !seqTypeLoader || !seqFrameLoader) {
            return undefined;
        }
        host.interactNpcModelLoader = new NpcModelLoader(
            npcTypeLoader,
            modelLoader,
            textureLoader,
            seqTypeLoader,
            seqFrameLoader,
            host.osrsClient.skeletalSeqLoader,
            host.osrsClient.varManager,
        );
        return host.interactNpcModelLoader;
    
}

export function hasNoVisibleFaces(host: WebGLOsrsRendererHost, model: Model): boolean {

        if (!model.faceAlphas) return false;
        for (let i = 0; i < model.faceAlphas.length; i++) {
            if ((model.faceAlphas[i] & 0xff) < 254) return false;
        }
        return true;
    
}

export function findVisualProxyModel(host: WebGLOsrsRendererHost, 
        locModelLoader: LocModelLoader,
        target: LocHighlightTarget,
        modelType: number,
        modelRotation: number,
    ): Model | undefined {

        for (let mi = 0; mi < host.mapManager.visibleMapCount; mi++) {
            const map = host.mapManager.visibleMaps[mi];
            if (!map) continue;
            const local = host.getMapLocalTile(map, target.tileX, target.tileY);
            if (!local) continue;
            const rsX = (local.x * 128 + 64) | 0;
            const rsY = (local.y * 128 + 64) | 0;
            for (const anim of map.locsAnimated) {
                if (anim.id === (target.locId | 0)) continue;
                if (anim.x !== rsX || anim.y !== rsY) continue;
                const proxyType = host.osrsClient.locTypeLoader.load(anim.id);
                if (!proxyType) continue;
                const proxyModel =
                    locModelLoader.getModelAnimated(
                        proxyType,
                        LocModelType.NORMAL,
                        anim.rotation ?? 0,
                        anim.seqType?.id ?? -1,
                        anim.frame | 0,
                    ) ??
                    locModelLoader.getModelAnimated(
                        proxyType,
                        modelType as LocModelType,
                        modelRotation,
                        anim.seqType?.id ?? -1,
                        anim.frame | 0,
                    );
                if (proxyModel && !host.hasNoVisibleFaces(proxyModel)) {
                    return proxyModel;
                }
            }
        }
        return undefined;
    
}
