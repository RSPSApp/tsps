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
import type { ClientGroundItemStack } from "../../../game/data/ground/GroundItemStore";
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

export function performWorldEntryAction(host: WebGLOsrsRendererHost, 
        e: OsrsMenuEntry,
        orig: ((entry?: any, evt?: MouseEvent, ctx?: unknown) => void) | undefined,
        evt?: MouseEvent,
        tileForMenu?: { tileX: number; tileY: number; plane?: number },
        menuCtx?: MenuClickContext,
    ): void {

        const approxTile = host.osrsClient.menuTile ?? tileForMenu;
        const isLocEntry = e.targetType === MenuTargetType.LOC && typeof e.targetId === "number";
        const resolvedLocTile =
            approxTile && isLocEntry
                ? host.resolveLocInteractionTile((e.targetId as number) | 0, approxTile)
                : undefined;
        const effectiveTile = resolvedLocTile ?? approxTile;
        const shouldSkipClientWalk =
            isLocEntry && effectiveTile
                ? host.isLocalPlayerAdjacentToLoc((e.targetId as number) | 0, effectiveTile)
                : false;
        const optionLower = String(e.option || "").toLowerCase();
        const isWalk = optionLower === "walk here";
        host.onInteractHighlightEntryInvoked(
            {
                option: e.option,
                targetType: e.targetType,
                targetId: typeof e.targetId === "number" ? e.targetId | 0 : undefined,
                mapX: typeof e.mapX === "number" ? e.mapX | 0 : undefined,
                mapY: typeof e.mapY === "number" ? e.mapY | 0 : undefined,
            },
            effectiveTile,
        );
        try {
            const xy = host.toGLClickXY(evt);
            // Red cross for targeted actions; Yellow for walk
            host.spawnClickCross(effectiveTile as any, xy, isWalk ? "yellow" : "red");
        } catch {}

        const spellMeta = e.spellCast;
        console.log("[menu] Entry clicked:", {
            option: e.option,
            targetType: e.targetType,
            spellMeta,
            entry: e,
        });
        if (spellMeta) {
            try {
                const ctx: {
                    tile?: { tileX: number; tileY: number; plane?: number };
                    mapX?: number;
                    mapY?: number;
                    npcServerId?: number;
                    playerServerId?: number;
                } = { tile: effectiveTile };
                const metaMapX =
                    typeof spellMeta.mapX === "number"
                        ? spellMeta.mapX
                        : typeof e.mapX === "number"
                            ? e.mapX
                            : undefined;
                const metaMapY =
                    typeof spellMeta.mapY === "number"
                        ? spellMeta.mapY
                        : typeof e.mapY === "number"
                            ? e.mapY
                            : undefined;
                if (typeof metaMapX === "number") ctx.mapX = metaMapX;
                if (typeof metaMapY === "number") ctx.mapY = metaMapY;
                if (typeof spellMeta.npcServerId === "number")
                    ctx.npcServerId = spellMeta.npcServerId | 0;
                if (typeof spellMeta.playerServerId === "number")
                    ctx.playerServerId = spellMeta.playerServerId | 0;
                console.log("[menu] Calling castSpellFromMenu with ctx:", ctx);
                host.osrsClient.castSpellFromMenu(e, ctx);
            } catch (err) {
                console.warn?.("[menu] failed to cast spell", err);
            }
            return;
        }

        // Facing is server-authoritative via the face direction update mask.
        // Invoke original handler
        if (!menuCtx?.worldMenuStateDispatch) {
            try {
                orig?.(e as any, evt, menuCtx);
            } catch {}
        }
    
}

