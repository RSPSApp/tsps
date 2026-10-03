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

export function onLocChange(host: WebGLOsrsRendererHost, 
        oldId: number,
        newId: number,
        tile: { x: number; y: number },
        level: number,
        opts?: {
            oldTile?: { x: number; y: number };
            newTile?: { x: number; y: number };
            oldRotation?: number;
            newRotation?: number;
            newShape?: number;
        },
    ): void {

        try {
            console.log(
                `[WebGLRenderer] Loc change: ${oldId} -> ${newId} at (${tile.x}, ${tile.y}, ${level})`,
            );

            const oldTile = opts?.oldTile ?? tile;
            const newTile = opts?.newTile;
            const oldLocType =
                (oldId | 0) > 0 ? host.osrsClient.locTypeLoader.load(oldId | 0) : undefined;
            const newLocType =
                (newId | 0) > 0 ? host.osrsClient.locTypeLoader.load(newId | 0) : undefined;
            const hasUnknownLocType =
                ((oldId | 0) > 0 && oldLocType === undefined) ||
                ((newId | 0) > 0 && newLocType === undefined);
            const oldIsDoor = oldLocType !== undefined && isDoorLocType(oldLocType);
            const newIsDoor = newLocType !== undefined && isDoorLocType(newLocType);
            // Keeping doors and ordinary locs in separate GPU groups lets us
            // match the game's partial loc-update behaviour. A change that
            // crosses those groups retains the conservative full rebuild.
            const isDoorOnlyUpdate =
                !hasUnknownLocType &&
                (oldId <= 0 || oldIsDoor) &&
                (newId <= 0 || newIsDoor) &&
                (oldIsDoor || newIsDoor);
            const isLocOnlyUpdate = !hasUnknownLocType && !oldIsDoor && !newIsDoor;
            const matchesChangedTile = (target: {
                tileX: number;
                tileY: number;
                plane: number;
            }): boolean => {
                if ((target.plane | 0) !== (level | 0)) return false;
                if (
                    (target.tileX | 0) === (oldTile.x | 0) &&
                    (target.tileY | 0) === (oldTile.y | 0)
                ) {
                    return true;
                }
                if (
                    newTile &&
                    (target.tileX | 0) === (newTile.x | 0) &&
                    (target.tileY | 0) === (newTile.y | 0)
                ) {
                    return true;
                }
                return false;
            };

            if (
                host.interactHighlightActiveTarget?.kind === "loc" &&
                matchesChangedTile(host.interactHighlightActiveTarget)
            ) {
                host.clearInteractHighlightActiveTarget();
            }
            if (
                host.interactHighlightHoverTarget?.kind === "loc" &&
                matchesChangedTile(host.interactHighlightHoverTarget)
            ) {
                host.clearInteractHighlightHoverTarget();
            }
            const overrideRotation =
                typeof opts?.newRotation === "number" ? opts.newRotation & 0x3 : undefined;

            const spawnKey = `${oldTile.x | 0},${oldTile.y | 0},${level | 0}`;
            const existingSpawn = host.locSpawns.get(spawnKey);
            // Use locSpawns for: locs spawned on empty ground (oldId===0) or ongoing lifecycle of a spawned loc
            const isSpawnedLoc =
                (oldId | 0) === 0 ||
                (existingSpawn !== undefined && existingSpawn.id === (oldId | 0));

            const clearOverridesAtTile = (tileX: number, tileY: number): void => {
                const keyPrefix = `${tileX | 0},${tileY | 0},${level},`;
                for (const key of Array.from(host.locOverrides.keys())) {
                    if (key.startsWith(keyPrefix)) {
                        host.locOverrides.delete(key);
                    }
                }
            };
            clearOverridesAtTile(oldTile.x, oldTile.y);
            if (newTile) {
                clearOverridesAtTile(newTile.x, newTile.y);
            }

            if (isSpawnedLoc) {
                // Manage via locSpawns
                if ((newId | 0) === 0) {
                    host.locSpawns.delete(spawnKey);
                } else {
                    // Use the shape from the server (matches loc_add_change_v2 OSRS packet),
                    // or inherit from the existing spawn, or default to NORMAL (10).
                    const spawnType =
                        typeof opts?.newShape === "number"
                            ? (opts.newShape as LocModelType)
                            : (existingSpawn?.type ?? LocModelType.NORMAL);
                    host.locSpawns.set(spawnKey, {
                        id: newId | 0,
                        type: spawnType,
                        rotation: overrideRotation ?? 0,
                    });
                }
            } else {
                // Regular map loc override
                const overrideKey = `${oldTile.x},${oldTile.y},${level},${oldId}`;
                host.locOverrides.set(overrideKey, {
                    newId: newId | 0,
                    newRotation: overrideRotation,
                    moveToX:
                        newTile &&
                        ((newTile.x | 0) !== (oldTile.x | 0) || (newTile.y | 0) !== (oldTile.y | 0))
                            ? newTile.x | 0
                            : undefined,
                    moveToY:
                        newTile &&
                        ((newTile.x | 0) !== (oldTile.x | 0) || (newTile.y | 0) !== (oldTile.y | 0))
                            ? newTile.y | 0
                            : undefined,
                });
            }

            // Moving locs can cross map-square boundaries (e.g., edge gates).
            // Reload both affected map squares so moved geometry can appear on the new side.
            const oldMapX = Math.floor(oldTile.x / 64);
            const oldMapY = Math.floor(oldTile.y / 64);
            const newMapX = Math.floor((newTile?.x ?? oldTile.x) / 64);
            const newMapY = Math.floor((newTile?.y ?? oldTile.y) / 64);
            const mapKeys = new Set<string>([`${oldMapX}:${oldMapY}`, `${newMapX}:${newMapY}`]);

            for (const mapKey of mapKeys) {
                const [mxRaw, myRaw] = mapKey.split(":");
                const mx = Number(mxRaw) | 0;
                const my = Number(myRaw) | 0;
                const mapId = getMapSquareId(mx, my);
                if (
                    isDoorOnlyUpdate &&
                    !host.pendingLocUpdates.has(mapId) &&
                    !host.pendingLocGeometryUpdates.has(mapId)
                ) {
                    host.pendingDoorLocUpdates.add(mapId);
                } else if (
                    isLocOnlyUpdate &&
                    !host.pendingLocUpdates.has(mapId) &&
                    !host.pendingDoorLocUpdates.has(mapId)
                ) {
                    host.pendingLocGeometryUpdates.add(mapId);
                } else {
                    host.pendingLocUpdates.add(mapId);
                    host.pendingLocGeometryUpdates.delete(mapId);
                    host.pendingDoorLocUpdates.delete(mapId);
                }
                host.scheduleLocReload(mx, my);
            }

            const mapSummary = [...mapKeys]
                .map((entry) => {
                    const [mxRaw, myRaw] = entry.split(":");
                    return `(${Number(mxRaw) | 0}, ${Number(myRaw) | 0})`;
                })
                .join(", ");
            console.log(`Refreshing map square(s) ${mapSummary} via loc geometry refresh`);
        } catch (err) {
            console.warn("onLocChange error", err);
        }
    
}

