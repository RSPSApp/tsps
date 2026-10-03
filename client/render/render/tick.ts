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
import { updateWorldEntityMotion } from "./worldEntityMotion";

export function tickPass(host: WebGLOsrsRendererHost, 
        time: number,
        ticksElapsed: number,
        clientTicksElapsed: number,
        clientCycle: number,
    ): void {

        const seqFrameLoader = host.osrsClient.seqFrameLoader;

        host.actorRenderCount = 0;

        // Core client-cycle ticking is handled by OsrsClient's tick loop so it continues even when
        // rendering is throttled (e.g., alt-tab/background). This pass is render-focused only.

        // Reuse buffers instead of allocating new arrays each frame
        const visibleMaps = host.visibleMapsBuffer;
        visibleMaps.length = 0;

        host.gfxManager?.resetWorldBindings?.();
        // PERF: Use cached callback to avoid per-frame closure allocation
        // Throttle ambient sound collection to reduce tick cost
        host.ambientSoundFrameCounter++;
        const shouldCollectAmbient =
            host.ambientSoundFrameCounter >= RENDER_CONSTANTS.AMBIENT_SOUND_THROTTLE_FRAMES;
        if (shouldCollectAmbient) {
            host.ambientSoundFrameCounter = 0;
            // Reset only on collect frames; between collects the previous
            // instances stay live so volumes keep tracking the listener
            host.ambientSoundBufferIndex = 0;
        }
        for (let i = 0; i < host.mapManager.visibleMapCount; i++) {
            const map = host.mapManager.visibleMaps[i];
            visibleMaps.push(map);

            for (const loc of map.locsAnimated) {
                // DynamicObject/loc animation timing is based on Client.cycle (20ms each).
                loc.update(seqFrameLoader, clientCycle | 0, host.seqSoundCallback);
            }

            // Collect ambient sounds only every N frames (throttled)
            if (shouldCollectAmbient) {
                host.collectAmbientSounds(map);
            }

            host._ecsUpdateNpcClient(map, clientTicksElapsed);
            host._ecsUpdatePlayerOccupancy(map);

            // ECS is authoritative; legacy sync removed

            // Fully clear per-map actor offset rings to avoid any stale indices leaking
            for (let r = 0; r < map.playerDataTextureOffsets.length; r++)
                map.playerDataTextureOffsets[r] = -1;
            for (let r = 0; r < map.npcDataTextureOffsets.length; r++)
                map.npcDataTextureOffsets[r] = -1;
            for (let r = 0; r < map.worldGfxDataTextureOffsets.length; r++)
                map.worldGfxDataTextureOffsets[r] = -1;

            host.addNpcRenderData(map);
            host.addPlayerRenderData(map);
            host.addProjectileRenderData(map);
            host.addWorldGfxRenderData(map);
        }

        // A server spawn reaches ECS before its asynchronous map batch rebuild.
        // Give those NPCs actor-data slots immediately so the dynamic fallback
        // pass can draw them during that gap.
        host.addUnbatchedNpcRenderData();

        host.worldEntityAnimator?.tick(clientCycle);
        host.osrsClient.worldViewManager.interpolateEntities(clientCycle, host.clientTickPhase);
        updateWorldEntityMotion(host);

        // Propagate listener position for positional audio and advance ambient loops.
        const soundSystem = host.osrsClient.soundEffectSystem;
        if (soundSystem) {
            try {
                const peListener = host.osrsClient.playerEcs;
                const idxListener = peListener.getIndexForServerId(
                    host.osrsClient.controlledPlayerServerId,
                );
                if (idxListener !== undefined) {
                    const px = peListener.getX(idxListener) | 0;
                    const py = peListener.getY(idxListener) | 0;
                    const level = peListener.getLevel(idxListener) | 0;
                    soundSystem.updateListenerPosition(px, py, level * 128);
                } else {
                    // z is the listener plane (level * 128), not a world height
                    soundSystem.updateListenerPosition(
                        host.osrsClient.camera.getPosX() * 128,
                        host.osrsClient.camera.getPosZ() * 128,
                        0,
                    );
                }
            } catch {
                soundSystem.updateListenerPosition(
                    host.osrsClient.camera.getPosX() * 128,
                    host.osrsClient.camera.getPosZ() * 128,
                    0,
                );
            }
            // Truncate the buffer only on collect frames; the update itself
            // runs every frame so volumes track the listener continuously
            if (shouldCollectAmbient) {
                host.ambientSoundBuffer.length = host.ambientSoundBufferIndex;
            }
            soundSystem.updateAmbientSounds(host.ambientSoundBuffer);
        }

        // animation stepping is handled by the client tick loop (`PlayerEcs` + `PlayerAnimController`).
    
}