export function buildSimpleMenuEntries(host: WebGLOsrsRendererHost, 
        entries: OsrsMenuEntry[],
        opts: {
            shouldFreeze: boolean;
            toCssEvent: (gx?: number, gy?: number) => any;
        },
    ): SimpleMenuEntry[] {

        const client = host.osrsClient;
        if (
            opts.shouldFreeze &&
            client.menuFrozenSimpleEntries &&
            client.menuFrozenSimpleEntriesVersion === client.menuPinnedEntriesVersion
        ) {
            client.menuActiveSimpleEntries = client.menuFrozenSimpleEntries;
            return client.menuFrozenSimpleEntries;
        }
        const menuState = client.menuState;
        menuState.reset();
        const simple = worldEntriesToSimple(entries, {
            label: {
                includeExamineIds: !!host.osrsClient.debugId,
                localPlayerCombatLevel: ClientState.localPlayerCombatLevel | 0,
            },
            toCssEvent: opts.toCssEvent,
            menuState,
            registerWithState: true,
            resetMenuState: false,
        });
        client.menuActiveSimpleEntries = simple;
        if (opts.shouldFreeze) {
            client.menuFrozenSimpleEntries = simple;
            client.menuFrozenSimpleEntriesVersion = client.menuPinnedEntriesVersion;
        } else {
            client.menuFrozenSimpleEntries = undefined;
            client.menuFrozenSimpleEntriesVersion = 0;
        }
        return simple;
    
}

export function getApproxTileHeight(host: WebGLOsrsRendererHost, worldX: number, worldY: number, basePlane?: number): number {

        const resolvedBasePlane =
            basePlane ??
            (() => {
                const idx = host.osrsClient.playerEcs.getIndexForServerId(
                    host.osrsClient.controlledPlayerServerId,
                );
                return idx !== undefined ? host.osrsClient.playerEcs.getLevel(idx) : 0;
            })();

        const tileX = Math.floor(worldX);
        const tileY = Math.floor(worldY);
        const plane = host.getEffectivePlaneForTile(tileX, tileY, resolvedBasePlane);
        return host.sampleHeightAtExactPlane(worldX, worldY, plane);
    
}

export function getTileHeightAtPlane(host: WebGLOsrsRendererHost, worldX: number, worldY: number, plane: number): number {

        return host.sampleHeightAtExactPlane(worldX, worldY, plane);
    
}

export function getBridgedTileHeight(host: WebGLOsrsRendererHost, worldX: number, worldY: number, plane: number): number {

        const tileX = Math.floor(worldX);
        const tileY = Math.floor(worldY);
        const map = host.getPreferredMapForWorldTile(tileX, tileY);
        const local = map ? host.getMapLocalTile(map, tileX, tileY) : undefined;
        const samplePlane =
            map && local ? resolveHeightSamplePlaneForLocal(map, plane, local.x, local.y) : plane;
        return host.sampleHeightAtExactPlane(worldX, worldY, samplePlane);
    
}

export function getMinTileHeightInRadius(host: WebGLOsrsRendererHost, 
        worldX: number,
        worldZ: number,
        plane: number,
        radius: number,
    ): number {

        if ((radius | 0) === 0) {
            return host.getBridgedTileHeight(worldX, worldZ, plane);
        }
        const fineX = Math.round(worldX * 128) | 0;
        const fineZ = Math.round(worldZ * 128) | 0;
        const half = (radius / 2) | 0;
        const minTileX = ((fineX - half) >> 7) + 1;
        const minTileZ = ((fineZ - half) >> 7) + 1;
        const maxTileX = (fineX + half) >> 7;
        const maxTileZ = (fineZ + half) >> 7;
        let min = Infinity;
        for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
            for (let tileZ = minTileZ; tileZ <= maxTileZ; tileZ++) {
                min = Math.min(min, host.getBridgedTileHeight(tileX, tileZ, plane));
            }
        }
        min = Math.min(min, host.getBridgedTileHeight(worldX, worldZ, plane));
        min = Math.min(
            min,
            host.getBridgedTileHeight((fineX - half) / 128, (fineZ - half) / 128, plane),
        );
        min = Math.min(
            min,
            host.getBridgedTileHeight((fineX - half) / 128, (fineZ + half) / 128, plane),
        );
        min = Math.min(
            min,
            host.getBridgedTileHeight((fineX + half) / 128, (fineZ - half) / 128, plane),
        );
        return Math.min(
            min,
            host.getBridgedTileHeight((fineX + half) / 128, (fineZ + half) / 128, plane),
        );
    
}

