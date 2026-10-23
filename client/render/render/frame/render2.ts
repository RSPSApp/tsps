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
import { hasSunkenLocs, sunkenRangeIndices } from "../../loc/SunkenLocs";
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

export function renderGeometryPass(host: WebGLOsrsRendererHost, transparent: boolean): void {

        const roofPlaneLimit = host.getRoofPlaneLimit();
        const cullTile = host.getRenderCullTile();

        const shadow = !!host.hdShadowFrustum;
        // Shadow casters use the light volume, including loaded off-screen maps.
        const maps = shadow ? Array.from(host.mapManager.mapSquares.values()).filter(map => map.canRender(host.stats.frameCount)) : host.mapManager.visibleMaps;
        const count = shadow ? maps.length : host.mapManager.visibleMapCount;
        if (count === 0) {
            if (!transparent && !shadow) {
                host.lastLodVisibleMapCount = 0;
                host.lastFullDetailVisibleMapCount = 0;
                host.lastDistanceCulledVisibleMapCount = 0;
            }
            return;
        }

        const start = transparent ? count - 1 : 0;
        const end = transparent ? -1 : count;
        const step = transparent ? -1 : 1;
        const renderDistanceTiles = Math.max(0, host.getFrameRenderDistanceTiles() | 0);
        const renderDistancePadTiles = 0;
        // LOD threshold in tiles from player tile to map bounds.
        const lodThresholdTiles = Math.max(0, host.getFrameLodThresholdTiles() | 0);
        let lodVisibleMapCount = 0;
        let fullDetailVisibleMapCount = 0;
        let distanceCulledVisibleMapCount = 0;

        for (let i = start; i !== end; i += step) {
            const map = maps[i];
            const tileDistance = host.getMapTileDistanceFromPoint(map, cullTile.x, cullTile.y);
            if (
                !shadow && !host.isMapWithinRenderDistance(
                    map,
                    cullTile.x,
                    cullTile.y,
                    renderDistanceTiles,
                    renderDistancePadTiles,
                )
            ) {
                distanceCulledVisibleMapCount++;
                continue;
            }

            // GPU interaction readback removed - always use non-interact draw calls
            const isInteract = false;
            const mapLod = tileDistance > lodThresholdTiles;
            if (mapLod) {
                lodVisibleMapCount++;
            } else {
                fullDetailVisibleMapCount++;
            }

            const isWorldEntity = host.mapManager.worldEntityMapIds.has(map.id);
            // Full and cached far ranges share the same 8-tile chunk identities.
            // The shared range filter selects exactly one mesh for each chunk.
            for (let detail = 0; detail < (shadow || isWorldEntity ? 1 : 2); detail++) {
                const isLod = !shadow && !isWorldEntity && (transparent ? detail === 0 : detail === 1);
                const { drawCall, drawRanges } = map.getDrawCall(transparent, isInteract, isLod);
                const drawRangePlanes = map.getDrawRangesPlanes(transparent, isInteract, isLod);

                let weTransform: Float32Array = WebGLMapSquare.IDENTITY_MAT4;
                let weEntityIndex: number | undefined;
                if (isWorldEntity) {
                    weEntityIndex = host.getWorldEntityIndexForMapId(map.id);
                    if (weEntityIndex !== undefined) {
                        weTransform =
                            host.worldEntityAnimator?.getTransform(weEntityIndex) ??
                            WebGLMapSquare.IDENTITY_MAT4;
                    }
                }

                drawCall.uniform("u_roofPlaneLimit", roofPlaneLimit);
                drawCall.uniform("u_worldEntityTransform", weTransform);
                drawCall.uniform("u_worldEntityOpacity", 1.0);

                host.drawWithRoofPlaneFilter(drawCall, drawRanges, drawRangePlanes, roofPlaneLimit, map, isLod);

                const locBatch = map.getLocDrawCall(transparent, isInteract, isLod);
                if (locBatch) {
                    const locDrawRangePlanes = map.getLocDrawRangesPlanes(
                        transparent,
                        isInteract,
                        isLod,
                    );
                    locBatch.drawCall.uniform("u_roofPlaneLimit", roofPlaneLimit);
                    locBatch.drawCall.uniform("u_worldEntityTransform", weTransform);
                    locBatch.drawCall.uniform("u_worldEntityOpacity", 1.0);
                    host.updateAnimatedDrawRanges(
                        map,
                        locBatch.drawCall,
                        locBatch.drawRanges,
                        transparent,
                        isInteract,
                        isLod,
                    );
                    host.drawWithRoofPlaneFilter(
                        locBatch.drawCall,
                        locBatch.drawRanges,
                        locDrawRangePlanes,
                        roofPlaneLimit, map, isLod,
                    );
                }

                const groundBatch = isLod ? undefined : map.getGroundItemDrawCall(transparent, isInteract, false);
                if (groundBatch) {
                    const groundDrawRangePlanes = map.getGroundItemDrawRangesPlanes(
                        transparent,
                        isInteract,
                        isLod,
                    );
                    groundBatch.drawCall.uniform("u_roofPlaneLimit", roofPlaneLimit);
                    groundBatch.drawCall.uniform("u_worldEntityTransform", weTransform);
                    groundBatch.drawCall.uniform("u_worldEntityOpacity", 1.0);
                    host.drawWithRoofPlaneFilter(
                        groundBatch.drawCall,
                        groundBatch.drawRanges,
                        groundDrawRangePlanes,
                        roofPlaneLimit, map, isLod,
                    );
                }

                const doorBatch = map.getDoorDrawCall(transparent, isInteract, isLod);
                if (doorBatch) {
                    const doorDrawRangePlanes = map.getDoorDrawRangesPlanes(
                        transparent,
                        isInteract,
                        isLod,
                    );
                    doorBatch.drawCall.uniform("u_roofPlaneLimit", roofPlaneLimit);
                    doorBatch.drawCall.uniform("u_worldEntityTransform", weTransform);
                    host.drawWithRoofPlaneFilter(
                        doorBatch.drawCall,
                        doorBatch.drawRanges,
                        doorDrawRangePlanes,
                        roofPlaneLimit, map, isLod,
                    );
                }

                // Mode1 overlap ghost: redraw WE with tint + low opacity when actors overlap
                if (isWorldEntity && weEntityIndex !== undefined && !transparent) {
                    const weEntity = host.osrsClient.worldViewManager.getWorldEntity(weEntityIndex);
                    if (weEntity && weEntity.drawMode === 1) {
                        const weView = host.osrsClient.worldViewManager.getWorldView(weEntityIndex);
                        const hasOverlap =
                            weView && (weView.npcIds.size > 0 || weView.playerIds.size > 0);
                        if (hasOverlap) {
                            const overlay = host.worldEntityOverlays.get(weEntityIndex);
                            const weType =
                                overlay?.configId !== undefined && overlay.configId >= 0
                                    ? host.osrsClient.worldEntityTypeLoader?.load(overlay.configId)
                                    : undefined;
                            if (weType && weType.sceneTintHsl > 0 && host.sceneUniformBuffer) {
                                host.setSceneHslOverrideFromPacked(weType.sceneTintHsl, 127);
                                host.sceneUniformBuffer
                                    .set(4, host.sceneHslOverride as Float32Array)
                                    .update();

                                host.app.enable(PicoGL.BLEND);
                                host.app.blendFunc(PicoGL.SRC_ALPHA, PicoGL.ONE_MINUS_SRC_ALPHA);

                                drawCall.uniform("u_worldEntityOpacity", 0.01);
                                host.drawWithRoofPlaneFilter(
                                    drawCall,
                                    drawRanges,
                                    drawRangePlanes,
                                    roofPlaneLimit, map, isLod,
                                );
                                drawCall.uniform("u_worldEntityOpacity", 1.0);

                                host.app.disable(PicoGL.BLEND);

                                host.clearSceneHslOverride();
                                host.sceneUniformBuffer
                                    .set(4, host.sceneHslOverride as Float32Array)
                                    .update();
                            }
                        }
                    }
                }
            }
        }

        if (!transparent && !shadow) {
            host.lastLodVisibleMapCount = lodVisibleMapCount;
            host.lastFullDetailVisibleMapCount = fullDetailVisibleMapCount;
            host.lastLodThreshold = lodThresholdTiles | 0;
            host.lastDistanceCulledVisibleMapCount = distanceCulledVisibleMapCount;
        }
    
}

