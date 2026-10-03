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

export function onLocDel(host: WebGLOsrsRendererHost, tile: { x: number; y: number }, level: number, shape: number, rotation: number): void {

        try {
            const key = `${tile.x},${tile.y},${level},${shape}`;
            host.addedLocs.delete(key);

            // Suppress the base cache-baked loc at this tile so a deregistered
            // object (e.g. a chopped tree) actually disappears - buildScene has
            // no other way to know a cache loc was removed.
            let overrideKey = `${tile.x | 0},${tile.y | 0},${level | 0},-1`;
            let existingOverride = host.locOverrides.get(overrideKey);
            if (typeof existingOverride?.matchType === "number" && existingOverride.matchType !== shape) {
                overrideKey += `,${shape}`;
                existingOverride = host.locOverrides.get(overrideKey);
            }
            if (
                existingOverride?.newId !== 0 ||
                typeof existingOverride.matchType !== "number" ||
                existingOverride.matchType === shape
            ) {
                host.locOverrides.set(overrideKey, {
                    newId: 0,
                    matchType: shape as LocModelType,
                });
            }

            if (host.instanceActive) {
                host.scheduleInstanceLocRebuild();
                return;
            }

            const mapX = Math.floor(tile.x / 64);
            const mapY = Math.floor(tile.y / 64);
            // LOC_DEL does not carry an object id. Resolve it from the current
            // per-tile loc index so deletes can stay on the same partial path.
            const deletedLoc = host.getLocIdsAtTileAllLevels(tile.x, tile.y).find((loc) => {
                if ((loc.level | 0) !== (level | 0)) return false;
                const typeRot = loc.typeRot;
                return (
                    typeRot !== undefined &&
                    ((typeRot | 0) & 0x3f) === ((shape | 0) & 0x3f) &&
                    ((typeRot >> 6) & 0x3) === ((rotation | 0) & 0x3)
                );
            });
            const locType =
                deletedLoc && (deletedLoc.id | 0) > 0
                    ? host.osrsClient.locTypeLoader.load(deletedLoc.id | 0)
                    : undefined;
            host.scheduleLocGeometryUpdate(
                mapX,
                mapY,
                locType ? (isDoorLocType(locType) ? "door" : "loc") : "full",
            );
        } catch (err) {
            console.warn("onLocDel error", err);
        }
    
}

export function onLocAnim(host: WebGLOsrsRendererHost, 
        locId: number,
        tile: { x: number; y: number },
        level: number,
        shape: number,
        rotation: number,
        animId: number,
    ): void {

        try {
            if ((shape | 0) < 0) return;
            const exactKey = `${tile.x | 0},${tile.y | 0},${level | 0},${locId | 0}`;
            const matchKey = `${tile.x | 0},${tile.y | 0},${level | 0},-1`;
            // A loc the server added is found by its own id. The tile-wide key there holds
            // the removal of the map's loc it replaced, which must survive the animation.
            const added = host.addedLocs.get(`${tile.x | 0},${tile.y | 0},${level | 0},${shape | 0}`);
            const onAddedLoc = added !== undefined && (added.locId | 0) === (locId | 0);
            const keys = onAddedLoc ? [exactKey] : [exactKey, matchKey];
            // A boat deck rebuilds its whole scene for an animation, so the same animation
            // sent again while it plays (a salvaging hook's idle, every tick) only extends it.
            const loops = locAnimationLoops(host, animId);
            const repeating =
                deckViewAt(host, tile) !== undefined &&
                host.locOverrides.get(exactKey)?.seqId === (animId | 0) &&
                (loops || host.locAnimTimers.has(exactKey));
            for (const key of keys) {
                const existingTimer = host.locAnimTimers.get(key);
                if (existingTimer) {
                    clearTimeout(existingTimer);
                    host.locAnimTimers.delete(key);
                }
            }

            if (
                host.interactHighlightActiveTarget?.kind === "loc" &&
                (host.interactHighlightActiveTarget.plane | 0) === (level | 0) &&
                (host.interactHighlightActiveTarget.tileX | 0) === (tile.x | 0) &&
                (host.interactHighlightActiveTarget.tileY | 0) === (tile.y | 0)
            ) {
                host.clearInteractHighlightActiveTarget();
            }
            if (
                host.interactHighlightHoverTarget?.kind === "loc" &&
                (host.interactHighlightHoverTarget.plane | 0) === (level | 0) &&
                (host.interactHighlightHoverTarget.tileX | 0) === (tile.x | 0) &&
                (host.interactHighlightHoverTarget.tileY | 0) === (tile.y | 0)
            ) {
                host.clearInteractHighlightHoverTarget();
            }

            host.locOverrides.set(exactKey, {
                newId: locId | 0,
                newRotation: rotation & 0x3,
                seqId: animId | 0,
                seqRandomStart: false,
            });
            if (!onAddedLoc) {
                host.locOverrides.set(matchKey, {
                    newId: -1,
                    newRotation: rotation & 0x3,
                    seqId: animId | 0,
                    seqRandomStart: false,
                    matchType: shape as LocModelType,
                    matchRotation: rotation & 0x3,
                });
            }
            if (!repeating) host.reloadLocAnimationTile(tile, locId);

            // As in OSRS, a sequence with a frame step loops (or holds its last frames) until
            // the loc is animated again or changed; only one without plays once and reverts.
            if (loops) return;
            const durationMs = host.getLocAnimationDurationMs(animId);
            const timer = setTimeout(() => {
                let changed = false;
                for (const key of keys) {
                    const current = host.locOverrides.get(key);
                    if (
                        current &&
                        typeof current.seqId === "number" &&
                        (current.seqId | 0) === (animId | 0)
                    ) {
                        host.locOverrides.delete(key);
                        changed = true;
                    }
                    host.locAnimTimers.delete(key);
                }
                if (changed) {
                    host.reloadLocAnimationTile(tile, locId);
                }
            }, durationMs);
            for (const key of keys) host.locAnimTimers.set(key, timer);
        } catch (err) {
            console.warn("onLocAnim error", err);
        }
    
}

