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

export function addNpcRenderData(host: WebGLOsrsRendererHost, map: WebGLMapSquare) {

        if (!map.drawCallNpc || !map.npcEntityIds || map.npcEntityIds.length === 0) return;

        // Always use slot 0 for double-buffered actor data
        const sampleIdx = 0;

        if (host.unifiedActorData) {
            const ids: number[] = map.npcEntityIds as any;
            const ecs = host.osrsClient.npcEcs;
            const overlayView = host.osrsClient.worldViewManager.getWorldViewByOverlayMapId(map.id);
            const renderBaseTileX = map.getRenderBaseTileX();
            const renderBaseTileY = map.getRenderBaseTileY();
            const mapTileSpan = map.getLocalTileSpan();
            const npcCount = ids.length | 0;

            if (npcCount === 0) {
                map.npcDataTextureOffsets[sampleIdx] = -1;
                return;
            }

            const baseOffset = host.actorRenderCount;
            const required = baseOffset + npcCount;
            if (host.actorRenderData.length / 8 < required) {
                const newData = new Uint16Array(Math.ceil((required * 2) / 16) * 16 * 8);
                newData.set(host.actorRenderData);
                host.actorRenderData = newData;
            }

            map.npcDataTextureOffsets[sampleIdx] = baseOffset;

            for (let i = 0; i < npcCount; i++) {
                const id = ids[i] | 0;
                const offset = (baseOffset + i) * 8;
                if (!host.shouldRenderNpcFromMap(map, id)) {
                    host.actorRenderData[offset + 0] = 0;
                    host.actorRenderData[offset + 1] = 0;
                    host.actorRenderData[offset + 2] = 0;
                    host.actorRenderData[offset + 3] = 0;
                    host.actorRenderData[offset + 4] = 0;
                    host.actorRenderData[offset + 5] = 0;
                    host.actorRenderData[offset + 6] = 0;
                    host.actorRenderData[offset + 7] = 0;
                    continue;
                }
                const npcWorldViewId = ecs.getWorldViewId(id) | 0;
                let npcX: number;
                let npcY: number;
                if (overlayView && (npcWorldViewId | 0) === (overlayView.id | 0)) {
                    npcX = (ecs.getWorldX(id) - renderBaseTileX * 128) | 0;
                    npcY = (ecs.getWorldY(id) - renderBaseTileY * 128) | 0;
                } else {
                    // NPC geometry ownership can lag one map refresh behind ECS ownership while an NPC
                    // crosses a 64x64 map-square boundary. Convert from world space back into the
                    // currently drawn map so the existing draw batch remains stable until refresh.
                    npcX = ecs.getLocalXForMap(id, map.mapX);
                    npcY = ecs.getLocalYForMap(id, map.mapY);
                }
                const localTileX = clamp((npcX >> 7) | 0, 0, Math.max(0, mapTileSpan - 1));
                const localTileY = clamp((npcY >> 7) | 0, 0, Math.max(0, mapTileSpan - 1));
                const renderPlane = resolveHeightSamplePlaneForLocal(
                    map,
                    ecs.getLevel(id) | 0,
                    localTileX,
                    localTileY,
                );
                // Texel 0: position, plane|rotation, interactionId
                host.actorRenderData[offset + 0] = npcX;
                host.actorRenderData[offset + 1] = npcY;
                host.actorRenderData[offset + 2] = renderPlane | (ecs.getRotation(id) << 2);
                host.actorRenderData[offset + 3] = ecs.getServerId(id);
                // Texel 1: per-actor HSL override
                const npcOverride = ecs.getColorOverride(id);
                const clientCycle = getClientCycle() | 0;
                if (
                    npcOverride.amount !== 0 &&
                    clientCycle >= npcOverride.startCycle &&
                    clientCycle < npcOverride.endCycle
                ) {
                    host.actorRenderData[offset + 4] =
                        (npcOverride.hue & 0x7f) | ((npcOverride.sat & 0x7f) << 7);
                    host.actorRenderData[offset + 5] =
                        (npcOverride.lum & 0x7f) | ((npcOverride.amount & 0xff) << 7);
                } else {
                    host.actorRenderData[offset + 4] = 0;
                    host.actorRenderData[offset + 5] = 0;
                }
                host.actorRenderData[offset + 6] = 0;
                host.actorRenderData[offset + 7] = 0;
            }

            host.actorRenderCount = required;
        }
    
}

