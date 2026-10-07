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
import { RENDER_CONSTANTS } from "../constants";

export function renderTransparentNpcPass(host: WebGLOsrsRendererHost, 
        npcDataTextureIndex: number,
        npcDataTexture: Texture | undefined,
    ): void {

        if (!npcDataTexture || !host.loadNpcs) {
            return;
        }
        const cullTile = host.getRenderCullTile();
        const renderDistanceTiles = Math.max(0, host.getFrameRenderDistanceTiles() | 0);
        const renderDistancePadTiles = 0;

        // Collect dynamic NPCs for second pass
        const dynamicNpcs: Array<{
            map: WebGLMapSquare;
            npcIndex: number;
            ecsId: number;
            npcTypeId: number;
            seqId: number;
            overlaySeqId: number;
            overlayFrameId: number;
            dataOffset: number;
            frameId: number;
            geometry: DynamicNpcFrameGeometry;
        }> = [];

        for (let i = host.mapManager.visibleMapCount - 1; i >= 0; i--) {
            const map = host.mapManager.visibleMaps[i];
            if (
                !host.isMapWithinRenderDistance(
                    map,
                    cullTile.x,
                    cullTile.y,
                    renderDistanceTiles,
                    renderDistancePadTiles,
                )
            ) {
                continue;
            }
            const npcCount = map.npcEntityIds?.length ?? 0;
            if (npcCount === 0) continue;

            const dataOffset = map.npcDataTextureOffsets[npcDataTextureIndex];
            if (dataOffset === -1) {
                continue;
            }

            const npcBatch = map.drawCallNpc;
            if (!npcBatch) continue;
            const { drawCall, drawRanges } = npcBatch;

            drawCall
                .uniform("u_npcDataOffset", dataOffset)
                .uniform("u_modelYOffset", host.getNpcModelYOffset())
                .uniform("u_worldEntityTransform", WebGLMapSquare.IDENTITY_MAT4)
                .texture("u_npcDataTexture", npcDataTexture);

            {
                const ecs = host.osrsClient.npcEcs;
                const ids: number[] = map.npcEntityIds as any;
                const weNpcIndices: number[] = [];

                for (let j = 0; j < npcCount; j++) {
                    const id = ids[j] | 0;
                    if (!host.shouldRenderNpcFromMap(map, id) || host.isNpcSmoothed(id)) {
                        (drawCall as any).offsets[j] = 0;
                        (drawCall as any).numElements[j] = 0;
                        drawRanges[j] = NULL_DRAW_RANGE;
                        continue;
                    }

                    // Draw world-entity NPCs separately so their transparent faces
                    // receive the same deck height and transform as their opaque faces.
                    if (ecs.getWorldViewId(id) >= 0) {
                        weNpcIndices.push(j);
                        (drawCall as any).offsets[j] = 0;
                        (drawCall as any).numElements[j] = 0;
                        drawRanges[j] = NULL_DRAW_RANGE;
                        continue;
                    }

                    const seqId = ecs.getSeqId(id) | 0;
                    const seqDelay = ecs.getSeqDelay?.(id) | 0;
                    const npcTypeId = (ecs.getNpcTypeId?.(id) ?? -1) | 0;
                    const { movementSeqId, idleSeqId, walkSeqId } =
                        host.resolveNpcMovementSequenceIds(ecs, id);
                    const actionActive = seqId >= 0 && seqDelay === 0;
                    const renderSeqId = actionActive ? seqId | 0 : movementSeqId | 0;
                    const overlaySeqId =
                        actionActive &&
                        host.shouldLayerNpcMovementSequence(
                            seqId | 0,
                            movementSeqId | 0,
                            idleSeqId | 0,
                        )
                            ? movementSeqId | 0
                            : -1;
                    const frameId = actionActive
                        ? ecs.getFrameIndex(id) | 0
                        : ecs.getMovementFrameIndex?.(id) | 0;
                    const overlayFrameId =
                        overlaySeqId >= 0 ? ecs.getMovementFrameIndex?.(id) | 0 : -1;
                    const hasStaticMovementAnim =
                        (movementSeqId | 0) === (idleSeqId | 0) ||
                        (movementSeqId | 0) === (walkSeqId | 0) ||
                        !!map.npcExtraAnims?.[j]?.[movementSeqId | 0];
                    const forceDynamic =
                        overlaySeqId >= 0 || (!actionActive && !hasStaticMovementAnim);
                    const dynamicMeta =
                        renderSeqId >= 0 && npcTypeId >= 0
                            ? host.ensureNpcDynamicSequenceMeta(
                                map,
                                j,
                                npcTypeId,
                                renderSeqId,
                                forceDynamic,
                            )
                            : undefined;

                    if (dynamicMeta) {
                        const geometry = host.dynamicNpcAnimLoader?.getFrameGeometry(
                            npcTypeId,
                            renderSeqId | 0,
                            frameId,
                            overlaySeqId | 0,
                            overlayFrameId | 0,
                        );
                        const hasDynamicGraphics =
                            !!geometry &&
                            ((geometry.opaqueVertices.length > 0 &&
                                geometry.opaqueIndices.length > 0) ||
                                (geometry.alphaVertices.length > 0 &&
                                    geometry.alphaIndices.length > 0));
                        if (geometry && hasDynamicGraphics) {
                            (drawCall as any).offsets[j] = 0;
                            (drawCall as any).numElements[j] = 0;
                            drawRanges[j] = NULL_DRAW_RANGE;
                            dynamicNpcs.push({
                                map,
                                npcIndex: j,
                                ecsId: id,
                                npcTypeId,
                                seqId: renderSeqId | 0,
                                overlaySeqId: overlaySeqId | 0,
                                overlayFrameId: overlayFrameId | 0,
                                dataOffset,
                                frameId,
                                geometry,
                            });
                            continue;
                        }
                    }

                    const anim = host._resolveNpcAnimation(map, j, ecs, id);
                    let frame: DrawRange = NULL_DRAW_RANGE;
                    if (anim.framesAlpha) {
                        frame =
                            anim.framesAlpha[
                                Math.max(0, Math.min((anim.framesAlpha.length - 1) | 0, frameId))
                                ];
                    }
                    (drawCall as any).offsets[j] = frame[0];
                    (drawCall as any).numElements[j] = frame[1];
                    drawRanges[j] = frame;
                }

                host.draw(drawCall, drawRanges);

                if (weNpcIndices.length > 0) {
                    const firstWeId = ids[weNpcIndices[0]] | 0;
                    const weEntityIdx = ecs.getWorldViewId(firstWeId);
                    const weTransform =
                        host.worldEntityAnimator?.getTransform(weEntityIdx) ??
                        WebGLMapSquare.IDENTITY_MAT4;
                    const weDeckH = host.getWorldEntityDeckHeight(0, 0);

                    drawCall
                        .uniform("u_modelYOffset", host.getNpcModelYOffset(weDeckH))
                        .uniform("u_worldEntityTransform", weTransform);

                    for (let j = 0; j < npcCount; j++) {
                        (drawCall as any).offsets[j] = 0;
                        (drawCall as any).numElements[j] = 0;
                        drawRanges[j] = NULL_DRAW_RANGE;
                    }
                    for (const wj of weNpcIndices) {
                        const wid = ids[wj] | 0;
                        const anim = host._resolveNpcAnimation(map, wj, ecs, wid);
                        const wFrameId =
                            ecs.getSeqId(wid) >= 0 && ecs.getSeqDelay?.(wid) === 0
                                ? ecs.getFrameIndex(wid) | 0
                                : ecs.getMovementFrameIndex?.(wid) | 0;
                        let frame: DrawRange = NULL_DRAW_RANGE;
                        if (anim.framesAlpha) {
                            frame =
                                anim.framesAlpha[
                                    Math.max(
                                        0,
                                        Math.min((anim.framesAlpha.length - 1) | 0, wFrameId),
                                    )
                                    ];
                        }
                        (drawCall as any).offsets[wj] = frame[0];
                        (drawCall as any).numElements[wj] = frame[1];
                        drawRanges[wj] = frame;
                    }
                    host.draw(drawCall, drawRanges);
                }
            }

            try {
                if (host.gfxRenderer) {
                    // Reuse object to avoid per-call allocation
                    host.gfxRenderPassOffsets.player = undefined;
                    host.gfxRenderPassOffsets.npc = dataOffset;
                    host.gfxRenderPassOffsets.world =
                        map.worldGfxDataTextureOffsets[npcDataTextureIndex];
                    host.gfxRenderer.renderMapPass(
                        map,
                        npcDataTexture,
                        "alpha",
                        host.gfxRenderPassOffsets,
                    );
                }
            } catch {}
        }

        for (const entry of host.unbatchedNpcRenderEntries) {
            if (
                !host.isMapWithinRenderDistance(
                    entry.map,
                    cullTile.x,
                    cullTile.y,
                    renderDistanceTiles,
                    renderDistancePadTiles,
                )
            ) {
                continue;
            }
            const geometry = host.resolveUnbatchedNpcGeometry(entry.ecsId);
            if (!geometry) continue;
            dynamicNpcs.push({
                map: entry.map,
                npcIndex: 0,
                ecsId: entry.ecsId,
                npcTypeId: geometry.npcTypeId,
                seqId: geometry.seqId,
                overlaySeqId: geometry.overlaySeqId ?? -1,
                overlayFrameId: geometry.overlayFrameId ?? -1,
                dataOffset: entry.dataOffset,
                frameId: geometry.frameId,
                geometry,
            });
        }

        if (dynamicNpcs.length > 0 && npcDataTexture) {
            for (const dyn of dynamicNpcs) {
                const indexCount = host.uploadDynamicNpcGeometry(dyn.geometry, true);
                if (indexCount <= 0 || !host.dynamicNpcDrawCall) {
                    continue;
                }

                const dynDrawCall = host.dynamicNpcDrawCall;
                dynDrawCall.texture("u_npcDataTexture", npcDataTexture);
                const npcDataOffset = dyn.dataOffset + dyn.npcIndex;

                dynDrawCall.uniform("u_npcDataOffset", npcDataOffset);
                dynDrawCall.uniform("u_mapPos", [dyn.map.renderPosX, dyn.map.renderPosY]);
                dynDrawCall.uniform("u_timeLoaded", dyn.map.timeLoaded);
                {
                    const dynWvId = host.osrsClient.npcEcs.getWorldViewId(dyn.ecsId);
                    if (dynWvId >= 0) {
                        const dynDeckH = host.getWorldEntityDeckHeight(0, 0);
                        dynDrawCall.uniform("u_modelYOffset", host.getNpcModelYOffset(dynDeckH));
                        dynDrawCall.uniform(
                            "u_worldEntityTransform",
                            host.worldEntityAnimator?.getTransform(dynWvId) ??
                            WebGLMapSquare.IDENTITY_MAT4,
                        );
                    } else {
                        dynDrawCall.uniform("u_modelYOffset", host.getNpcModelYOffset());
                        dynDrawCall.uniform("u_worldEntityTransform", WebGLMapSquare.IDENTITY_MAT4);
                    }
                }

                // Set height map texture from the map
                const heightMapTex = (dyn.map as any).heightMapTexture;
                if (heightMapTex) {
                    dynDrawCall.texture("u_heightMap", heightMapTex);
                    dynDrawCall.uniform("u_sceneBorderSize", (dyn.map as any).borderSize ?? 6);
                }
                const waterMaskTex = (dyn.map as any).waterMaskTexture;
                if (waterMaskTex) {
                    dynDrawCall.texture("u_waterMask", waterMaskTex);
                }

                host.dynamicNpcSingleDrawRange[0] = 0;
                host.dynamicNpcSingleDrawRange[1] = indexCount | 0;
                host.dynamicNpcSingleDrawRange[2] = 1;
                (dynDrawCall as any).offsets[0] = 0;
                (dynDrawCall as any).numElements[0] = indexCount | 0;
                host.draw(dynDrawCall, host.dynamicNpcSingleDrawRanges);
            }
        }
    
}
