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

export function registerNpcHealthBarUpdate(host: WebGLOsrsRendererHost, event: {
        serverId: number;
        bar: {
            id: number;
            cycle: number;
            health: number;
            health2: number;
            cycleOffset: number;
            removed?: boolean;
        };
    }): void {

        const serverId = event.serverId | 0;
        if (serverId <= 0) return;
        const bar = event.bar;
        const defId = bar.id | 0;
        const actor = host.npcHealthBars.get(serverId);
        if (bar.removed === true) {
            if (!actor) return;
            host.actorRemoveHealthBar(actor, defId);
            if (actor.bars.length === 0) host.npcHealthBars.delete(serverId);
            return;
        }

        const state = actor ?? host.ensureActorHealthBars(host.npcHealthBars, serverId);
        host.actorAddHealthBar(state, defId, {
            cycle: bar.cycle | 0,
            health: bar.health | 0,
            health2: bar.health2 | 0,
            cycleOffset: bar.cycleOffset | 0,
        });
    
}

export function clearNpcHealthBars(host: WebGLOsrsRendererHost, serverId: number): void {

        host.npcHealthBars.delete(serverId | 0);
    
}

export function clearPlayerHealthBars(host: WebGLOsrsRendererHost, serverId: number): void {

        host.playerHealthBars.delete(serverId | 0);
    
}

export function registerHitsplat(host: WebGLOsrsRendererHost, event: HitsplatEventPayload): void {

        // Use CLIENT CYCLES (20ms each) for hitsplat timing.
        // Client.cycle in OSRS is a client-side counter incrementing every 20ms.
        const clientCycle = getClientCycle() | 0;

        // `delayCycles` is already in client-cycle units (see Actor.addHitSplat var6).
        const delayCycles =
            typeof event.delayCycles === "number" ? Math.max(0, event.delayCycles | 0) : 0;

        // Preserve raw value parity (`-1` is meaningful for sentinel no-type hitsplats).
        const damage = event.damage | 0;
        const type = typeof event.style === "number" ? event.style | 0 : -1;
        const type2 = typeof event.type2 === "number" ? event.type2 | 0 : -1;
        const damage2 = typeof event.damage2 === "number" ? event.damage2 | 0 : -1;
        const targetId = event.targetId | 0;
        if (event.targetType === "player") {
            if (targetId > 0) {
                const controlledId = host.osrsClient.controlledPlayerServerId | 0;
                if (controlledId <= 0) {
                    host.pendingControlledPlayerServerId = targetId;
                } else if (host.pendingControlledPlayerServerId !== undefined) {
                    host.pendingControlledPlayerServerId = undefined;
                }
            }
            const state = host.ensureHitsplatState(host.playerHitsplats, targetId);
            host.addHitSplatOsrs(state, type, damage, type2, damage2, clientCycle, delayCycles);
        } else {
            const state = host.ensureHitsplatState(host.npcHitsplats, targetId);
            host.addHitSplatOsrs(state, type, damage, type2, damage2, clientCycle, delayCycles);
        }
        // Use client cycle for trim operations too
        host.trimHitsplats(clientCycle);
        host.trimHealthBars(clientCycle);
    
}

export function registerSpotAnimation(host: WebGLOsrsRendererHost, event: PlayerSpotAnimationEvent): void {

        try {
            const sid = event.serverId | 0;
            const spotId = event.spotId | 0;
            if (spotId < 0) {
                host.gfxManager?.clearAttachedSlotPlayer(
                    sid,
                    typeof event.slot === "number" ? (event.slot | 0) & 0xff : 0,
                );
                return;
            }
            const heightUnits = (event.height ?? 0) | 0;
            const offsetTiles = heightUnits / 128;
            host.gfxManager?.spawnAttachedToPlayer(
                spotId,
                sid,
                offsetTiles !== 0 ? "offset" : "ground",
                offsetTiles !== 0 ? offsetTiles : undefined,
                false,
                event.startCycle | 0,
                typeof event.slot === "number" ? (event.slot | 0) & 0xff : undefined,
            );
        } catch (err) {
            console.warn("[renderer] registerSpotAnimation error", err);
        }
    
}

export function clearNpcSpotAnimations(host: WebGLOsrsRendererHost, serverId: number): void {
    host.gfxManager?.removeActorInstances("npc", serverId);
}

