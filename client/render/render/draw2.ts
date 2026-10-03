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

export function updateActorDataTexture(host: WebGLOsrsRendererHost, ) {

        const texWidth = 16;
        // 2 texels per actor (position + HSL override data)
        const texelCount = host.actorRenderCount * 2;
        const texHeight = Math.max(Math.ceil(texelCount / texWidth), 1);

        // PicoGL allocates immutable storage via texStorage2D, so the upload buffer must be large enough
        // for the full texture (including padding to the 16-wide grid), not just actorRenderCount entries.
        const requiredU16 = texWidth * texHeight * 4;
        if (host.actorRenderData.length < requiredU16) {
            const newData = new Uint16Array(requiredU16);
            newData.set(host.actorRenderData);
            host.actorRenderData = newData;
        }
        // Ensure padding texels (up to the next 16-wide row) don't leak stale values.
        const writtenU16 = (host.actorRenderCount * 8) | 0;
        if (writtenU16 < requiredU16) {
            host.actorRenderData.fill(0, writtenU16, requiredU16);
        }

        // Compute checksum over actual actor data to detect changes
        let checksum = host.actorRenderCount | 0;
        const data = host.actorRenderData;
        const len = writtenU16 | 0;
        for (let i = 0; i < len; i++) {
            checksum = (checksum * 31 + data[i]) | 0;
        }

        // If data hasn't changed and texture size matches, reuse current texture
        const currentTex = host.actorDataTextures[host.actorDataCurrentIndex];
        if (
            checksum === host.actorDataChecksum &&
            texHeight === host.actorDataLastTexHeight &&
            currentTex
        ) {
            // Keep legacy buffer in sync for any code that references it
            host.actorDataTextureBuffer[0] = currentTex;
            return 0;
        }

        // Data changed - write to the OTHER texture, then swap
        host.actorDataChecksum = checksum;
        host.actorDataLastTexHeight = texHeight;

        const writeIndex = 1 - host.actorDataCurrentIndex;
        const uploadView = host.actorRenderData.subarray(0, requiredU16);

        let writeTex = host.actorDataTextures[writeIndex];
        if (!writeTex) {
            writeTex = host.app.createTexture2D(uploadView, texWidth, texHeight, {
                internalFormat: PicoGL.RGBA16UI,
                type: PicoGL.UNSIGNED_SHORT,
                minFilter: PicoGL.NEAREST,
                magFilter: PicoGL.NEAREST,
                wrapS: PicoGL.CLAMP_TO_EDGE,
                wrapT: PicoGL.CLAMP_TO_EDGE,
            });
            host.actorDataTextures[writeIndex] = writeTex;
        } else {
            writeTex.resize(texWidth, texHeight);
            writeTex.data(uploadView);
        }

        // Swap: the texture we just wrote becomes the current one
        host.actorDataCurrentIndex = writeIndex;

        // Keep legacy buffer in sync for any code that references it
        host.actorDataTextureBuffer[0] = writeTex;
        return 0;
    
}

export function _accumulate(host: WebGLOsrsRendererHost, drawRanges: DrawRange[], length?: number): void {

        // Count batches and indices
        const len = length ?? drawRanges.length;
        host._frameBatches += len;
        for (let i = 0; i < len; i++) {
            const r = drawRanges[i] as DrawRange;
            const count = (r?.[1] ?? 0) * (r?.[2] ?? 1);
            host._frameIndices += count;
        }
    
}

export function configureDrawCall(host: WebGLOsrsRendererHost, drawCall: DrawCall): DrawCall {
        host.osrsClient.clientPlugins.configureSceneDrawCall(host, drawCall);
        return host.drawBackend ? host.drawBackend.configureDrawCall(drawCall) : drawCall;
    
}

export function draw(host: WebGLOsrsRendererHost, drawCall: DrawCall, drawRanges: DrawRange[], drawIndices?: number[]) {
        host.osrsClient.clientPlugins.configureSceneDrawCall(host, drawCall);
        // Accumulate stats regardless of draw path
        if (drawIndices && drawIndices.length > 0) {
            // Reuse buffer to avoid per-frame allocation
            const len = drawIndices.length;
            if (host.drawSubsetBuffer.length < len) {
                host.drawSubsetBuffer.length = len;
            }
            for (let i = 0; i < len; i++) host.drawSubsetBuffer[i] = drawRanges[drawIndices[i]];
            host._accumulate(host.drawSubsetBuffer, len);
        } else {
            host._accumulate(drawRanges);
        }

        if (host.drawBackend) {
            host.drawBackend.draw(drawCall, drawRanges, drawIndices);
        } else {
            drawCall.draw();
        }
    
}