export function getNpcFootprintRadius(host: WebGLOsrsRendererHost, npcTypeId: number | undefined): number {

        if (npcTypeId == null || npcTypeId < 0) return 0;
        try {
            const npcType = host.osrsClient.npcTypeLoader?.load?.(npcTypeId | 0);
            return npcType ? npcType.footprintSize | 0 : 0;
        } catch {
            return 0;
        }
    
}

export function getPreferredMapForWorldTile(host: WebGLOsrsRendererHost, tileX: number, tileY: number): WebGLMapSquare | undefined {

        const preferredWorldViewId = host.getControlledPlayerWorldViewId();
        if (preferredWorldViewId >= 0) {
            const preferredView =
                host.osrsClient.worldViewManager.getWorldView(preferredWorldViewId);
            if (preferredView?.containsTile(tileX | 0, tileY | 0)) {
                const overlayMap = host.osrsClient.worldViewManager.getOverlayMapSquare(
                    preferredWorldViewId,
                    host.mapManager,
                );
                if (overlayMap) {
                    return overlayMap;
                }
            }
        }
        return host.mapManager.getMapForWorldTile(tileX, tileY) as
            | WebGLMapSquare
            | undefined;
    
}

export function getMapLocalTile(host: WebGLOsrsRendererHost, 
        map: WebGLMapSquare,
        tileX: number,
        tileY: number,
    ): { x: number; y: number } | undefined {

        const mapTileSpan = map.getLocalTileSpan();
        const localX = (tileX | 0) - map.getRenderBaseTileX();
        const localY = (tileY | 0) - map.getRenderBaseTileY();
        if (localX < 0 || localY < 0 || localX >= mapTileSpan || localY >= mapTileSpan) {
            return undefined;
        }
        return { x: localX | 0, y: localY | 0 };
    
}

export function getEffectivePlaneForTile(host: WebGLOsrsRendererHost, tileX: number, tileY: number, basePlane: number): number {

        const map = host.getPreferredMapForWorldTile(tileX, tileY);
        if (map && map.interactionPlane >= 0) return map.interactionPlane;
        const local = map ? host.getMapLocalTile(map, tileX, tileY) : undefined;
        if (!map || !local) {
            return resolveInteractionPlaneForWorldTile(host.mapManager, basePlane, tileX, tileY);
        }
        return resolveInteractionPlaneForLocal(map, basePlane, local.x, local.y);
    
}

export function getHeightSamplePlaneForTile(host: WebGLOsrsRendererHost, tileX: number, tileY: number, basePlane: number): number {

        const map = host.getPreferredMapForWorldTile(tileX, tileY);
        if (map && map.interactionPlane >= 0) return map.interactionPlane;
        const local = map ? host.getMapLocalTile(map, tileX, tileY) : undefined;
        if (!map || !local) {
            return basePlane | 0;
        }
        return resolveHeightSamplePlaneForLocal(map, basePlane, local.x, local.y);
    
}

export function getOccupancyPlaneForTile(host: WebGLOsrsRendererHost, tileX: number, tileY: number, basePlane: number): number {

        const map = host.getPreferredMapForWorldTile(tileX, tileY);
        const local = map ? host.getMapLocalTile(map, tileX, tileY) : undefined;
        if (!map || !local) {
            return resolveCollisionSamplePlaneForWorldTile(
                host.mapManager,
                basePlane,
                tileX,
                tileY,
            );
        }
        return resolveCollisionSamplePlaneForLocal(map, basePlane, local.x, local.y);
    
}
