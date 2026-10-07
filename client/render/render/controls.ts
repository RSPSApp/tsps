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
import { RENDER_CONSTANTS, ColorRgb, TextureFilterMode } from "./constants";

export function clearControlledPlayerAppearanceCache(host: WebGLOsrsRendererHost, ): void {

        try {
            const controlledId = host.osrsClient.controlledPlayerServerId | 0;
            if (controlledId < 0) return;
            const pe = host.osrsClient.playerEcs;
            const idx = pe.getIndexForServerId(controlledId);
            if (idx === undefined) return;
            const app = pe.getAppearance(idx);
            if (!app) return;
            const equipKey =
                app.getEquipKey?.() ??
                (Array.isArray(app.equip) ? app.equip.slice(0, 14).join(",") : "");
            const key = app.getCacheKey?.() ?? `${app.getHash?.().toString() ?? "0"}|${equipKey}`;
            host.playerRenderer.cleanupAppearanceCache(key);
            pe.cleanupAppearanceCache(key);
        } catch {}
    
}

export function getProjectileManager(host: WebGLOsrsRendererHost, ): ProjectileManager | undefined {

        return host.projectileManager;
    
}

export function getControls(host: WebGLOsrsRendererHost, ): Schema {

        // Appearance (clothes + equipment) is server-driven; no local kit lists

        const queueRebuild = () => {
            host.playerRenderer
                .initGeometry()
                .catch((e) => console.warn("Player rebuild failed", e));
        };

        const schema: any = {
            Player: folder(
                {
                    Plane: {
                        value: (() => {
                            const idx = host.osrsClient.playerEcs.getIndexForServerId(
                                host.osrsClient.controlledPlayerServerId,
                            );
                            return idx !== undefined ? host.osrsClient.playerEcs.getLevel(idx) : 0;
                        })(),
                        min: 0,
                        max: 3,
                        step: 1,
                        label: "Plane",
                        onChange: (v: number) => {
                            const idx = host.osrsClient.playerEcs.getIndexForServerId(
                                host.osrsClient.controlledPlayerServerId,
                            );
                            if (idx === undefined) return;
                            const next = Math.max(0, Math.min(3, v | 0));
                            const currentLevel = host.osrsClient.playerEcs.getLevel(idx);
                            if (currentLevel !== next) {
                                host.osrsClient.playerEcs.setLevel(idx, next);
                                // Keep PlayerECS in sync if present so roof logic uses this plane
                                try {
                                    const pe = host.osrsClient.playerEcs as any;
                                    const n = pe?.size?.() ?? 0;
                                    if (n > 0) pe.setLevel?.(0, next);
                                } catch {}
                                // Ensure camera follow and height sampling react immediately
                                host.osrsClient.camera.updated = true;
                            }
                        },
                    },
                    AnimMode: {
                        value: host.playerAnimMode,
                        options: { Idle: "idle", Walk: "walk", Run: "run", Crawl: "crawl" },
                        label: "Player Animation",
                        onChange: (v: "idle" | "walk" | "run" | "crawl") => {
                            host.playerAnimMode = v;
                            // Also toggle server run mode to keep speed consistent with UI choice
                            try {
                                host.osrsClient.setRunMode(v === "run");
                            } catch {}
                            // Update local ECS run flag to reflect toggle immediately
                            try {
                                const idx = host.osrsClient.playerEcs.getIndexForServerId(
                                    host.osrsClient.controlledPlayerServerId,
                                );
                                if (idx !== undefined)
                                    (host.osrsClient.playerEcs as any).running[idx] =
                                        v === "run" ? 1 : 0;
                            } catch {}
                            // Reset frames when switching modes
                        },
                    },
                    DebugDumpVertices: {
                        value: host.playerDebugDump,
                        label: "Debug Dump Vertices",
                        onChange: (v: boolean) => {
                            host.playerDebugDump = !!v;
                            queueRebuild();
                        },
                    },
                    FreezeFrame: {
                        value: host.playerFreezeFrame,
                        label: "Freeze Frame",
                        onChange: (v: boolean) => (host.playerFreezeFrame = !!v),
                    },
                    FrameIndex: {
                        value: host.playerFixedFrame,
                        min: 0,
                        max: Math.max(host.playerRenderer.getFrameCount() - 1, 0),
                        step: 1,
                        onChange: (v: number) => (host.playerFixedFrame = v | 0),
                    },
                    IdleSeqId: {
                        value: host.playerIdleSeqId,
                        min: -1,
                        max: host.resolvePlayerIdleSeqMaxId(),
                        step: 1,
                        label: "Idle Seq ID (-1:auto)",
                        onChange: (v: number) => {
                            host.playerIdleSeqId = v | 0;
                            host.clearControlledPlayerAppearanceCache();
                            queueRebuild();
                        },
                    },
                    YOffset: {
                        value: host.playerYOffset,
                        min: -32,
                        max: 64,
                        step: 1,
                        label: "Y offset",
                        onChange: (v: number) => (host.playerYOffset = v | 0),
                    },
                    // No local appearance editing (head/torso/arms/hands)
                    // No local appearance editing (legs/feet)
                    // No local equip meta introspection
                },
                { collapsed: false },
            ),
            "Scene Resolution": {
                value: Math.round(host.sceneResolutionScale * 100),
                min: 50,
                max: 100,
                step: 5,
                label: "Scene resolution (%)",
                onChange: (v: number) => {
                    host.sceneResolutionScale = Math.max(0.5, Math.min(1, v / 100));
                },
            },
            "Max Level": {
                value: host.maxLevel,
                min: 0,
                max: 3,
                step: 1,
                onChange: (v: number) => {
                    host.setMaxLevel(v);
                },
            },
            Sky: {
                r: host.skyColor[0] * 255,
                g: host.skyColor[1] * 255,
                b: host.skyColor[2] * 255,
                onChange: (v: ColorRgb) => {
                    host.setSkyColor(v.r, v.g, v.b);
                },
            },
            Fog: folder(
                {
                    Auto: {
                        value: host.autoFogDepth,
                        label: "Dynamic (scales with draw distance)",
                        onChange: (v: boolean) => {
                            host.autoFogDepth = !!v;
                        },
                    },
                    Factor: {
                        value: host.autoFogDepthFactor,
                        min: 0,
                        max: 1,
                        step: 0.05,
                        label: "Fog start factor",
                        onChange: (v: number) => {
                            // Keep it sane; fogFactorOSRS clamps against renderDistance anyway.
                            host.autoFogDepthFactor = Math.max(0, Math.min(1, v));
                        },
                    },
                    Depth: {
                        value: host.fogDepth,
                        min: 0,
                        max: 400,
                        step: 5,
                        label: "Manual fog start (tiles)",
                        onChange: (v: number) => {
                            host.fogDepth = v;
                        },
                    },
                },
                { collapsed: true },
            ),
            Brightness: {
                value: 1,
                min: 0,
                max: 4,
                step: 1,
                onChange: (v: number) => {
                    host.brightness = 1.0 - v * 0.1;
                },
            },
            "Color Banding": {
                value: 50,
                min: 0,
                max: 100,
                step: 1,
                onChange: (v: number) => {
                    host.colorBanding = 255 - v * 2;
                },
            },
            "Texture Filtering": {
                value: host.textureFilterMode,
                options: {
                    Disabled: TextureFilterMode.DISABLED,
                    Bilinear: TextureFilterMode.BILINEAR,
                    Trilinear: TextureFilterMode.TRILINEAR,
                    "Anisotropic 2x": TextureFilterMode.ANISOTROPIC_2X,
                    "Anisotropic 4x": TextureFilterMode.ANISOTROPIC_4X,
                    "Anisotropic 8x": TextureFilterMode.ANISOTROPIC_8X,
                    "Anisotropic 16x": TextureFilterMode.ANISOTROPIC_16X,
                },
                onChange: (v: TextureFilterMode) => {
                    if (v === host.textureFilterMode) {
                        return;
                    }
                    host.textureFilterMode = v;
                    host.updateTextureFiltering();
                },
            },
            "Smooth Terrain": {
                value: host.smoothTerrain,
                onChange: (v: boolean) => {
                    host.setSmoothTerrain(v);
                },
            },
            "Cull Back-faces": {
                value: host.cullBackFace,
                onChange: (v: boolean) => {
                    host.cullBackFace = v;
                },
            },
            "Anti-Aliasing": folder(
                {
                    MSAA: {
                        value: host.msaaEnabled,
                        onChange: (v: boolean) => {
                            host.setMsaa(v);
                        },
                    },
                    FXAA: {
                        value: host.fxaaEnabled,
                        onChange: (v: boolean) => {
                            host.setFxaa(v);
                        },
                    },
                },
                { collapsed: true },
            ),
            Entity: folder(
                {
                    Npcs: {
                        value: host.loadNpcs,
                        onChange: (v: boolean) => {
                            host.setLoadNpcs(v);
                        },
                    },
                },
                { collapsed: true },
            ),
        };

        return schema;
    
}