export function addUnbatchedNpcRenderData(host: WebGLOsrsRendererHost): void {

        const entries = host.unbatchedNpcRenderEntries;
        entries.length = 0;
        if (!host.unifiedActorData || !host.loadNpcs) return;

        const ecs = host.osrsClient.npcEcs;
        const batchedIds = new Set<number>();
        for (let i = 0; i < host.mapManager.visibleMapCount; i++) {
            const map = host.mapManager.visibleMaps[i];
            const ids = map?.npcEntityIds;
            if (!map?.drawCallNpc || !ids) continue;
            for (const id of ids) {
                if (host.shouldRenderNpcFromMap(map, id | 0)) batchedIds.add(id | 0);
            }
        }

        for (const idRaw of ecs.getServerLinkedEcsIds()) {
            const ecsId = idRaw | 0;
            if (batchedIds.has(ecsId) || (ecs.getWorldViewId(ecsId) | 0) >= 0) continue;
            if (!host.getEffectiveNpcType(ecs.getNpcTypeId(ecsId) | 0)) continue;

            const ownerMapX = ecs.getMapX(ecsId) | 0;
            const ownerMapY = ecs.getMapY(ecsId) | 0;
            let map: WebGLMapSquare | undefined;
            for (let i = 0; i < host.mapManager.visibleMapCount; i++) {
                const candidate = host.mapManager.visibleMaps[i];
                if (
                    (candidate.mapX | 0) === ownerMapX &&
                    (candidate.mapY | 0) === ownerMapY
                ) {
                    map = candidate;
                    break;
                }
            }
            if (!map) continue;

            const dataOffset = host.actorRenderCount | 0;
            const required = dataOffset + 1;
            if (host.actorRenderData.length / 8 < required) {
                const newData = new Uint16Array(Math.ceil((required * 2) / 16) * 16 * 8);
                newData.set(host.actorRenderData);
                host.actorRenderData = newData;
            }

            const offset = dataOffset * 8;
            const npcX = ecs.getLocalXForMap(ecsId, map.mapX) | 0;
            const npcY = ecs.getLocalYForMap(ecsId, map.mapY) | 0;
            const mapTileSpan = map.getLocalTileSpan();
            const localTileX = clamp((npcX >> 7) | 0, 0, Math.max(0, mapTileSpan - 1));
            const localTileY = clamp((npcY >> 7) | 0, 0, Math.max(0, mapTileSpan - 1));
            const renderPlane = resolveHeightSamplePlaneForLocal(
                map,
                ecs.getLevel(ecsId) | 0,
                localTileX,
                localTileY,
            );

            host.actorRenderData[offset + 0] = npcX;
            host.actorRenderData[offset + 1] = npcY;
            host.actorRenderData[offset + 2] = renderPlane | (ecs.getRotation(ecsId) << 2);
            host.actorRenderData[offset + 3] = ecs.getServerId(ecsId);

            const npcOverride = ecs.getColorOverride(ecsId);
            const clientCycle = getClientCycle() | 0;
            if (
                npcOverride.amount !== 0 &&
                clientCycle >= npcOverride.startCycle &&
                clientCycle < npcOverride.endCycle
            ) {
                host.actorRenderData[offset + 4] =
                    (npcOverride.hue & 0x7f) | ((npcOverride.sat & 0x7f) << 7);
                host.actorRenderData[offset + 5] =
                    (npcOverride.lum & 0x7f) | ((npcOverride.amount & 0xff) << 7);
            } else {
                host.actorRenderData[offset + 4] = 0;
                host.actorRenderData[offset + 5] = 0;
            }
            host.actorRenderData[offset + 6] = 0;
            host.actorRenderData[offset + 7] = 0;

            host.actorRenderCount = required;
            entries.push({ map, ecsId, dataOffset });
        }

}

export function addPlayerRenderData(host: WebGLOsrsRendererHost, map: WebGLMapSquare) {

        host.playerRenderer.addPlayerRenderData(map);
    
}

