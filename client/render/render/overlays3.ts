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
import { RENDER_CONSTANTS, DEFAULT_OVERHEAD_CHAT_COLOR, OVERHEAD_CHAT_COLOR_TABLE, DEFAULT_NPC_HEALTH, MAX_ESTIMATED_HEALTH } from "./constants";
import { projectDeckToWorld } from "./worldEntityMotion";

export function trimActorHealthBars(host: WebGLOsrsRendererHost, 
        map: Map<number, ActorHealthBarsState>,
        tick: number,
        opts: { kind: "player" | "npc" },
    ): void {

        if (map.size === 0) return;
        const now = tick | 0;
        const playerEcs = host.osrsClient.playerEcs;
        const npcEcs = host.osrsClient.npcEcs;
        const controlledId = host.getEffectiveControlledPlayerId();

        const removeIds: number[] = [];
        for (const [serverId, state] of map) {
            // Drop entries for despawned actors.
            if (opts.kind === "player") {
                const isControlledPlayer =
                    controlledId > 0 && (serverId | 0) === (controlledId | 0);
                const missing = playerEcs.getIndexForServerId(serverId) === undefined;
                if (missing && !isControlledPlayer) {
                    removeIds.push(serverId);
                    continue;
                }
            } else {
                const ecsId = npcEcs.getEcsIdForServer(serverId);
                if (ecsId === undefined || !npcEcs.isActive(ecsId)) {
                    removeIds.push(serverId);
                    continue;
                }
            }

            const bars = state.bars;
            for (let i = bars.length - 1; i >= 0; i--) {
                const bar = bars[i];
                // Use `get` semantics to expire old updates; remove empty bars.
                const got = host.healthBarGet(bar, now);
                if (!got && bar.updates.length === 0) {
                    bars.splice(i, 1);
                }
            }
            if (state.bars.length === 0) {
                removeIds.push(serverId);
            }
        }
        for (const id of removeIds) {
            map.delete(id);
        }
    
}

export function makeActorGroupKey(host: WebGLOsrsRendererHost, isNpc: boolean, serverId: number): number {

        return ((isNpc ? 1 : 0) << 24) | ((serverId | 0) & 0xffffff) | 0;
    
}

export function appendPlayerOverheadText(host: WebGLOsrsRendererHost, 
        index: number,
        output: OverheadTextEntry[],
        maxEntries: number,
        playerDefaultHeightTiles: number | undefined,
    ): void {

        if (output.length >= maxEntries) return;
        if (!host.shouldRenderPlayerIndex(index)) return;
        const pe = host.osrsClient.playerEcs;
        const chatState = pe.getOverheadChat(index);
        if (!chatState) return;
        const text = chatState.text;
        if (!text || text.length === 0) return;

        let x = pe.getX(index) | 0;
        let y = pe.getY(index) | 0;
        // On a boat the player stands in deck coordinates; place the text where the deck is drawn.
        const worldViewId = pe.getWorldViewId(index) | 0;
        if (worldViewId >= 0) {
            const projected = projectDeckToWorld(host, worldViewId, x, y);
            if (!projected) return;
            x = projected.x;
            y = projected.y;
        }

        const overhead = host.acquireOverheadTextEntry();
        overhead.worldX = x / 128.0;
        overhead.worldZ = y / 128.0;
        overhead.plane = pe.getLevel(index) | 0;
        overhead.footprintRadius = RENDER_CONSTANTS.PLAYER_FOOTPRINT_RADIUS;
        overhead.groupKey = host.makeActorGroupKey(false, pe.getServerIdForIndex?.(index) ?? 0);
        overhead.text = text;
        overhead.color = host.mapOverheadColor(chatState.color);
        overhead.colorId =
            typeof chatState.color === "number" && chatState.color >= 0 && chatState.color < 0x100
                ? chatState.color | 0
                : undefined;
        overhead.effect = chatState.effect ?? 0;
        overhead.modIcon = host.resolveModIcon(chatState.modIcon);
        overhead.pattern = chatState.pattern;
        const duration = chatState.duration && chatState.duration > 0 ? chatState.duration : 1;
        const remaining = Math.max(0, Math.min(duration, chatState.remaining ?? duration));
        overhead.duration = duration;
        overhead.remaining = remaining;
        overhead.life = host.computeOverheadAlpha(overhead);
        overhead.heightOffsetTiles = host.resolvePlayerLogicalHeightTiles(
            index,
            playerDefaultHeightTiles,
        );
        output.push(overhead);
    
}

