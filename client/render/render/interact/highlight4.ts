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
import { projectDeckToWorld } from "../worldEntityMotion";
import { RENDER_CONSTANTS, InteractHighlightTarget } from "../constants";

export function resolveInteractHighlightTargetFromEntry(host: WebGLOsrsRendererHost, 
        entry: Pick<SimpleMenuEntry, "targetType" | "targetId" | "mapX" | "mapY"> | undefined,
        fallbackTile?: { tileX: number; tileY: number; plane?: number },
    ): InteractHighlightTarget | undefined {

        if (!entry) return undefined;
        if (entry.targetType === MenuTargetType.LOC) {
            return host.resolveLocHighlightTargetFromEntry(entry, fallbackTile);
        }
        if (entry.targetType === MenuTargetType.NPC) {
            return host.resolveNpcHighlightTargetFromEntry(entry, fallbackTile);
        }
        return undefined;
    
}

export function updateInteractHighlightHoverTarget(host: WebGLOsrsRendererHost, simpleEntries: SimpleMenuEntry[]): void {

        const config = host.osrsClient.interactHighlightPlugin.getConfig();
        if (!config.enabled || !config.showHover) {
            host.clearInteractHighlightHoverTarget();
            return;
        }

        const entry = chooseDefaultMenuEntry(simpleEntries, {
            hasSelectedSpell: ClientState.isSpellSelected,
            hasSelectedItem: ClientState.isItemSelected === 1,
        });
        const target = host.resolveInteractHighlightTargetFromEntry(
            entry,
            host.osrsClient.menuTile,
        );
        if (!target) {
            host.clearInteractHighlightHoverTarget();
            return;
        }
        host.interactHighlightHoverTarget = target;
    
}

export function onInteractHighlightEntryInvoked(host: WebGLOsrsRendererHost, 
        entry: SimpleMenuEntry | undefined,
        clickedTile?: { tileX: number; tileY: number; plane?: number },
    ): void {

        const config = host.osrsClient.interactHighlightPlugin.getConfig();
        if (!config.enabled) {
            host.clearInteractHighlightActiveTarget();
            return;
        }
        if (!entry) return;

        const optionLower = String(entry.option || "").toLowerCase();
        if (entry.targetType === MenuTargetType.LOC || entry.targetType === MenuTargetType.NPC) {
            if (optionLower === "examine") {
                return;
            }
            const target = host.resolveInteractHighlightTargetFromEntry(entry, clickedTile);
            if (target) {
                host.interactHighlightActiveTarget = target;
                host.interactHighlightActiveFromInteraction = false;
                host.interactHighlightClickTick = getCurrentTick() | 0;
            } else {
                host.clearInteractHighlightActiveTarget();
            }
            return;
        }

        if (
            optionLower === "walk here" ||
            entry.targetType === MenuTargetType.OBJ ||
            entry.targetType === MenuTargetType.PLAYER
        ) {
            host.clearInteractHighlightActiveTarget();
            return;
        }

        if (entry.action === MenuAction.Use || entry.action === MenuAction.Cast) {
            host.clearInteractHighlightActiveTarget();
        }
    
}

export function spawnClickCross(host: WebGLOsrsRendererHost, 
        tile: { tileX: number; tileY: number; plane?: number } | undefined,
        xy: { sx: number; sy: number },
        color: "red" | "yellow",
    ): void {

        if (!tile) return;
        const playerPlane = host.getPlayerBasePlane() | 0;
        let plane = tile.plane ?? playerPlane;
        let tileX = tile.tileX | 0;
        let tileY = tile.tileY | 0;
        // A click on a boat picks a tile in the boat's own scene; anchor the cross where that
        // scene is drawn (it's aligned to the click position on screen when drawn).
        const view = host.osrsClient.worldViewManager.findWorldViewAt(tileX, tileY);
        if (view && view.id !== -1) {
            const projected = projectDeckToWorld(host, view.id, (tileX << 7) + 64, (tileY << 7) + 64);
            if (!projected) return;
            tileX = Math.floor(projected.x / 128);
            tileY = Math.floor(projected.y / 128);
            plane = playerPlane;
        }
        host.clickCrossOverlay?.spawn(
            tileX,
            tileY,
            xy.sx,
            xy.sy,
            plane,
            undefined,
            color,
        );
    
}