export function registerNpcSpotAnimation(host: WebGLOsrsRendererHost, event: {
        npcServerId: number;
        spotId: number;
        height: number;
        startCycle: number;
        slot?: number;
    }): void {

        try {
            const sid = event.npcServerId | 0;
            const spotId = event.spotId | 0;
            const slot = typeof event.slot === "number" ? (event.slot | 0) & 0xff : 0;
            if (spotId < 0) {
                host.gfxManager?.clearAttachedSlotNpc(sid, slot);
                return;
            }
            const heightUnits = (event.height ?? 0) | 0;
            const offsetTiles = heightUnits / 128;
            host.gfxManager?.spawnAttachedToNpc(
                spotId,
                sid,
                offsetTiles !== 0 ? "offset" : "ground",
                offsetTiles !== 0 ? offsetTiles : undefined,
                false,
                event.startCycle | 0,
                slot,
            );
        } catch (err) {
            console.warn("[renderer] registerNpcSpotAnimation error", err);
        }
    
}

export function registerWorldSpotAnimation(host: WebGLOsrsRendererHost, event: {
        spotId: number;
        tile: { x: number; y: number; level?: number };
        height?: number;
        startCycle: number;
        loop?: boolean;
    }): number | undefined {

        try {
            const heightUnits = Number(event.height ?? 0) | 0;
            const heightTiles = heightUnits !== 0 ? heightUnits / 128 : undefined;
            return host.gfxManager?.spawnAtTile(
                event.spotId | 0,
                {
                    x: event.tile.x | 0,
                    y: event.tile.y | 0,
                    level: event.tile.level ?? 0,
                },
                {
                    heightTiles,
                    startCycle: event.startCycle | 0,
                    loop: event.loop,
                },
            );
        } catch (err) {
            console.warn("[renderer] registerWorldSpotAnimation error", err);
        }
        return undefined;
}

export function killWorldSpotAnimation(host: WebGLOsrsRendererHost, id: number): void {
    host.gfxManager?.kill(id);
}

export function resolvePlayerIdleSeqMaxId(host: WebGLOsrsRendererHost, ): number {

        if (host.playerIdleSeqMaxId >= 0) return host.playerIdleSeqMaxId;
        const fallbackMax = 12000;
        let maxId = fallbackMax;
        try {
            const loader = host.osrsClient.seqTypeLoader;
            const count = loader?.getCount?.();
            if (typeof count === "number" && count > 0) {
                maxId = Math.max(0, (count | 0) - 1);
            }
        } catch {}
        host.playerIdleSeqMaxId = maxId;
        return maxId;
    
}

export function ensureActorTileSelectionForFrame(host: WebGLOsrsRendererHost, ): void {

        host.resetActorTileSelectionFrameIfNeeded();
        if (host.frameActorTileSelectionBuilt) {
            return;
        }

        host.frameActorTileSelectionBuilt = true;

        const pe = host.osrsClient.playerEcs;
        const renderSelf = host.osrsClient.renderSelf !== false;
        const controlledServerId = host.osrsClient.controlledPlayerServerId | 0;
        const controlledPid =
            controlledServerId > 0 ? pe.getIndexForServerId(controlledServerId) : undefined;

        if (
            renderSelf &&
            controlledPid !== undefined &&
            host.isPlayerSceneTileMarkerCandidate(controlledPid | 0)
        ) {
            host.registerPlayerSceneTileCandidate(controlledPid | 0, 5);
        }

        const combatTargetPid = host.getCombatTargetPlayerEcsIndex();
        if (
            combatTargetPid !== undefined &&
            (combatTargetPid | 0) !== (controlledPid ?? -1) &&
            host.isPlayerSceneTileMarkerCandidate(combatTargetPid | 0)
        ) {
            host.registerPlayerSceneTileCandidate(combatTargetPid | 0, 4);
        }

        const renderableNpcIds = host.collectRenderableNpcIds();
        host.registerNpcSceneTileCandidatesByPriority(
            NpcDrawPriority.DRAW_PRIORITY_FIRST,
            3,
            renderableNpcIds,
        );

        const activeServerIds = Array.from(pe.getAllServerIds()).sort((a, b) => a - b);
        for (const serverId of activeServerIds) {
            const pid = pe.getIndexForServerId(serverId | 0);
            if (pid === undefined) {
                continue;
            }
            if (controlledPid !== undefined && (pid | 0) === (controlledPid | 0)) {
                continue;
            }
            if (combatTargetPid !== undefined && (pid | 0) === (combatTargetPid | 0)) {
                continue;
            }
            if (!host.isPlayerSceneTileMarkerCandidate(pid | 0)) {
                continue;
            }

            host.registerPlayerSceneTileCandidate(pid | 0, 2);
        }

        host.registerNpcSceneTileCandidatesByPriority(
            NpcDrawPriority.DRAW_PRIORITY_DEFAULT,
            1,
            renderableNpcIds,
        );
        host.registerNpcSceneTileCandidatesByPriority(
            NpcDrawPriority.DRAW_PRIORITY_LAST,
            0,
            renderableNpcIds,
        );
    
}