export function appendActorHealthBars(host: WebGLOsrsRendererHost, 
        map: Map<number, ActorHealthBarsState>,
        serverId: number,
        kind: "player" | "npc",
        worldX: number,
        worldZ: number,
        plane: number,
        footprintRadius: number,
        baseHeightTiles: number,
        output: HealthBarEntry[],
        clientCycle: number,
        maxOutput: number,
    ): void {

        if (output.length >= maxOutput) return;
        const state = map.get(serverId);
        if (!state) return;
        const groupKey = host.makeActorGroupKey(kind === "npc", serverId);
        // Iterate from the tail of the deque.
        for (let i = state.bars.length - 1; i >= 0; i--) {
            if (output.length >= maxOutput) break;
            const bar = state.bars[i];
            const update = host.healthBarGet(bar, clientCycle);
            if (!update) {
                if (bar.updates.length === 0) {
                    state.bars.splice(i, 1);
                }
                continue;
            }
            const entry = host.acquireHealthBarEntry();
            entry.worldX = worldX;
            entry.worldZ = worldZ;
            entry.plane = plane;
            entry.footprintRadius = footprintRadius | 0;
            // Health bar at logicalHeightWithAnimationOffset + 15 units.
            // No additional offset needed - baseHeightTiles already includes the +15 offset
            entry.heightOffsetTiles = baseHeightTiles ?? 0;
            entry.health = update.health | 0;
            entry.health2 = update.health2 | 0;
            entry.cycle = update.cycle | 0;
            entry.cycleOffset = update.cycleOffset | 0;
            entry.defId = bar.def.defId | 0;
            entry.groupKey = groupKey;
            output.push(entry);
        }
        if (state.bars.length === 0) {
            map.delete(serverId);
        }
    
}

export function mapOverheadColor(host: WebGLOsrsRendererHost, rawColor: number | undefined): number {

        if (rawColor == null) return DEFAULT_OVERHEAD_CHAT_COLOR >>> 0;
        const colorId = rawColor | 0;
        if (colorId >= 0 && colorId < OVERHEAD_CHAT_COLOR_TABLE.length) {
            return OVERHEAD_CHAT_COLOR_TABLE[colorId] >>> 0;
        }
        if (colorId > 0) {
            return colorId >>> 0;
        }
        return DEFAULT_OVERHEAD_CHAT_COLOR >>> 0;
    
}

export function resolveModIcon(host: WebGLOsrsRendererHost, modIcon: number | undefined): number | undefined {

        if (modIcon == null) return undefined;
        const idx = modIcon | 0;
        return idx >= 0 ? idx : undefined;
    
}

export function getSequenceVerticalOffsetTiles(host: WebGLOsrsRendererHost, seqId: number | undefined): number {

        const id = seqId == null ? -1 : seqId | 0;
        if (id < 0) return 0;
        try {
            const seqType = host.osrsClient.seqTypeLoader?.load?.(id) as
                | { verticalOffset?: number }
                | undefined;
            const offset = (seqType?.verticalOffset ?? 0) | 0;
            return offset / 128.0;
        } catch {
            return 0;
        }
    
}

export function resolvePlayerAnimationHeightOffsetTiles(host: WebGLOsrsRendererHost, index: number): number {

        const playerEcs = host.osrsClient.playerEcs;
        const actionSeqId =
            playerEcs.getAnimActionSeqId?.(index) ?? playerEcs.getAnimSeqId?.(index) ?? -1;
        const actionDelay = playerEcs.getAnimSeqDelay?.(index) ?? 0;
        if ((actionSeqId | 0) >= 0 && (actionDelay | 0) === 0) {
            return host.getSequenceVerticalOffsetTiles(actionSeqId);
        }
        const movementSeqId = playerEcs.getAnimMovementSeqId?.(index) ?? -1;
        return host.getSequenceVerticalOffsetTiles(movementSeqId);
    
}