export function drawWithRoofPlaneFilter(host: WebGLOsrsRendererHost, 
        drawCall: DrawCall,
        drawRanges: DrawRange[],
        drawRangePlanes: Uint8Array | undefined,
        roofPlaneLimit: number,
    ): void {

        const totalRanges = drawRanges.length | 0;
        host.frameRoofTotalRangeCount += totalRanges;
        if (totalRanges <= 0) {
            return;
        }

        if (!drawRangePlanes || roofPlaneLimit >= 3) {
            host.draw(drawCall, drawRanges);
            return;
        }

        const cullLimit = roofPlaneLimit | 0;
        const filtered = host.roofFilteredDrawIndices;
        filtered.length = 0;

        for (let i = 0; i < totalRanges; i++) {
            // Missing plane metadata should never happen, but default to visible to avoid
            // accidentally dropping geometry.
            const plane = i < drawRangePlanes.length ? drawRangePlanes[i] : 0;
            if (plane <= cullLimit) {
                filtered.push(i);
            }
        }

        const visibleRanges = filtered.length | 0;
        host.frameRoofFilteredRangeCount += Math.max(0, totalRanges - visibleRanges);
        if (visibleRanges <= 0) {
            return;
        }
        if (visibleRanges >= totalRanges) {
            host.draw(drawCall, drawRanges);
            return;
        }
        host.draw(drawCall, drawRanges, filtered);
    
}

export function getMapTileDistanceFromPoint(host: WebGLOsrsRendererHost, map: WebGLMapSquare, tileX: number, tileY: number): number {

        // Boat decks are built in their own deck coordinates and drawn through a movement
        // transform, so their render base says nothing about where they appear. They are
        // always around the player, so treat them as at distance 0.
        if (host.mapManager.worldEntityMapIds.has(map.id)) return 0;
        const mapMinTileX = map.getRenderBaseTileX();
        const mapMinTileY = map.getRenderBaseTileY();
        const mapTileSpan = map.getLocalTileSpan();
        const mapMaxTileX = mapMinTileX + mapTileSpan - 1;
        const mapMaxTileY = mapMinTileY + mapTileSpan - 1;
        const dx =
            tileX < mapMinTileX
                ? mapMinTileX - tileX
                : tileX > mapMaxTileX
                    ? tileX - mapMaxTileX
                    : 0;
        const dy =
            tileY < mapMinTileY
                ? mapMinTileY - tileY
                : tileY > mapMaxTileY
                    ? tileY - mapMaxTileY
                    : 0;
        return Math.max(dx, dy);
    
}

export function getMapZoneDistanceFromPoint(host: WebGLOsrsRendererHost, map: WebGLMapSquare, tileX: number, tileY: number): number {

        // OSRS scene visibility is zone-based (8x8 tiles), not map-square based.
        const zoneX = tileX >> 3;
        const zoneY = tileY >> 3;
        const bwx = (map as any).baseWorldX;
        const bwy = (map as any).baseWorldY;
        const mapMinZoneX = bwx != null ? (bwx | 0) >> 3 : map.mapX << 3;
        const mapMinZoneY = bwy != null ? (bwy | 0) >> 3 : map.mapY << 3;
        const mapMaxZoneX = mapMinZoneX + 7;
        const mapMaxZoneY = mapMinZoneY + 7;
        const dx =
            zoneX < mapMinZoneX
                ? mapMinZoneX - zoneX
                : zoneX > mapMaxZoneX
                    ? zoneX - mapMaxZoneX
                    : 0;
        const dy =
            zoneY < mapMinZoneY
                ? mapMinZoneY - zoneY
                : zoneY > mapMaxZoneY
                    ? zoneY - mapMaxZoneY
                    : 0;
        return Math.max(dx, dy);
    
}

export function isMapWithinRenderDistance(host: WebGLOsrsRendererHost, 
        map: WebGLMapSquare,
        tileX: number,
        tileY: number,
        renderDistanceTiles: number,
        renderDistancePadTiles: number,
    ): boolean {

        // See getMapTileDistanceFromPoint: boat decks are always in range.
        if (host.mapManager.worldEntityMapIds.has(map.id)) return true;
        const zoneDistance = host.getMapZoneDistanceFromPoint(map, tileX, tileY);
        const renderDistanceZones = Math.max(
            0,
            Math.ceil((renderDistanceTiles + renderDistancePadTiles) / 8),
        );
        return zoneDistance <= renderDistanceZones;
    
}

