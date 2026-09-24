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
import { RENDER_CONSTANTS, DEFAULT_OVERHEAD_CHAT_COLOR, DEFAULT_OVERHEAD_CHAT_COLOR_ID } from "./constants";

export function acquireHitsplatEntry(host: WebGLOsrsRendererHost, ): HitsplatEntry {

        const entry = host.hitsplatPool.pop() ?? { worldX: 0, worldZ: 0, plane: 0 };
        entry.style = undefined;
        entry.spriteName = undefined;
        entry.type2 = undefined;
        entry.damage2 = undefined;
        return entry;
    
}

export function acquireHealthBarEntry(host: WebGLOsrsRendererHost, ): HealthBarEntry {

        return (
            host.healthBarPool.pop() ?? {
                worldX: 0,
                worldZ: 0,
                plane: 0,
                health: 0,
                health2: 0,
                cycle: 0,
                cycleOffset: 0,
            }
        );
    
}

export function acquireOverheadPrayerEntry(host: WebGLOsrsRendererHost, ): OverheadPrayerEntry {

        return (
            host.overheadPrayerPool.pop() ?? {
                worldX: 0,
                worldZ: 0,
                plane: 0,
                heightOffsetTiles: 0.9,
                headIconPk: -1,
                headIconPrayer: -1,
                npcHeadIcons: undefined,
            }
        );
    
}

export function acquireOverheadTextEntry(host: WebGLOsrsRendererHost, ): OverheadTextEntry {

        const entry = host.overheadTextPool.pop() ?? {
            worldX: 0,
            worldZ: 0,
            plane: 0,
            heightOffsetTiles: 0.9,
            text: "",
            color: DEFAULT_OVERHEAD_CHAT_COLOR >>> 0,
            colorId: DEFAULT_OVERHEAD_CHAT_COLOR_ID,
            effect: 0,
            life: 1,
            remaining: 0,
            duration: 1,
        };
        entry.modIcon = undefined;
        entry.pattern = undefined;
        return entry;
    
}

export function resetHealthBarOutput(host: WebGLOsrsRendererHost, ): void {

        if (host.healthBarOutput.length === 0) return;
        for (const entry of host.healthBarOutput) {
            entry.defId = undefined;
            entry.heightOffsetTiles = undefined;
            host.healthBarPool.push(entry);
        }
        host.healthBarOutput.length = 0;
    
}

export function resetOverheadPrayerOutput(host: WebGLOsrsRendererHost, ): void {

        if (host.overheadPrayerOutput.length === 0) return;
        for (const entry of host.overheadPrayerOutput) {
            entry.headIconPk = -1;
            entry.headIconPrayer = -1;
            entry.npcHeadIcons = undefined;
            entry.heightOffsetTiles = 0.9;
            host.overheadPrayerPool.push(entry);
        }
        host.overheadPrayerOutput.length = 0;
    
}

export function resetOverheadTextOutput(host: WebGLOsrsRendererHost, ): void {

        if (host.overheadTextOutput.length === 0) return;
        for (const entry of host.overheadTextOutput) {
            entry.text = "";
            entry.life = 0;
            entry.remaining = 0;
            entry.duration = 0;
            entry.modIcon = undefined;
            entry.pattern = undefined;
            entry.heightOffsetTiles = 0.9;
            entry.color = DEFAULT_OVERHEAD_CHAT_COLOR >>> 0;
            entry.colorId = DEFAULT_OVERHEAD_CHAT_COLOR_ID;
            host.overheadTextPool.push(entry);
        }
        host.overheadTextOutput.length = 0;
    
}

export function resetHitsplatOutput(host: WebGLOsrsRendererHost, ): void {

        if (host.hitsplatOutput.length === 0) return;
        for (const entry of host.hitsplatOutput) {
            entry.style = undefined;
            entry.spriteName = undefined;
            host.hitsplatPool.push(entry);
        }
        host.hitsplatOutput.length = 0;
    
}

export function getNpcDefaultHeight(host: WebGLOsrsRendererHost, npcTypeId: number): number {

        // Check cache first
        let defaultHeight = host.npcDefaultHeightCache.get(npcTypeId);
        if (defaultHeight !== undefined) {
            return defaultHeight;
        }

        // Default fallback (same as Actor constructor: host.defaultHeight = 200)
        defaultHeight = 200;

        try {
            const npcType = host.osrsClient.npcTypeLoader.load(npcTypeId | 0);
            if (npcType && npcType.modelIds && npcType.modelIds.length > 0) {
                // Load and merge model data
                const models: ModelData[] = [];
                for (const modelId of npcType.modelIds) {
                    const modelData = host.osrsClient.modelLoader.getModel(modelId);
                    if (modelData) {
                        models.push(modelData);
                    }
                }

                if (models.length > 0) {
                    const merged = ModelData.merge(models, models.length);

                    // Apply recoloring (needed for proper model construction)
                    if (npcType.recolorFrom) {
                        for (let i = 0; i < npcType.recolorFrom.length; i++) {
                            merged.recolor(npcType.recolorFrom[i], npcType.recolorTo[i]);
                        }
                    }

                    // Light the model to get a proper Model instance
                    const model = merged.light(
                        host.osrsClient.textureLoader,
                        (npcType.ambient ?? 0) + 64,
                        (npcType.contrast ?? 0) * 5 + 850,
                        -30,
                        -50,
                        -30,
                    );

                    // Apply height scaling (OSRS applies widthScale to X/Z, heightScale to Y)
                    const widthScale = npcType.widthScale ?? 128;
                    const heightScale = npcType.heightScale ?? 128;
                    if (widthScale !== 128 || heightScale !== 128) {
                        model.scale(widthScale, heightScale, widthScale);
                    }

                    // Calculate bounds cylinder to get actual height
                    model.calculateBoundsCylinder();
                    defaultHeight = model.height;
                }
            }
        } catch (e) {
            // Fall back to default on any error
            console.warn(`[renderer] Failed to compute NPC height for ${npcTypeId}:`, e);
        }

        // Cache and return
        host.npcDefaultHeightCache.set(npcTypeId, defaultHeight);
        return defaultHeight;
    
}