/** The boat (world entity) whose deck scene holds a tile, if any. */
/** Whether a loc animation keeps going: its sequence has a frame step to loop back by. */
function locAnimationLoops(host: WebGLOsrsRendererHost, seqId: number): boolean {
    try {
        const seqType = host.osrsClient?.seqTypeLoader?.load(seqId | 0) as { frameStep?: number } | undefined;
        return (seqType?.frameStep ?? -1) > 0;
    } catch {
        return false;
    }
}

function deckViewAt(host: WebGLOsrsRendererHost, tile: { x: number; y: number }): number | undefined {
    const view = host.osrsClient?.worldViewManager?.findWorldViewAt(tile.x | 0, tile.y | 0);
    return view && host.worldEntityOverlays?.has(view.id) ? view.id : undefined;
}

export function reloadLocAnimationTile(host: WebGLOsrsRendererHost, tile: { x: number; y: number }, locId: number): void {

        // A deck loc belongs to its boat's scene, which is rebuilt as a whole.
        const deckView = deckViewAt(host, tile);
        if (deckView !== undefined) {
            host.scheduleWorldEntityLocRebuild(deckView);
            return;
        }
        const mapX = Math.floor((tile.x | 0) / 64);
        const mapY = Math.floor((tile.y | 0) / 64);
        if (host.instanceActive) {
            host.scheduleInstanceLocRebuild();
            return;
        }
        const locType = host.osrsClient.locTypeLoader.load(locId | 0);
        host.scheduleLocGeometryUpdate(
            mapX,
            mapY,
            locType && isDoorLocType(locType) ? "door" : "loc",
        );
    
}

export function getLocAnimationDurationMs(host: WebGLOsrsRendererHost, seqId: number): number {

        const fallbackMs = 2400;
        try {
            const seqType = host.osrsClient.seqTypeLoader.load(seqId | 0) as any;
            if (!seqType) return fallbackMs;
            let cycles = 0;
            const isSkeletal =
                (typeof seqType.isSkeletalSeq === "function" && seqType.isSkeletalSeq()) ||
                (seqType.skeletalId ?? -1) >= 0;
            if (isSkeletal) {
                const duration =
                    typeof seqType.getSkeletalDuration === "function"
                        ? seqType.getSkeletalDuration()
                        : 0;
                cycles = Math.max(1, duration | 0);
            } else if (Array.isArray(seqType.frameLengths)) {
                for (const frameLength of seqType.frameLengths) {
                    cycles += Math.max(1, Number(frameLength) | 0);
                }
            }
            if (!(cycles > 0)) return fallbackMs;
            return Math.max(600, Math.min(10000, cycles * 20 + 120));
        } catch {
            return fallbackMs;
        }
    
}

export function scheduleLocReload(host: WebGLOsrsRendererHost, mapX: number, mapY: number): void {

        const id = getMapSquareId(mapX, mapY);
        host.locReloadVersions.set(id, (host.locReloadVersions.get(id) ?? 0) + 1);
        // Completed builds can still be waiting for upload. Their version check
        // has already passed, so discard them before they restore stale locs.
        let discarded = false;
        for (const batch of host.pendingStreamMapsByGeneration.values()) {
            if (batch.delete(id)) discarded = true;
        }
        // In-flight builds check locReloadVersions themselves. Only restart a
        // completed build here; otherwise the normal load picks up these changes.
        if (!host.mapManager.getMap(mapX, mapY)) {
            if (discarded) void host.queueLoadMap(mapX, mapY);
            return;
        }
        host.pendingLocReloadMaps.set(id, { mapX: mapX | 0, mapY: mapY | 0 });
        if (host.pendingLocReloadFlushTimer) return;
        const flush = () => {
            host.pendingLocReloadFlushTimer = undefined;
            if (host.pendingLocReloadMaps.size === 0) return;
            const batch = Array.from(host.pendingLocReloadMaps.values());
            host.pendingLocReloadMaps.clear();
            host.beginLocReloadBatch(batch);
        };
        host.pendingLocReloadFlushTimer = setTimeout(
            flush,
            RENDER_CONSTANTS.LOC_RELOAD_FLUSH_DELAY_MS,
        );
    
}