export function getExtraLocsForMap(host: WebGLOsrsRendererHost, 
        mapX: number,
        mapY: number,
    ):
        | Array<{
        id: number;
        x: number;
        y: number;
        level: number;
        shape: number;
        rotation: number;
    }>
        | undefined {

        if (host.addedLocs.size === 0) return undefined;
        const minX = mapX * 64;
        const minY = mapY * 64;
        const maxX = minX + 64;
        const maxY = minY + 64;
        const locs: Array<{
            id: number;
            x: number;
            y: number;
            level: number;
            shape: number;
            rotation: number;
        }> = [];
        for (const loc of host.addedLocs.values()) {
            if (loc.x >= minX && loc.x < maxX && loc.y >= minY && loc.y < maxY) {
                locs.push({
                    id: loc.locId,
                    x: loc.x,
                    y: loc.y,
                    level: loc.level,
                    shape: loc.shape,
                    rotation: loc.rotation,
                });
            }
        }
        return locs.length > 0 ? locs : undefined;
    
}

export function scheduleLocGeometryUpdate(host: WebGLOsrsRendererHost, 
        mapX: number,
        mapY: number,
        group: "loc" | "door" | "full",
    ): void {

        const mapId = getMapSquareId(mapX, mapY);
        if (
            group === "door" &&
            !host.pendingLocUpdates.has(mapId) &&
            !host.pendingLocGeometryUpdates.has(mapId)
        ) {
            host.pendingDoorLocUpdates.add(mapId);
        } else if (
            group === "loc" &&
            !host.pendingLocUpdates.has(mapId) &&
            !host.pendingDoorLocUpdates.has(mapId)
        ) {
            host.pendingLocGeometryUpdates.add(mapId);
        } else {
            host.pendingLocUpdates.add(mapId);
            host.pendingLocGeometryUpdates.delete(mapId);
            host.pendingDoorLocUpdates.delete(mapId);
        }
        host.scheduleLocReload(mapX, mapY);
    
}