export function resolveEffectiveRenderDistanceTiles(host: WebGLOsrsRendererHost, frameId: number): number {

        const base = clamp(host.osrsClient.renderDistance | 0, 25, 90);
        if ((host.effectiveRenderDistanceFrame | 0) === (frameId | 0)) {
            return host.effectiveRenderDistanceTiles | 0;
        }
        const profile = host.syncBrowserQualityProfile();
        const target = isTouchDevice ? Math.min(base, profile.renderDistanceCap | 0) : base;
        host.effectiveRenderDistanceTiles = Math.max(0, target | 0);
        host.effectiveRenderDistanceFrame = frameId | 0;
        return host.effectiveRenderDistanceTiles | 0;
    
}

export function getFrameRenderDistanceTiles(host: WebGLOsrsRendererHost, ): number {

        return host.resolveEffectiveRenderDistanceTiles(host.stats.frameCount | 0);
    
}

export function getFrameLodThresholdTiles(host: WebGLOsrsRendererHost, ): number {

        return host.resolveEffectiveLodThresholdTiles(host.stats.frameCount | 0);
    
}

export function resolveEffectiveGroundItemOverlayMaxEntries(host: WebGLOsrsRendererHost, frameId: number): number {

        if ((host.effectiveGroundItemOverlayFrame | 0) === (frameId | 0)) {
            return host.effectiveGroundItemOverlayMaxEntries | 0;
        }
        const profile = host.syncBrowserQualityProfile();
        const target = isTouchDevice ? profile.groundItemOverlayMaxEntries | 0 : 40;
        host.effectiveGroundItemOverlayMaxEntries = target;
        host.effectiveGroundItemOverlayFrame = frameId | 0;
        return target;
    
}

export function getFrameGroundItemOverlayMaxEntries(host: WebGLOsrsRendererHost, ): number {

        return host.resolveEffectiveGroundItemOverlayMaxEntries(host.stats.frameCount | 0);
    
}

export function resolveEffectiveGroundItemOverlayRadius(host: WebGLOsrsRendererHost, frameId: number): number {

        if ((host.effectiveGroundItemOverlayRadiusFrame | 0) === (frameId | 0)) {
            return host.effectiveGroundItemOverlayRadius | 0;
        }
        const profile = host.syncBrowserQualityProfile();
        const target = isTouchDevice ? profile.groundItemOverlayRadius | 0 : 12;
        host.effectiveGroundItemOverlayRadius = target;
        host.effectiveGroundItemOverlayRadiusFrame = frameId | 0;
        return target;
    
}

export function getFrameGroundItemOverlayRadius(host: WebGLOsrsRendererHost, ): number {

        return host.resolveEffectiveGroundItemOverlayRadius(host.stats.frameCount | 0);
    
}

export function getFrameHitsplatMaxEntries(host: WebGLOsrsRendererHost, ): number {

        if (!isTouchDevice) return RENDER_CONSTANTS.MAX_HIT_ENTRIES;
        return host.syncBrowserQualityProfile().hitsplatMaxEntries | 0;
    
}

export function getFrameHealthBarMaxEntries(host: WebGLOsrsRendererHost, ): number {

        if (!isTouchDevice) return 256;
        return host.syncBrowserQualityProfile().healthBarMaxEntries | 0;
    
}

export function getFrameOverheadTextMaxEntries(host: WebGLOsrsRendererHost, ): number {

        if (!isTouchDevice) return 256;
        return host.syncBrowserQualityProfile().overheadTextMaxEntries | 0;
    
}

export function getFrameOverheadPrayerMaxEntries(host: WebGLOsrsRendererHost, ): number {

        if (!isTouchDevice) return 256;
        return host.syncBrowserQualityProfile().overheadPrayerMaxEntries | 0;
    
}

export function updateAnimatedDrawRanges(host: WebGLOsrsRendererHost, 
        map: WebGLMapSquare,
        drawCall: DrawCall,
        drawRanges: DrawRange[],
        transparent: boolean,
        isInteract: boolean,
        isLod: boolean,
    ): void {

        if (!map.locsAnimated.length) {
            return;
        }

        for (const loc of map.locsAnimated) {
            const frames = transparent ? loc.anim.framesAlpha : loc.anim.frames;
            if (!frames) {
                continue;
            }

            const frame = frames[loc.frame | 0];
            if (!frame) {
                continue;
            }

            const index = loc.getDrawRangeIndex(transparent, isInteract, isLod);
            if (index === -1) {
                continue;
            }

            drawCall.offsets[index] = frame[0];
            (drawCall as any).numElements[index] = frame[1];
            drawRanges[index] = frame;
        }
    
}