export function addProjectileRenderData(host: WebGLOsrsRendererHost, map: WebGLMapSquare) {

        if (!host.projectileManager) return;

        const projectiles = host.projectileManager.getProjectilesForMap(map.mapX, map.mapY);
        const projCount = projectiles.length;
        const key = `${map.mapX},${map.mapY}`;
        const prevCount = host.projectileRenderDebugCounts.get(key) ?? 0;
        if (prevCount !== projCount) {
            /*console.info(
                `[ProjectileRenderer] Map (${map.mapX}, ${map.mapY}) render queue changed from ${prevCount} to ${projCount}`,
            );*/
            host.projectileRenderDebugCounts.set(key, projCount);
        }

        if (projCount === 0) {
            if (map.projectileDataTextureOffsets) {
                map.projectileDataTextureOffsets[0] = -1;
            }
            return;
        }

        // Store the starting offset for this map's projectiles
        const baseOffset = host.actorRenderCount;
        const required = baseOffset + projCount;

        // Ensure buffer capacity (8 uint16s per entry = 2 texels - shared with NPCs/Players)
        if (required * 8 > host.actorRenderData.length) {
            const newCap = Math.max(required * 8, host.actorRenderData.length * 2);
            const newBuf = new Uint16Array(newCap);
            newBuf.set(host.actorRenderData);
            host.actorRenderData = newBuf;
        }

        // Store base offset for rendering
        if (!map.projectileDataTextureOffsets) {
            map.projectileDataTextureOffsets = new Array(2);
        }
        map.projectileDataTextureOffsets[0] = baseOffset;

        // Write projectile data
        const mapWorldX = map.mapX << 13;
        const mapWorldY = map.mapY << 13;

        for (let i = 0; i < projCount; i++) {
            const proj = projectiles[i];
            const offset = (baseOffset + i) * 8;
            const pos = proj.getPosition();

            // Convert from 128-unit coordinates to sub-tile coordinates (relative to map)
            // Map coords are in world 128-units, need to make them relative to this map square
            const relativeXf = pos.x - mapWorldX;
            const relativeYf = pos.y - mapWorldY;
            const baseRelativeX = Math.floor(relativeXf);
            const baseRelativeY = Math.floor(relativeYf);

            const localTileX = clamp((baseRelativeX >> 7) | 0, 0, 63);
            const localTileY = clamp((baseRelativeY >> 7) | 0, 0, 63);
            const renderPlane = resolveHeightSamplePlaneForLocal(
                map,
                proj.plane | 0,
                localTileX,
                localTileY,
            );

            // Get rotation (yaw, pitch, and roll in OSRS units 0-2047)
            const rotation = proj.getRotation();
            const yawOsrs = (rotation.yaw & 2047) | 0; // Clamp to 0-2047
            const pitchOsrs = (rotation.pitch & 2047) | 0; // Clamp to 0-2047
            const rollOsrs = (rotation.roll & 2047) | 0; // Clamp to 0-2047

            // Pack angles: pitch gets 7 bits (original precision), roll gets 3 bits, projectileId gets 9 bits
            const pitchShifted = (pitchOsrs >> 4) & 0x7f; // 7 bits for pitch (128 values, 16-unit precision)
            const pitchHi = (pitchShifted >> 4) & 0x7; // 3 high bits
            const pitchLo = pitchShifted & 0xf; // 4 low bits
            const rollShifted = (rollOsrs >> 8) & 0x7; // 3 bits for roll (8 values, 256-unit precision)

            const plane = renderPlane & 0x3;

            // Texel 0: position, rotation, projectile ID
            host.actorRenderData[offset + 0] = baseRelativeX & 0xffff;
            host.actorRenderData[offset + 1] = baseRelativeY & 0xffff;
            host.actorRenderData[offset + 2] = (plane | (yawOsrs << 2) | (pitchHi << 13)) & 0xffff;
            host.actorRenderData[offset + 3] =
                ((proj.projectileId & 0x1ff) | (pitchLo << 9) | (rollShifted << 13)) & 0xffff;
            // Texel 1: unused for projectiles
            host.actorRenderData[offset + 4] = 0;
            host.actorRenderData[offset + 5] = 0;
            host.actorRenderData[offset + 6] = 0;
            host.actorRenderData[offset + 7] = 0;
        }

        host.actorRenderCount = required;
    
}

export function addWorldGfxRenderData(host: WebGLOsrsRendererHost, map: WebGLMapSquare): void {

        if (!host.gfxManager) return;
        const instances = host.gfxManager.listWorldInstancesForMap(map.mapX, map.mapY);
        // Always use slot 0 for double-buffered actor data
        const sampleIdx = 0;
        if (instances.length === 0) {
            map.worldGfxDataTextureOffsets[sampleIdx] = -1;
            return;
        }
        const baseOffset = host.actorRenderCount;
        const required = baseOffset + instances.length;
        if (host.actorRenderData.length / 8 < required) {
            const newData = new Uint16Array(Math.ceil((required * 2) / 16) * 16 * 8);
            newData.set(host.actorRenderData);
            host.actorRenderData = newData;
        }
        map.worldGfxDataTextureOffsets[sampleIdx] = baseOffset;
        const mapBaseX = map.mapX * 64;
        const mapBaseY = map.mapY * 64;
        for (let i = 0; i < instances.length; i++) {
            const inst = instances[i];
            const world = inst.world;
            if (!world) continue;
            const worldX = (world.tileX | 0) * 128 + 64;
            const worldY = (world.tileY | 0) * 128 + 64;
            const localX = worldX - mapBaseX * 128;
            const localY = worldY - mapBaseY * 128;
            const localTileX = clamp((world.tileX | 0) - mapBaseX, 0, 63);
            const localTileY = clamp((world.tileY | 0) - mapBaseY, 0, 63);
            const renderPlane = resolveHeightSamplePlaneForLocal(
                map,
                world.level | 0,
                localTileX,
                localTileY,
            );
            const offset = (baseOffset + i) * 8;
            host.actorRenderData[offset + 0] = localX;
            host.actorRenderData[offset + 1] = localY;
            host.actorRenderData[offset + 2] = renderPlane;
            host.actorRenderData[offset + 3] = 0;
            // Texel 1: HSL override (zeroed — world GFX have no actor override)
            host.actorRenderData[offset + 4] = 0;
            host.actorRenderData[offset + 5] = 0;
            host.actorRenderData[offset + 6] = 0;
            host.actorRenderData[offset + 7] = 0;
            world.mapId = map.id;
            world.slot = i;
        }
        host.actorRenderCount = required;
    
}