export function resolveNpcOverlayAnchor(host: WebGLOsrsRendererHost, 
        ecsId: number,
        baseWorldX: number,
        baseWorldZ: number,
        npcTypeId: number | undefined,
    ): { worldX: number; worldZ: number; logicalHeightTiles: number } {

        let worldX = baseWorldX;
        let worldZ = baseWorldZ;
        let defaultHeight = npcTypeId != null ? host.getNpcDefaultHeight(npcTypeId) : 200;
        let logicalHeightTiles = defaultHeight / 128;

        try {
            if (npcTypeId == null || npcTypeId < 0) {
                return { worldX, worldZ, logicalHeightTiles };
            }
            const npcEcs = host.osrsClient.npcEcs;
            const npcTypeLoader = host.osrsClient.npcTypeLoader;
            const npcModelLoader = host.getInteractNpcModelLoader();
            if (!npcModelLoader || !npcTypeLoader) {
                return { worldX, worldZ, logicalHeightTiles };
            }

            let npcType = npcTypeLoader.load(npcTypeId | 0);
            if (!npcType) {
                return { worldX, worldZ, logicalHeightTiles };
            }
            if (npcType.transforms) {
                const transformed = npcType.transform(host.osrsClient.varManager, npcTypeLoader);
                if (transformed) npcType = transformed;
            }

            const actionSeqId = npcEcs.getSeqId(ecsId) | 0;
            const actionDelay = npcEcs.getSeqDelay?.(ecsId) | 0;
            const { movementSeqId, idleSeqId } = host.resolveNpcMovementSequenceIds(npcEcs, ecsId);
            const actionActive = actionSeqId >= 0 && actionDelay === 0;
            const seqId = actionActive ? actionSeqId : movementSeqId;
            const frame = Math.max(
                0,
                actionActive
                    ? npcEcs.getFrameIndex(ecsId) | 0
                    : npcEcs.getMovementFrameIndex?.(ecsId) | 0,
            );
            const movementFrame = Math.max(0, npcEcs.getMovementFrameIndex?.(ecsId) | 0);
            const overlaySeqId =
                actionActive &&
                host.shouldLayerNpcMovementSequence(
                    actionSeqId | 0,
                    movementSeqId | 0,
                    idleSeqId | 0,
                )
                    ? movementSeqId | 0
                    : -1;
            const overlayFrame = overlaySeqId >= 0 ? movementFrame | 0 : -1;
            const animHeightOffsetTiles = host.getSequenceVerticalOffsetTiles(seqId);

            let model =
                seqId >= 0
                    ? npcModelLoader.getModel(
                        npcType,
                        seqId,
                        frame,
                        overlaySeqId | 0,
                        overlayFrame | 0,
                    )
                    : undefined;
            if (!model) {
                model = npcModelLoader.getModel(npcType, -1, -1);
            }
            if (!model) {
                const baseLogicalHeight =
                    npcType.heightOffset >= 0 ? npcType.heightOffset : defaultHeight;
                return {
                    worldX,
                    worldZ,
                    logicalHeightTiles: baseLogicalHeight / 128 + animHeightOffsetTiles,
                };
            }

            try {
                model.calculateBoundsCylinder();
                defaultHeight = Math.max(1, model.height | 0);
            } catch {}
            const baseLogicalHeight =
                npcType.heightOffset >= 0 ? npcType.heightOffset : defaultHeight;
            logicalHeightTiles = baseLogicalHeight / 128 + animHeightOffsetTiles;

            // Model-space center can be offset from origin; rotate it like npc.vert.glsl.
            try {
                model.calculateBounds();
                const midX = ((model as any).xMid | 0) as number;
                const midZ = ((model as any).zMid | 0) as number;
                const yaw = (npcEcs.getRotation(ecsId) | 0) * RS_TO_RADIANS;
                const cos = Math.cos(yaw);
                const sin = Math.sin(yaw);
                worldX += (midX * cos + midZ * sin) / 128.0;
                worldZ += (-midX * sin + midZ * cos) / 128.0;
            } catch {}
        } catch {}

        return {
            worldX,
            worldZ,
            logicalHeightTiles,
        };
    
}

export function getEffectiveControlledPlayerId(host: WebGLOsrsRendererHost, ): number {

        const actual = host.osrsClient.controlledPlayerServerId | 0;
        if (actual > 0) {
            if (
                host.pendingControlledPlayerServerId !== undefined &&
                host.pendingControlledPlayerServerId !== actual
            ) {
                host.pendingControlledPlayerServerId = undefined;
            }
            return actual;
        }
        if (host.pendingControlledPlayerServerId !== undefined) {
            return host.pendingControlledPlayerServerId | 0;
        }
        return 0;
    
}

export function ensureHitsplatState(host: WebGLOsrsRendererHost, 
        map: Map<number, ActorHitsplatState>,
        serverId: number,
    ): ActorHitsplatState {

        let state = map.get(serverId);
        if (state) return state;
        state = createActorHitsplatState();
        map.set(serverId, state);
        return state;
    
}