export function resolvePlayerLogicalHeightTiles(host: WebGLOsrsRendererHost, index: number, fallback?: number): number {

        const ecsHeight = host.osrsClient.playerEcs.getDefaultHeightTiles?.(index);
        const base =
            typeof ecsHeight === "number" && Number.isFinite(ecsHeight) && ecsHeight > 0
                ? ecsHeight
                : typeof fallback === "number" && Number.isFinite(fallback) && fallback > 0
                    ? fallback
                    : host.playerDefaultHeightTiles;
        return Math.max(0.5, base + host.resolvePlayerAnimationHeightOffsetTiles(index));
    
}

export function resolvePlayerHitsplatOffset(host: WebGLOsrsRendererHost, index: number, fallback?: number): number {

        return host.resolvePlayerLogicalHeightTiles(index, fallback) * 0.5;
    
}

export function resolvePlayerHeadIconOffset(host: WebGLOsrsRendererHost, index: number, fallback?: number): number {

        // OSRS actor2d draws player icons at logicalHeight + 15 world units.
        return host.resolvePlayerLogicalHeightTiles(index, fallback) + 15 / 128;
    
}

export function computeOverheadAlpha(host: WebGLOsrsRendererHost, entry: OverheadTextEntry): number {

        if (entry.duration <= 0) return 1;
        return entry.remaining > 0 ? 1 : 0;
    
}

export function getNpcTypeIdForServer(host: WebGLOsrsRendererHost, serverId: number): number | undefined {

        try {
            const ecs = host.osrsClient.npcEcs;
            const ecsId = ecs.getEcsIdForServer(serverId);
            if (ecsId === undefined) return undefined;
            return ecs.getNpcTypeId(ecsId) | 0;
        } catch {
            return undefined;
        }
    
}

export function estimateNpcMaxHp(host: WebGLOsrsRendererHost, npcTypeId: number | undefined): number {

        let estimate = DEFAULT_NPC_HEALTH;
        if (typeof npcTypeId === "number" && npcTypeId >= 0) {
            try {
                const loader = host.osrsClient.npcTypeLoader;
                const type = loader?.load?.(npcTypeId);
                if (type) {
                    const params = type.params;
                    const hpParam =
                        params && typeof params.get === "function" ? params.get(10) : undefined;
                    if (typeof hpParam === "number" && hpParam > 0) {
                        estimate = Math.max(estimate, hpParam | 0);
                    }
                    const combat = type.combatLevel | 0;
                    if (combat > 0) {
                        estimate = Math.max(estimate, Math.round(combat * 1.5 + 10));
                    }
                    const size = type.size | 0;
                    if (size > 1) {
                        estimate = Math.max(estimate, estimate + size * 10);
                    }
                }
            } catch {}
        }
        return Math.min(MAX_ESTIMATED_HEALTH, Math.max(10, estimate));
    
}

export function trimHealthBars(host: WebGLOsrsRendererHost, tick: number): void {

        host.trimActorHealthBars(host.playerHealthBars, tick, { kind: "player" });
        host.trimActorHealthBars(host.npcHealthBars, tick, { kind: "npc" });
    
}

export function registerPlayerHealthBarUpdate(host: WebGLOsrsRendererHost, event: {
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
        const actor = host.playerHealthBars.get(serverId);
        if (bar.removed === true) {
            if (!actor) return;
            host.actorRemoveHealthBar(actor, defId);
            if (actor.bars.length === 0) host.playerHealthBars.delete(serverId);
            return;
        }

        const state = actor ?? host.ensureActorHealthBars(host.playerHealthBars, serverId);
        host.actorAddHealthBar(state, defId, {
            cycle: bar.cycle | 0,
            health: bar.health | 0,
            health2: bar.health2 | 0,
            cycleOffset: bar.cycleOffset | 0,
        });
    
}
