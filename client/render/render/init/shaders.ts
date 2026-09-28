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

/**
 * Scales a portrait so the model fits its row. Projected size is roughly
 * `extent * zoom3d / zoom2d`, so the zoom that fits the widget box comes straight from the
 * model's own bounds - one arithmetic pass, and the render it feeds is cached per npc.
 */
function fitPortraitParams(model: any, params: any): any {
    model.calculateBoundsCylinder?.();
    const box = params.widget;
    const boxHeight = Math.max(1, (box?.height | 0) - 2);
    const boxWidth = Math.max(1, (box?.width | 0) - 2);
    const modelHeight = Math.max(1, model.height | 0);
    const modelWidth = Math.max(1, (model.xzRadius | 0) * 2);
    const zoom3d = Math.max(1, (params.zoom3d ?? 512) | 0);
    const zoom2d = Math.max(
        (modelHeight * zoom3d) / boxHeight,
        (modelWidth * zoom3d) / boxWidth,
    );
    return { ...params, zoom2d: Math.max(1, zoom2d | 0) };
}

export async function initShaders(host: WebGLOsrsRendererHost, ): Promise<Program[]> {

        const supportsMultiDraw = host.drawBackend?.supportsMultiDraw ?? false;
        // Create FXAA separately so a Metal/ANGLE link failure on iOS Safari
        // cannot reject the entire program batch (player/NPC/etc.).
        const programs = await host.app.createPrograms(
            ...[
                createMainProgram(false, supportsMultiDraw),
                createMainProgram(true, supportsMultiDraw),
                createNpcProgram(true, supportsMultiDraw),
                createNpcProgram(false, supportsMultiDraw),
                createProjectileProgram(true, supportsMultiDraw),
                createProjectileProgram(false, supportsMultiDraw),
                createPlayerProgram(true, supportsMultiDraw),
                createPlayerProgram(false, supportsMultiDraw),
            ].map((source) => host.osrsClient.clientPlugins.transformSceneProgram(source)),
            FRAME_PROGRAM,
            // hover line program (added at end)
            [
                `#version 300 es\n\nlayout(std140, column_major) uniform;\n\nprecision highp float;\n\n// Inline SceneUniforms (can't use #include in runtime strings)\nuniform SceneUniforms {\n    mat4 u_viewProjMatrix;\n    mat4 u_viewMatrix;\n    mat4 u_projectionMatrix;\n    vec4 u_skyColor;\n    vec4 u_sceneHslOverride;\n    vec2 u_cameraPos;\n    vec2 u_playerPos;\n    float u_renderDistance;\n    float u_fogDepth;\n    float u_currentTime;\n    float u_brightness;\n    float u_colorBanding;\n    float u_isNewTextureAnim;\n};\n\nlayout(location=0) in vec3 a_position;\n\nvoid main(){\n    vec4 pos = u_viewMatrix * vec4(a_position, 1.0);\n    gl_Position = u_projectionMatrix * pos;\n}`,
                `#version 300 es\n\nprecision mediump float;\n\nuniform vec4 u_color;\n\nout vec4 fragColor;\nvoid main(){\n    fragColor = u_color;\n}`,
            ],
            // hitsplat textured quad anchored in world (clip-space offset)
            [
                `#version 300 es\n\nlayout(std140, column_major) uniform;\nprecision highp float;\n\nuniform SceneUniforms {\n    mat4 u_viewProjMatrix;\n    mat4 u_viewMatrix;\n    mat4 u_projectionMatrix;\n    vec4 u_skyColor;\n    vec4 u_sceneHslOverride;\n    vec2 u_cameraPos;\n    vec2 u_playerPos;\n    float u_renderDistance;\n    float u_fogDepth;\n    float u_currentTime;\n    float u_brightness;\n    float u_colorBanding;\n    float u_isNewTextureAnim;\n};\n\nlayout(location=0) in vec2 a_position; // pixel offset from anchor\nlayout(location=1) in vec2 a_texCoord;\n\nout vec2 v_uv;\n\nuniform vec2 u_screenSize;\nuniform vec3 u_centerWorld;\n\nvoid main(){\n    vec4 centerClip = u_projectionMatrix * (u_viewMatrix * vec4(u_centerWorld, 1.0));\n    if (centerClip.w <= 0.0) {\n        gl_Position = vec4(2.0, 2.0, 1.0, 1.0);\n        v_uv = a_texCoord;\n        return;\n    }\n\n    vec2 snappedOffset = floor(a_position + vec2(0.5, 0.5));\n    vec2 px = snappedOffset / u_screenSize;\n    vec2 ndcOffset = vec2(px.x * 2.0, -px.y * 2.0);\n    gl_Position = vec4(centerClip.xy + ndcOffset * centerClip.w, centerClip.z, centerClip.w);\n    v_uv = a_texCoord;\n}`,
                `#version 300 es\n\nprecision mediump float;\n\nin vec2 v_uv;\n\nuniform sampler2D u_sprite;\nuniform vec4 u_tint;\n\nout vec4 fragColor;\n\nvoid main(){\n    vec4 c = texture(u_sprite, v_uv);\n    if (c.a < 0.01) discard;\n    fragColor = vec4(c.rgb * u_tint.rgb, c.a * u_tint.a);\n}`,
            ],
            // screen-space textured quad for UI overlays
            [
                `#version 300 es\n\nlayout(location=0) in vec2 a_position;\nlayout(location=1) in vec2 a_texCoord;\n\nuniform vec2 u_screenSize;\n\nout vec2 v_uv;\n\nvoid main(){\n    vec2 px = (a_position + vec2(0.5, 0.5)) / u_screenSize;\n    vec2 ndc = vec2(px.x * 2.0 - 1.0, 1.0 - px.y * 2.0);\n    gl_Position = vec4(ndc, 0.0, 1.0);\n    v_uv = a_texCoord;\n}`,
                `#version 300 es\n\nprecision mediump float;\n\nin vec2 v_uv;\n\nuniform sampler2D u_sprite;\nuniform vec4 u_tint;\n\nout vec4 fragColor;\n\nvoid main(){\n    vec4 c = texture(u_sprite, v_uv);\n    if (c.a < 0.01) discard;\n    fragColor = vec4(c.rgb * u_tint.rgb, c.a * u_tint.a);\n}`,
            ],
        );

        const [
            mainProgram,
            mainAlphaProgram,
            npcProgram,
            npcProgramOpaque,
            projectileProgram,
            projectileProgramOpaque,
            playerProgram,
            playerProgramOpaque,
            frameProgram,
            hoverLineProgram,
            hitsplatProgram,
            uiTabsProgram,
        ] = programs;
        host.mainProgram = mainProgram;
        host.osrsClient.clientPlugins.sceneProgramsReady(host, programs.slice(0, 8));
        host.mainAlphaProgram = mainAlphaProgram;
        host.npcProgram = npcProgram;
        host.npcProgramOpaque = npcProgramOpaque;
        host.projectileProgram = projectileProgram;
        host.projectileProgramOpaque = projectileProgramOpaque;
        host.playerProgram = playerProgram;
        host.playerProgramOpaque = playerProgramOpaque;
        host.frameProgram = frameProgram;
        host.hoverLineProgram = hoverLineProgram;
        host.hitsplatProgram = hitsplatProgram;

        host.frameDrawCall = host.app.createDrawCall(frameProgram, host.quadArray);

        try {
            const [frameFxaaProgram] = await host.app.createPrograms(FRAME_FXAA_PROGRAM);
            host.frameFxaaProgram = frameFxaaProgram;
            host.frameFxaaDrawCall = host.app.createDrawCall(frameFxaaProgram, host.quadArray);
        } catch (e) {
            console.warn("[WebGLOsrsRenderer] FXAA unavailable; continuing without it", e);
            host.frameFxaaProgram = undefined;
            host.frameFxaaDrawCall = undefined;
            host.fxaaEnabled = false;
        }

        if (host.hoverLineProgram && host.sceneUniformBuffer) {
            host.overlayManager = new OverlayManager();
            host.overlayManager.init({ app: host.app, sceneUniforms: host.sceneUniformBuffer });
        }

        // Init GFX manager/renderer (spot animations)
        try {
            host.gfxManager = new GfxManager(host);
            host.gfxRenderer = new GfxRenderer(host, host.gfxManager);
        } catch {}

        // Init projectile manager and renderer
        try {
            host.projectileManager = new ProjectileManager(host);
            host.projectileRenderer = new ProjectileRenderer(host, host.projectileManager);
        } catch {}

        // Create hitsplat overlay now; register it later so it renders after
        // the plugin/world post-present overlays but before widgets.
        try {
            if (host.overlayManager && host.hitsplatProgram && host.sceneUniformBuffer) {
                const hs = new HitsplatOverlay(host.hitsplatProgram, {
                    getCacheSystem: () => host.osrsClient.cacheSystem,
                    getLoadedCacheInfo: () => host.osrsClient.loadedCache?.info,
                    getVarValue: (varbitId: number, varpId: number) => {
                        try {
                            if (varbitId !== -1)
                                return host.osrsClient.varManager.getVarbit(varbitId) | 0;
                            if (varpId !== -1)
                                return host.osrsClient.varManager.getVarp(varpId) | 0;
                        } catch {}
                        return -1;
                    },
                });
                host.hitsplatOverlay = hs;
                // Init may fail if cache not ready - will be reinitialized in initOverlays()
                try {
                    hs.init({ app: host.app, sceneUniforms: host.sceneUniformBuffer });
                } catch {}
            }
        } catch {}

        // Create health bar overlay now; register it later so it renders after
        // the plugin/world post-present overlays but before widgets.
        try {
            if (host.overlayManager && host.hitsplatProgram && host.sceneUniformBuffer) {
                const hb = new HealthBarOverlay(host.hitsplatProgram, {
                    getCacheSystem: () => host.osrsClient.cacheSystem,
                    getLoadedCacheInfo: () => host.osrsClient.loadedCache?.info,
                });
                host.healthBarOverlay = hb;
                // Init may fail if cache not ready - will be reinitialized in initOverlays()
                try {
                    hb.init({ app: host.app, sceneUniforms: host.sceneUniformBuffer });
                } catch {}
            }
        } catch {}

        // Add overhead chat overlay to manager if available
        try {
            if (host.overlayManager && host.hitsplatProgram && host.sceneUniformBuffer) {
                const oh = new OverheadTextOverlay(host.hitsplatProgram, {
                    getCacheSystem: () => host.osrsClient.cacheSystem,
                });
                host.overheadTextOverlay = oh;
                host.overlayManager.add(oh);
                // Init may fail if cache not ready - will be reinitialized in initOverlays()
                try {
                    oh.init({ app: host.app, sceneUniforms: host.sceneUniformBuffer });
                } catch {}
            }
        } catch {}

        // Create overhead prayer overlay now; registered after the health bar overlay
        // so head icons stack above bars in the shared per-actor offset chain.
        try {
            if (host.overlayManager && host.hitsplatProgram && host.sceneUniformBuffer) {
                const op = new OverheadPrayerOverlay(host.hitsplatProgram, {
                    getCacheSystem: () => host.osrsClient.cacheSystem,
                    getLoadedCacheInfo: () => host.osrsClient.loadedCache?.info,
                });
                host.overheadPrayerOverlay = op;
                // Init may fail if cache not ready - will be reinitialized in initOverlays()
                try {
                    op.init({ app: host.app, sceneUniforms: host.sceneUniformBuffer });
                } catch {}
            }
        } catch {}

        // Spot animation overlay removed; will be reimplemented later.

        // Add login screen overlay
        try {
            if (host.overlayManager && host.sceneUniformBuffer) {
                host.loginOverlay = new LoginOverlay(host.osrsClient);
                host.overlayManager.add(host.loginOverlay, false);
                host.loginOverlay.init({ app: host.app, sceneUniforms: host.sceneUniformBuffer });
            }
        } catch (e) {
            console.warn("[WebGLOsrsRenderer] Failed to init login overlay:", e);
        }

        // Add loading message overlay ("Loading - please wait." during LOADING_GAME state)
        // Pass state machine for synchronous state updates
        try {
            if (host.overlayManager && host.sceneUniformBuffer) {
                host.loadingMessageOverlay = new LoadingMessageOverlay(
                    host.osrsClient.stateMachine,
                );
                host.overlayManager.add(host.loadingMessageOverlay, false);
                host.loadingMessageOverlay.init({
                    app: host.app,
                    sceneUniforms: host.sceneUniformBuffer,
                });
            }
        } catch (e) {
            console.warn("[WebGLOsrsRenderer] Failed to init loading message overlay:", e);
        }

        // Add server-path overlay (numbers over tiles returned by pathfind)
        /*try {
            if (host.overlayManager && host.hoverLineProgram && host.sceneUniformBuffer) {
                const { PathOverlay } = await import("../../../ui/devoverlay/PathOverlay");
                const pov = new PathOverlay(host.hoverLineProgram, {
                    getPath: () =>
                        host.osrsClient.showServerPathOverlay
                            ? host.osrsClient.getServerPathWaypoints()
                            : undefined,
                });
                host.overlayManager.add(pov);
                pov.init({ app: host.app, sceneUniforms: host.sceneUniformBuffer });
            }
        } catch {}*/

        // Add object id devoverlay (labels for loc ids around player)
        try {
            if (host.overlayManager && host.hitsplatProgram && host.sceneUniformBuffer) {
                const { ObjectIdOverlay } = await import("../../../ui/devoverlay/ObjectIdOverlay");
                const objOv = new ObjectIdOverlay(host.hitsplatProgram, {
                    getCacheSystem: () => host.osrsClient.cacheSystem,
                    getLocIdsAtTileAllLevels: (tx: number, ty: number) =>
                        host.getLocIdsAtTileAllLevels(tx, ty),
                    isLocInteractable: (id: number) => {
                        try {
                            let lt = host.osrsClient.locTypeLoader.load(id);
                            if (lt.transforms) {
                                const t = lt.transform(
                                    host.osrsClient.varManager,
                                    host.osrsClient.locTypeLoader,
                                );
                                if (t) lt = t;
                            }
                            if (lt.actions) {
                                for (const a of lt.actions) if (a && a.length > 0) return true;
                            }
                            return (lt.isInteractive | 0) === 1;
                        } catch {
                            return false;
                        }
                    },
                });
                objOv.scale = 1.0;
                objOv.color = 0xffffff;
                objOv.radius = Math.max(1, (host.osrsClient.renderDistance / 8) | 0);
                host.objectIdOverlay = objOv;
                host.overlayManager.add(objOv);
                // Init may fail if cache not ready - will be reinitialized in initOverlays()
                try {
                    objOv.init({ app: host.app, sceneUniforms: host.sceneUniformBuffer });
                } catch {}
            }
        } catch {}

        // Add collision devoverlay (walkable tiles around player)
        try {
            if (host.overlayManager && host.hoverLineProgram && host.sceneUniformBuffer) {
                const { WalkableOverlay } = await import("../../../ui/devoverlay/WalkableOverlay");
                const walk = new WalkableOverlay(host.hoverLineProgram);
                walk.radius = 12;
                walk.enabled = !!host.osrsClient.showCollisionOverlay;
                host.overlayManager.add(walk);
                walk.init({ app: host.app, sceneUniforms: host.sceneUniformBuffer });
                host.walkableOverlay = walk;
            }
        } catch {}

        // Add tile marker overlay (hover, destination, and current true tile outline)
        try {
            if (host.overlayManager && host.hoverLineProgram && host.sceneUniformBuffer) {
                const { TileMarkerOverlay } = await import("../../../ui/devoverlay/TileMarkerOverlay");
                const marker = new TileMarkerOverlay(host.hoverLineProgram);
                host.tileMarkerOverlay = marker;
                host.overlayManager.add(marker);
                marker.init({ app: host.app, sceneUniforms: host.sceneUniformBuffer });
            }
        } catch {}

        // Add tile text overlay (3D coordinate labels for hover/dest/player tiles)
        try {
            if (host.overlayManager && host.hitsplatProgram && host.sceneUniformBuffer) {
                const tileText = new TileTextOverlay(host.hitsplatProgram, {
                    getCacheSystem: () => host.osrsClient.cacheSystem,
                });
                host.tileTextOverlay = tileText;
                host.overlayManager.add(tileText);
                // Init may fail if cache not ready - will be reinitialized in initOverlays()
                try {
                    tileText.init({ app: host.app, sceneUniforms: host.sceneUniformBuffer });
                } catch {}
            }
        } catch {}

        // Add click cross devoverlay (sprite id 299 frames 0..3)
        try {
            if (host.overlayManager && host.hitsplatProgram && host.sceneUniformBuffer) {
                const cross = new ClickCrossOverlay(host.hitsplatProgram, {
                    getCacheSystem: () => host.osrsClient.cacheSystem,
                });
                host.clickCrossOverlay = cross;
                host.overlayManager.add(cross);
                // Init may fail if cache not ready - will be reinitialized in initOverlays()
                try {
                    cross.init({ app: host.app, sceneUniforms: host.sceneUniformBuffer });
                } catch {}
            }
        } catch {}

        try {
            if (host.overlayManager && host.hitsplatProgram && host.sceneUniformBuffer) {
                const ground = new GroundItemOverlay(host.hitsplatProgram, {
                    getCacheSystem: () => host.osrsClient.cacheSystem,
                });
                host.groundItemOverlay = ground;
                host.overlayManager.add(ground);
                // Init may fail if cache not ready - will be reinitialized in initOverlays()
                try {
                    ground.init({ app: host.app, sceneUniforms: host.sceneUniformBuffer });
                } catch {}
            }
        } catch {}

        try {
            if (host.overlayManager && host.sceneUniformBuffer) {
                const interact = new InteractHighlightOverlay({
                    getTargets: () => host.getInteractHighlightDrawTargets(),
                });
                host.interactHighlightOverlay = interact;
                host.overlayManager.add(interact);
                try {
                    interact.init({ app: host.app, sceneUniforms: host.sceneUniformBuffer });
                } catch {}
            }
        } catch {}

        // Draw actor damage overlays after the plugin/world post-present overlays so they
        // cannot cover them, but before widgets so game UI still stays on top. Keep
        // Per-actor element order: health bars, then head icons, then hitsplats on top.
        try {
            if (host.overlayManager && host.healthBarOverlay) {
                host.overlayManager.add(host.healthBarOverlay);
            }
            if (host.overlayManager && host.overheadPrayerOverlay) {
                host.overlayManager.add(host.overheadPrayerOverlay);
            }
            if (host.overlayManager && host.hitsplatOverlay) {
                host.overlayManager.add(host.hitsplatOverlay);
            }
        } catch {}

        // Add widgets overlay for UI rendering
        console.log(
            "[WidgetsOverlay init] overlayManager:",
            !!host.overlayManager,
            "uiTabsProgram:",
            !!uiTabsProgram,
            "sceneUniformBuffer:",
            !!host.sceneUniformBuffer,
        );
        try {
            if (host.overlayManager && uiTabsProgram && host.sceneUniformBuffer) {
                // Import necessary modules dynamically
                const { BitmapFont } = await import("../../../rs/font/BitmapFont");
                const { ItemIconRenderer } = await import("../../../ui/item/ItemIconRenderer");
                const { WidgetLoader } = await import("../../../widgets/WidgetLoader");

                // Get required loaders from OsrsClient
                const objLoader = host.osrsClient.objTypeLoader;
                const modelLoader = host.osrsClient.modelLoader;
                const textureLoader = host.osrsClient.textureLoader;
                const idkLoader = host.osrsClient.idkTypeLoader;

                // Create item icon renderer if we have the necessary loaders
                // Will be reinitialized in initOverlays() if not available now
                if (objLoader && modelLoader && textureLoader && !host.itemIconRenderer) {
                    host.itemIconRenderer = new ItemIconRenderer(
                        objLoader,
                        modelLoader,
                        textureLoader,
                        host.osrsClient.cacheSystem,
                    );
                }
                if (modelLoader && textureLoader && idkLoader) {
                    host.playerChatheadFactory = new PlayerChatheadFactory(
                        modelLoader,
                        textureLoader,
                        idkLoader,
                    );
                }

                // Root interface is set by the server via set_root widget event
                let resolvedGroupId: number | undefined;
                if (!host.osrsClient.widgetManager && host.osrsClient.cacheSystem) {
                    host.osrsClient.widgetManager = new WidgetManager(host.osrsClient.cacheSystem);
                }

                const computeWidgetRoots = (): any[] => {
                    const manager = host.osrsClient.widgetManager;
                    const roots: any[] = [];

                    // NOTE: beginFrame() is now called at the END of draw, not here.
                    // This ensures dirty flags set during the frame are visible to the dirty check.

                    // Widget layout runs in renderer-defined UI space and renders directly into the
                    // canvas buffer.
                    const bufW = host.app.width;
                    const bufH = host.app.height;
                    const metrics = host.computeUiRenderMetrics(bufW, bufH);
                    const layoutW = metrics.layoutW;
                    const layoutH = metrics.layoutH;
                    const widgetRenderScaleX = metrics.renderScaleX;
                    const widgetRenderScaleY = metrics.renderScaleY;
                    const widgetRenderOffsetX = metrics.renderOffsetX;
                    const widgetRenderOffsetY = metrics.renderOffsetY;

                    // Keep CS2 IF_GETCANVASSIZE / widget manager dimensions aligned with the active
                    // widget layout space.
                    manager?.resize(layoutW, layoutH);
                    const frame = host.osrsClient.clientPlugins.activeGameFrame();
                    if (frame?.updateWidgetLayout) frame.updateWidgetLayout();
                    else host.osrsClient.gameFrame317Plugin.updateWidgetLayout();

                    // Get the current root interface (set by server via IF_OPENTOPLEVEL)
                    // OSRS interfaces can have multiple root widgets (parentUid=-1)
                    // All of them need to be rendered as top-level layers
                    const currentRootInterface = manager?.rootInterface ?? -1;
                    if (currentRootInterface !== -1) {
                        const allRoots = manager?.getAllGroupRoots(currentRootInterface) ?? [];

                        // Helper to count children (both dynamic from children array AND static from parentUid)
                        const getChildCount = (w: any): number => {
                            const dynamicCount = w.children?.length ?? 0;
                            // also count static children from parentUid filtering
                            const staticCount =
                                manager?.getStaticChildrenByParentUid(w.uid)?.length ?? 0;
                            return dynamicCount + staticCount;
                        };

                        for (const viewportRoot of allRoots) {
                            if (viewportRoot) {
                                // Layout each root independently in the current UI layout space.
                                // Pass static children callback for
                                const getStaticChildren = (uid: number) =>
                                    manager?.getStaticChildrenByParentUid(uid) ?? [];
                                layoutWidgets(
                                    viewportRoot,
                                    layoutW | 0,
                                    layoutH | 0,
                                    getStaticChildren,
                                );

                                // Skip empty layer roots from rendering
                                const childCount = getChildCount(viewportRoot);
                                const hasMountedInterface =
                                    manager?.interfaceParents.has(viewportRoot.uid) === true;
                                const hasVisualContent =
                                    viewportRoot.type !== 0 ||
                                    childCount > 0 ||
                                    hasMountedInterface ||
                                    (typeof viewportRoot.spriteId === "number" &&
                                        viewportRoot.spriteId >= 0) ||
                                    (typeof viewportRoot.spriteId2 === "number" &&
                                        viewportRoot.spriteId2 >= 0) ||
                                    viewportRoot.filled;

                                if (!hasVisualContent) {
                                    continue;
                                }

                                // Register root widget for dirty tracking
                                const rootAny = viewportRoot as any;
                                rootAny.__widgetRenderScale = widgetRenderScaleX;
                                rootAny.__widgetRenderScaleX = widgetRenderScaleX;
                                rootAny.__widgetRenderScaleY = widgetRenderScaleY;
                                rootAny.__widgetRenderOffsetX = widgetRenderOffsetX;
                                rootAny.__widgetRenderOffsetY = widgetRenderOffsetY;
                                const rootX = (viewportRoot.x ?? 0) | 0;
                                const rootY = (viewportRoot.y ?? 0) | 0;
                                const rootW = (viewportRoot.width ?? layoutW) | 0;
                                const rootH = (viewportRoot.height ?? layoutH) | 0;
                                const drawX = Math.round(
                                    rootX * widgetRenderScaleX + widgetRenderOffsetX,
                                );
                                const drawY = Math.round(
                                    rootY * widgetRenderScaleY + widgetRenderOffsetY,
                                );
                                const drawRight = Math.round(
                                    (rootX + rootW) * widgetRenderScaleX + widgetRenderOffsetX,
                                );
                                const drawBottom = Math.round(
                                    (rootY + rootH) * widgetRenderScaleY + widgetRenderOffsetY,
                                );
                                manager?.registerRootWidget(
                                    viewportRoot,
                                    drawX,
                                    drawY,
                                    Math.max(1, drawRight - drawX),
                                    Math.max(1, drawBottom - drawY),
                                );

                                roots.push(viewportRoot);
                            }
                        }
                        if (allRoots.length > 0 && resolvedGroupId !== currentRootInterface) {
                            resolvedGroupId = currentRootInterface;
                        }
                    }

                    return roots;
                };

                const widgets = new WidgetsOverlay(uiTabsProgram, {
                    getCacheSystem: () => host.osrsClient.cacheSystem,
                    getWidgetManager: () => host.osrsClient.widgetManager,
                    getGameContext: () => ({
                        osrsClient: host.osrsClient,
                        playerEcs: host.osrsClient.playerEcs,
                        controlledPlayerServerId: host.osrsClient.controlledPlayerServerId,
                        combatWeaponCategory: host.osrsClient.combatWeaponCategory,
                        combatWeaponItemId: host.osrsClient.combatWeaponItemId,
                        sendEmote,
                    }),
                    getFontLoader: () => {
                        // PERF: Cache loaded BitmapFonts (loading parses cache archives/sprites).
                        const cache = new Map<number, ReturnType<typeof BitmapFont.tryLoad>>();
                        return (id: number) => {
                            const cacheSystem = host.osrsClient.cacheSystem;
                            if (!cacheSystem) return undefined;
                            const key = id | 0;
                            if (cache.has(key)) return cache.get(key);
                            const font = BitmapFont.tryLoad(cacheSystem, key);
                            // Do not memoize missing fonts forever. During startup the widget overlay
                            // can probe a font before the cache data is fully ready, and a permanent
                            // cached undefined would make all later CS2 text for that font invisible.
                            if (font) {
                                cache.set(key, font);
                            }
                            return font;
                        };
                    },
                    getWidgetRoots: () => computeWidgetRoots(),
                    getWidgetRoot: () => {
                        const roots = computeWidgetRoots();
                        return roots.length > 0 ? roots[roots.length - 1] : undefined;
                    },
                    getItemIconCanvas:
                        () =>
                            (
                                itemId: number,
                                qty?: number,
                                outline?: number,
                                shadow?: number,
                                quantityMode?: number,
                            ) => {
                                // Use ItemIconRenderer to render item icons
                                if (host.itemIconRenderer) {
                                    return host.itemIconRenderer.renderToCanvas(itemId, qty ?? 1, {
                                        outline,
                                        shadow,
                                        quantityMode,
                                    });
                                }
                                return undefined;
                            },
                    getObjLoader: () => {
                        // Return the object loader from OsrsClient
                        return host.osrsClient.objTypeLoader;
                    },
                    getRenderModelCanvas:
                        () => (modelId: number, params: any, width: number, height: number) => {
                            if (!host.model2DRenderer) {
                                host.model2DRenderer = new Model2DRenderer(
                                    host.osrsClient.objTypeLoader,
                                    host.osrsClient.modelLoader,
                                    host.osrsClient.textureLoader,
                                    host.osrsClient.seqTypeLoader,
                                    host.osrsClient.seqFrameLoader,
                                    host.osrsClient.skeletalSeqLoader,
                                );
                            }

                            if (params.widget) {
                                const isPlayerModelWidget =
                                    ((params.widget.contentType ?? 0) | 0) === 328 ||
                                    ((params.widget.modelType ?? 0) | 0) === 7 ||
                                    (params.widget as any).isPlayerModel === true;
                                if (isPlayerModelWidget) {
                                    const haveLoaders =
                                        host.osrsClient.modelLoader &&
                                        host.osrsClient.textureLoader &&
                                        host.osrsClient.idkTypeLoader &&
                                        host.osrsClient.objTypeLoader;
                                    if (!host.playerModelLoader2D && haveLoaders) {
                                        host.playerModelLoader2D = new PlayerModelLoader(
                                            host.osrsClient.idkTypeLoader,
                                            host.osrsClient.objTypeLoader,
                                            host.osrsClient.modelLoader,
                                            host.osrsClient.textureLoader,
                                        );
                                    }

                                    const wAny = params.widget as any;
                                    const keepEquipment =
                                        typeof wAny.playerModelKeepEquipment === "boolean"
                                            ? (wAny.playerModelKeepEquipment as boolean)
                                            : true;
                                    // contentType=328 renders the local player model.
                                    // Prefer the ECS local-player appearance so server-driven updates
                                    // (PlayerDesign arrows) reflect immediately, even if the widget
                                    // has a stale `playerAppearance` snapshot.
                                    const localAppearance = (() => {
                                        const idx = host.osrsClient.playerEcs.getIndexForServerId(
                                            host.osrsClient.controlledPlayerServerId,
                                        );
                                        return idx !== undefined
                                            ? host.osrsClient.playerEcs.getAppearance(idx)
                                            : undefined;
                                    })();
                                    const appearanceSrc =
                                        ((params.widget as any).contentType | 0) === 328
                                            ? localAppearance || wAny.playerAppearance
                                            : wAny.playerAppearance || localAppearance;

                                    if (host.playerModelLoader2D && appearanceSrc) {
                                        const gender =
                                            typeof appearanceSrc.gender === "number"
                                                ? appearanceSrc.gender | 0
                                                : 0;
                                        const colors = Array.isArray(appearanceSrc.colors)
                                            ? appearanceSrc.colors
                                                .slice(0, 5)
                                                .map((n: any) =>
                                                    Number.isFinite(n) ? (n | 0) & 0xff : 0,
                                                )
                                            : [0, 0, 0, 0, 0];
                                        const kits = Array.isArray(appearanceSrc.kits)
                                            ? appearanceSrc.kits
                                                .slice(0, 7)
                                                .map((n: any) =>
                                                    Number.isFinite(n) ? n | 0 : -1,
                                                )
                                            : new Array(7).fill(-1);
                                        const equip = Array.isArray(appearanceSrc.equip)
                                            ? appearanceSrc.equip
                                                .slice(0, 14)
                                                .map((n: any) =>
                                                    Number.isFinite(n) ? n | 0 : -1,
                                                )
                                            : new Array(14).fill(-1);
                                        if (!keepEquipment) {
                                            for (let i = 0; i < equip.length; i++) equip[i] = -1;
                                        }
                                        const pa = new PlayerAppearance(
                                            gender,
                                            colors,
                                            kits,
                                            equip,
                                        );

                                        // contentType=328 uses KeyHandler.localPlayer.getModel().
                                        // Our ECS base-model pipeline applies additional alignment (to NPC "man")
                                        // which is correct for in-world rendering, but skews UI preview offsets.
                                        // For widget rendering, prefer the raw PlayerComposition model build.
                                        let model: any | undefined;
                                        if (host.playerModelLoader2D) {
                                            model =
                                                host.playerModelLoader2D.buildStaticModelFromEquipment(
                                                    pa,
                                                    pa.equip,
                                                );
                                        }
                                        if (model) {
                                            // Widget type-6 models render into the *parent clip*,
                                            // not the widget bounds. This means player models can overflow the
                                            // widget rectangle (e.g., equipment/league summary) and still be visible.
                                            //
                                            // Render to tight extents and let the widget scissor stack (container clip)
                                            // match the client's behaviour.
                                            return host.model2DRenderer.renderModelInstanceToCanvasExtents(
                                                model,
                                                params,
                                            );
                                        }
                                    }
                                }

                                if (
                                    params.widget.isNpcChathead &&
                                    typeof params.widget.npcTypeId === "number"
                                ) {
                                    if (!host.chatheadFactory) {
                                        host.chatheadFactory = new ChatheadFactory(
                                            host.osrsClient.modelLoader,
                                            host.osrsClient.textureLoader,
                                        );
                                    }
                                    const npcTypeId = params.widget.npcTypeId;
                                    const baseNpcType =
                                        host.osrsClient.npcTypeLoader.load(npcTypeId);
                                    const npcType =
                                        baseNpcType?.transform?.(
                                            host.osrsClient.varManager,
                                            host.osrsClient.npcTypeLoader,
                                        ) ?? baseNpcType;
                                    const portrait = params.widget.npcPortraitFit === true;
                                    if (
                                        npcType &&
                                        npcType.chatheadModelIds &&
                                        npcType.chatheadModelIds.length > 0
                                    ) {
                                        const chatModel = host.chatheadFactory.get(npcType);
                                        if (chatModel) {
                                            return host.model2DRenderer.renderModelInstanceToCanvasExtents(
                                                chatModel,
                                                portrait ? fitPortraitParams(chatModel, params) : params,
                                            );
                                        }
                                    }
                                    if (portrait) {
                                        // ::npcs rows: most npcs have no chathead, so fall back to the
                                        // body model. Both builders cache per npc id.
                                        const npcModelLoader = npcType
                                            ? host.getInteractNpcModelLoader()
                                            : undefined;
                                        const bodyModel = npcType
                                            ? npcModelLoader?.getModel(npcType, -1, -1)
                                            : undefined;
                                        if (bodyModel) {
                                            return host.model2DRenderer.renderModelInstanceToCanvasExtents(
                                                bodyModel,
                                                fitPortraitParams(bodyModel, params),
                                            );
                                        }
                                        // modelId is an npc id here, never a model id: draw nothing
                                        // rather than whatever model happens to share the number.
                                        return undefined;
                                    }
                                } else if (params.widget.isPlayerChathead) {
                                    const haveLoaders =
                                        host.osrsClient.modelLoader &&
                                        host.osrsClient.textureLoader &&
                                        host.osrsClient.idkTypeLoader &&
                                        host.osrsClient.objTypeLoader;

                                    // Recreate factory if missing or if it was built before objTypeLoader was ready
                                    if (
                                        !host.playerChatheadFactory ||
                                        !(host.playerChatheadFactory as any)["objTypeLoader"]
                                    ) {
                                        if (haveLoaders) {
                                            host.playerChatheadFactory = new PlayerChatheadFactory(
                                                host.osrsClient.modelLoader,
                                                host.osrsClient.textureLoader,
                                                host.osrsClient.idkTypeLoader,
                                                host.osrsClient.objTypeLoader,
                                            );
                                        }
                                    }
                                    const appearance =
                                        params.widget.playerAppearance ||
                                        (() => {
                                            const idx =
                                                host.osrsClient.playerEcs.getIndexForServerId(
                                                    host.osrsClient.controlledPlayerServerId,
                                                );
                                            return idx !== undefined
                                                ? host.osrsClient.playerEcs.getAppearance(idx)
                                                : undefined;
                                        })();
                                    if (host.playerChatheadFactory && appearance) {
                                        const chatModel =
                                            host.playerChatheadFactory.get(appearance);
                                        if (chatModel) {
                                            return host.model2DRenderer.renderModelInstanceToCanvasExtents(
                                                chatModel,
                                                params,
                                            );
                                        }
                                    }
                                }
                            }

                            const widgetAny = params.widget as any;
                            const itemId = widgetAny?.itemId;
                            if (typeof itemId === "number" && itemId >= 0) {
                                try {
                                    const qty = (widgetAny?.itemQuantity ?? 0) | 0 || 1;
                                    return host.model2DRenderer.renderItemToCanvasExtents(
                                        itemId | 0,
                                        qty,
                                        params,
                                        width,
                                        height,
                                    );
                                } catch {}
                            }

                            if (modelId < 0) {
                                return undefined;
                            }

                            return host.model2DRenderer.renderToCanvasExtents(
                                modelId,
                                params,
                                width,
                                height,
                            );
                        },
                });
                host.widgetsOverlay = widgets;
                host.overlayManager.add(widgets, false);
                // Init may fail if cache not ready - will be reinitialized in initOverlays()
                try {
                    widgets.init({ app: host.app, sceneUniforms: host.sceneUniformBuffer });
                } catch {}
                console.log(
                    "WebGLOsrsClientRenderer: WidgetsOverlay initialized and added to overlay manager",
                );
            }
        } catch (e) {
            console.error("Failed to initialize WidgetsOverlay:", e);
        }

        return host.frameFxaaProgram ? [...programs, host.frameFxaaProgram] : programs;
    
}
