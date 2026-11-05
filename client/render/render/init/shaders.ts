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
import { TutorialHintOverlay } from "../../../ui/devoverlay/TutorialHintOverlay";
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
import {
    canTargetGroundItem,
    canTargetNpc,
    canTargetObject,
    canTargetPlayer,
} from "../../../widgets/WidgetFlags";
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
import { type DrawBackend, createDrawBackend } from "../../DrawBackend";
import { DrawRange, NULL_DRAW_RANGE, newDrawRange } from "../../DrawRange";
import { InteractType } from "../../InteractType";
import { profiler } from "../../PerformanceProfiler";
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
import { createWidgetsOverlay } from "../../../widgets/gl/widgetsOverlayFactory";
import type { WebGLOsrsRendererHost } from "../hostInterface";
import { RENDER_CONSTANTS } from "../constants";

/** The world and actor programs, as the plugins currently want them (order matches initShaders). */
function sceneProgramSources(host: WebGLOsrsRendererHost) {
        const supportsMultiDraw = host.drawBackend?.supportsMultiDraw ?? false;
        return [
            createMainProgram(false, supportsMultiDraw),
            createMainProgram(true, supportsMultiDraw),
            createNpcProgram(true, supportsMultiDraw),
            createNpcProgram(false, supportsMultiDraw),
            createProjectileProgram(true, supportsMultiDraw),
            createProjectileProgram(false, supportsMultiDraw),
            createPlayerProgram(true, supportsMultiDraw),
            createPlayerProgram(false, supportsMultiDraw),
        ].map((source) => host.osrsClient.clientPlugins.transformSceneProgram(source));
}

// PicoGL keeps these on every Program but leaves them out of its declarations.
type LinkedProgram = Program & {
    program: WebGLProgram;
    vertexSource: string;
    fragmentSource: string;
    uniforms: Record<string, unknown>;
    samplers: Record<string, number>;
    samplerCount: number;
    uniformBlocks: Record<string, number>;
    uniformBlockCount: number;
    appState: { program: unknown };
};

/**
 * Recompiles the scene programs from the plugins' current sources (a plugin that changes what it
 * adds, like 117 HD on toggle, calls this). Every draw call holds its Program object, so the
 * objects stay and only their GL programs are swapped.
 */
export async function rebuildScenePrograms(host: WebGLOsrsRendererHost): Promise<void> {
        const targets = [
            host.mainProgram, host.mainAlphaProgram, host.npcProgram, host.npcProgramOpaque,
            host.projectileProgram, host.projectileProgramOpaque, host.playerProgram, host.playerProgramOpaque,
        ] as LinkedProgram[];
        const fresh = (await host.app.createPrograms(...sceneProgramSources(host))) as LinkedProgram[];
        targets.forEach((target, i) => adoptProgram(host.gl, target, fresh[i]));
}

/**
 * Moves `fresh`'s GL program into `target`. Draw calls hold their textures and uniform buffers by
 * unit, so a sampler or block keeps the unit `target` gave it by name, a new one takes the next
 * free unit, and names the new program lacks keep theirs (their textures are still bound).
 */
function adoptProgram(gl: WebGL2RenderingContext, target: LinkedProgram, fresh: LinkedProgram): void {
        const next = (units: Record<string, number>) => Math.max(-1, ...Object.values(units)) + 1;
        gl.useProgram(fresh.program);
        for (const name of Object.keys(fresh.samplers)) {
            target.samplers[name] ??= next(target.samplers);
            gl.uniform1i(gl.getUniformLocation(fresh.program, name), target.samplers[name]);
        }
        for (const name of Object.keys(fresh.uniformBlocks)) {
            target.uniformBlocks[name] ??= next(target.uniformBlocks);
            gl.uniformBlockBinding(fresh.program, gl.getUniformBlockIndex(fresh.program, name), target.uniformBlocks[name]);
        }
        target.samplerCount = next(target.samplers);
        target.uniformBlockCount = next(target.uniformBlocks);
        gl.deleteProgram(target.program);
        target.program = fresh.program;
        target.uniforms = fresh.uniforms;
        target.vertexSource = fresh.vertexSource;
        target.fragmentSource = fresh.fragmentSource;
        // Neither PicoGL wrapper is current any more: the next bind() uses the new program.
        target.appState.program = null;
}

export async function initShaders(host: WebGLOsrsRendererHost, ): Promise<Program[]> {

        // Create FXAA separately so a Metal/ANGLE link failure on iOS Safari
        // cannot reject the entire program batch (player/NPC/etc.).
        const programs = await host.app.createPrograms(
            ...sceneProgramSources(host),
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

        // Register the native Tutorial Island hint arrow overlay.
        try {
            if (host.overlayManager && host.hitsplatProgram && host.sceneUniformBuffer) {
                const hint = new TutorialHintOverlay(host.hitsplatProgram, {
                    getCacheSystem: () => host.osrsClient.cacheSystem,
                    getClient: () => host.osrsClient,
                    resolveNpcOverlayAnchor: (ecsId, x, z, typeId) =>
                        host.resolveNpcOverlayAnchor(ecsId, x, z, typeId),
                });
                host.tutorialHintOverlay = hint;
                host.overlayManager.add(hint);
                try {
                    hint.init({ app: host.app, sceneUniforms: host.sceneUniformBuffer });
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
                host.loadingMessageOverlay.setSceneLoadingSource(
                    () => !host.mapManager.isViewSquareReady(host.stats.frameCount),
                );
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
        try {
            if (host.overlayManager && uiTabsProgram && host.sceneUniformBuffer) {
                host.widgetsOverlay = createWidgetsOverlay(host);
                if (host.widgetsOverlay) {
                    host.overlayManager.add(host.widgetsOverlay, false);
                }
            }
        } catch (e) {
            console.error("Failed to initialize WidgetsOverlay:", e);
        }

        return host.frameFxaaProgram ? [...programs, host.frameFxaaProgram] : programs;
    
}