export function onLocAddChange(host: WebGLOsrsRendererHost, 
        locId: number,
        tile: { x: number; y: number },
        level: number,
        shape: number,
        rotation: number,
    ): void {

        try {
            const key = `${tile.x},${tile.y},${level},${shape}`;
            const overrideKey = `${tile.x | 0},${tile.y | 0},${level | 0},-1`;
            const existing = host.addedLocs.get(key);
            const existingOverride = host.locOverrides.get(overrideKey);
            const preservesOtherShapeRemoval =
                existingOverride?.newId === 0 &&
                typeof existingOverride.matchType === "number" &&
                existingOverride.matchType !== shape;
            if (
                existing?.locId === locId &&
                existing.x === tile.x &&
                existing.y === tile.y &&
                existing.level === level &&
                existing.shape === shape &&
                existing.rotation === rotation &&
                existingOverride?.newId === 0 &&
                (existingOverride.matchType === shape || preservesOtherShapeRemoval)
            ) {
                return;
            }
            host.addedLocs.set(key, { locId, x: tile.x, y: tile.y, level, shape, rotation });

            // Suppress the base cache-baked loc at this tile so it doesn't
            // keep rendering alongside (or instead of) the new one - buildScene
            // has no other way to know a cache loc was replaced/removed.
            host.locOverrides.set(preservesOtherShapeRemoval ? `${overrideKey},${shape}` : overrideKey, {
                newId: 0,
                matchType: shape as LocModelType,
            });

            const mapX = Math.floor(tile.x / 64);
            const mapY = Math.floor(tile.y / 64);
            // Locs on a boat deck belong to that boat's scene, which is rebuilt as a whole.
            // Deck locs usually arrive after the scene itself.
            const deckView = host.osrsClient?.worldViewManager?.findWorldViewAt(tile.x, tile.y);
            if (deckView && host.worldEntityOverlays?.has(deckView.id)) {
                host.scheduleWorldEntityLocRebuild(deckView.id);
            } else if (host.instanceActive) {
                // In instance mode, schedule a deferred instance scene rebuild
                // that includes the new loc via extraLocs.
                host.scheduleInstanceLocRebuild();
            } else {
                const locType = host.osrsClient.locTypeLoader.load(locId | 0);
                host.scheduleLocGeometryUpdate(
                    mapX,
                    mapY,
                    locType && isDoorLocType(locType) ? "door" : "loc",
                );
            }
            console.log(
                `[WebGLRenderer] Loc add: ${locId} at (${tile.x}, ${tile.y}, ${level}) shape=${shape} -> map (${mapX}, ${mapY})`,
            );
        } catch (err) {
            console.warn("onLocAddChange error", err);
        }
    
}