export function _ecsUpdatePlayerOccupancy(host: WebGLOsrsRendererHost, map: WebGLMapSquare): void {

        const pe = host.osrsClient.playerEcs;
        const n = pe.size?.() ?? (pe as any).size?.() ?? 0;
        if (!n) return;
        for (let i = 0; i < n; i++) {
            const px = pe.getX(i) | 0;
            const py = pe.getY(i) | 0;
            const tileX = (px / 128) | 0;
            const tileY = (py / 128) | 0;
            const worldViewId = pe.getWorldViewId(i) | 0;
            let occMapX = map.mapX | 0;
            let occMapY = map.mapY | 0;
            if (worldViewId >= 0) {
                const overlayView = host.osrsClient.worldViewManager.getWorldView(worldViewId);
                if (!overlayView || (overlayView.overlayMapId | 0) !== (map.id | 0)) continue;
            } else {
                const mapX = getMapIndexFromTile(tileX);
                const mapY = getMapIndexFromTile(tileY);
                if (mapX !== map.mapX || mapY !== map.mapY) continue;
                occMapX = mapX | 0;
                occMapY = mapY | 0;
            }

            // Compute effective plane using bridge flag
            const local = host.getMapLocalTile(map, tileX, tileY);
            if (!local) continue;
            const localTileX = local.x;
            const localTileY = local.y;
            const plane = resolveCollisionSamplePlaneForLocal(
                map,
                pe.getLevel(i) | 0,
                localTileX,
                localTileY,
            );

            const oldPlane = pe.getOccPlane(i) | 0;
            const oldMapX = pe.getOccMapX?.(i) ?? 255;
            const oldMapY = pe.getOccMapY?.(i) ?? 255;
            const oldTileX = pe.getOccTileX(i) | 0;
            const oldTileY = pe.getOccTileY(i) | 0;

            // First-time init: set occ to current and inc
            if (oldPlane === 255) {
                map.incPlayerOcc(plane, localTileX, localTileY);
                pe.setOccTileWithMap?.(i, occMapX, occMapY, localTileX, localTileY, plane);
                continue;
            }

            // If map changed, dec on old map (if loaded), inc on new
            if (oldMapX !== occMapX || oldMapY !== occMapY) {
                const oldMap = host.mapManager.getMap(oldMapX as number, oldMapY as number) as
                    | WebGLMapSquare
                    | undefined;
                if (oldMap) oldMap.decPlayerOcc(oldPlane, oldTileX, oldTileY);
                map.incPlayerOcc(plane, localTileX, localTileY);
                pe.setOccTileWithMap?.(i, occMapX, occMapY, localTileX, localTileY, plane);
                continue;
            }

            // Same map: if plane and tile the same, nothing to do
            if (
                oldPlane === (plane | 0) &&
                oldTileX === (localTileX | 0) &&
                oldTileY === (localTileY | 0)
            ) {
                continue;
            }

            // Same map: delta row/column if single-tile and same plane, else full
            if (
                oldPlane === (plane | 0) &&
                Math.abs(localTileX - oldTileX) <= 1 &&
                Math.abs(localTileY - oldTileY) <= 1 &&
                (localTileX !== oldTileX || localTileY !== oldTileY)
            ) {
                const dx = localTileX - oldTileX;
                const dy = localTileY - oldTileY;
                if (dx !== 0) {
                    const trailX = oldTileX; // size 1: trailing is the whole old footprint
                    map.decPlayerOcc(oldPlane, trailX, oldTileY);
                    const leadX = localTileX;
                    map.incPlayerOcc(plane, leadX, localTileY);
                }
                if (dy !== 0) {
                    const trailY = oldTileY;
                    map.decPlayerOcc(oldPlane, oldTileX, trailY);
                    const leadY = localTileY;
                    map.incPlayerOcc(plane, localTileX, leadY);
                }
            } else {
                map.decPlayerOcc(oldPlane, oldTileX, oldTileY);
                map.incPlayerOcc(plane, localTileX, localTileY);
            }
            pe.setOccTileWithMap?.(i, occMapX, occMapY, localTileX, localTileY, plane);
        }
    
}