export function renderOpaquePass(host: WebGLOsrsRendererHost, ): void {

        host.renderGeometryPass(false);
        if (!host.hdShadowFrustum) renderSunkenLocs(host);
    
}

/**
 * Locs meant to be seen below the floor (SUNKEN_LOC_IDS): their faces first reset the depth
 * under them to the far plane (no colour), so the floor no longer hides them, then they are drawn
 * again normally. Their translucent faces go on in the transparent pass.
 */
function renderSunkenLocs(host: WebGLOsrsRendererHost): void {
        const maps = host.mapManager.visibleMaps;
        const count = host.mapManager.visibleMapCount;
        const roofPlaneLimit = host.getRoofPlaneLimit();
        const cullTile = host.getRenderCullTile();
        const lodThresholdTiles = Math.max(0, host.getFrameLodThresholdTiles() | 0);
        const renderDistanceTiles = Math.max(0, host.getFrameRenderDistanceTiles() | 0);
        const draws: { drawCall: DrawCall; drawRanges: DrawRange[]; indices: number[]; punchOnly: boolean }[] = [];
        for (let i = 0; i < count; i++) {
            const map = maps[i];
            if (!hasSunkenLocs(map.locsAnimated) || host.mapManager.worldEntityMapIds.has(map.id)) continue;
            if (host.getMapTileDistanceFromPoint(map, cullTile.x, cullTile.y) > lodThresholdTiles) continue;
            if (!host.isMapWithinRenderDistance(map, cullTile.x, cullTile.y, renderDistanceTiles, 0)) continue;
            for (const alpha of [false, true]) {
                const batch = map.getLocDrawCall(alpha, false, false);
                if (!batch) continue;
                const planes = map.getLocDrawRangesPlanes(alpha, false, false);
                const indices = sunkenRangeIndices(map.locsAnimated, alpha).filter((index) =>
                    !(roofPlaneLimit < 3 && planes && index < planes.length && planes[index] > roofPlaneLimit));
                if (indices.length === 0) continue;
                if (alpha) {
                    batch.drawCall.uniform("u_roofPlaneLimit", roofPlaneLimit);
                    batch.drawCall.uniform("u_worldEntityTransform", WebGLMapSquare.IDENTITY_MAT4);
                    batch.drawCall.uniform("u_worldEntityOpacity", 1.0);
                    host.updateAnimatedDrawRanges(map, batch.drawCall, batch.drawRanges, true, false, false);
                }
                draws.push({ drawCall: batch.drawCall, drawRanges: batch.drawRanges, indices, punchOnly: alpha });
            }
        }
        if (draws.length === 0) return;

        const app = host.app;
        app.colorMask(false, false, false, false);
        app.depthFunc(PicoGL.ALWAYS);
        app.depthRange(1, 1);
        for (const draw of draws) host.draw(draw.drawCall, draw.drawRanges, draw.indices);
        app.depthRange(0, 1);
        app.depthFunc(PicoGL.LEQUAL);
        app.colorMask(true, true, true, true);
        for (const draw of draws) if (!draw.punchOnly) host.draw(draw.drawCall, draw.drawRanges, draw.indices);
}

export function renderTransparentPass(host: WebGLOsrsRendererHost, ): void {

        host.renderGeometryPass(true);
    
}