export function resetActorTileSelectionFrameIfNeeded(host: WebGLOsrsRendererHost, ): void {

        const frameId = (host.stats?.frameCount ?? 0) | 0;
        if (frameId === host.frameActorTileSelectionId) {
            return;
        }

        host.frameActorTileSelectionId = frameId;
        host.frameActorTileSelectionBuilt = false;
        host.frameWinningActorByTile.clear();
    
}

export function getActorTileSelectionKey(host: WebGLOsrsRendererHost, tileX: number, tileY: number, plane: number): number {

        return ((plane & 0x3) * 0x40000000 + ((tileX & 0x7fff) * 0x8000 + (tileY & 0x7fff))) >>> 0;
    
}

export function shouldReplaceTileWinner(host: WebGLOsrsRendererHost, 
        current: { kind: "player" | "npc"; id: number; priority: number },
        kind: "player" | "npc",
        id: number,
        priority: number,
    ): boolean {

        return (priority | 0) > (current.priority | 0);
    
}

export function registerActorTileCandidate(host: WebGLOsrsRendererHost, 
        kind: "player" | "npc",
        id: number,
        tileX: number,
        tileY: number,
        plane: number,
        priority: number,
    ): void {

        const key = host.getActorTileSelectionKey(tileX | 0, tileY | 0, plane | 0);
        const current = host.frameWinningActorByTile.get(key);
        if (current && !host.shouldReplaceTileWinner(current, kind, id | 0, priority | 0)) {
            return;
        }

        host.frameWinningActorByTile.set(key, {
            kind: kind,
            id: id | 0,
            priority: priority | 0,
        });
    
}

export function registerPlayerSceneTileCandidate(host: WebGLOsrsRendererHost, pid: number, priority: number): void {

        const pe = host.osrsClient.playerEcs;
        if (pe.getIsHidden(pid | 0)) {
            return;
        }
        host.registerActorTileCandidate(
            "player",
            pid | 0,
            (pe.getX(pid) >> 7) | 0,
            (pe.getY(pid) >> 7) | 0,
            pe.getLevel(pid) | 0,
            priority | 0,
        );
    
}

export function collectRenderableNpcIds(host: WebGLOsrsRendererHost, ): Set<number> {

        const renderable = new Set<number>();
        for (let i = 0; i < host.mapManager.visibleMapCount; i++) {
            const map = host.mapManager.visibleMaps[i];
            const ids = map?.npcEntityIds;
            if (!ids || ids.length === 0) {
                continue;
            }

            for (let j = 0; j < ids.length; j++) {
                const ecsId = ids[j] | 0;
                if (host.shouldRenderNpcOwnershipFromMap(map, ecsId)) {
                    renderable.add(ecsId);
                }
            }
        }
        return renderable;
    
}
