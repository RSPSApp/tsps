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

export function shouldUseMobileLoginInput(host: WebGLOsrsRendererHost, ): boolean {

        const state = host.osrsClient.loginState;
        return (
            host.osrsClient.isOnLoginScreen() &&
            state.loginIndex === LoginIndex.LOGIN_FORM &&
            state.virtualKeyboardVisible === true
        );
    
}

export function getCanvasTouchPos(host: WebGLOsrsRendererHost, touch: Touch): { x: number; y: number } {

        const [x, y] = getMousePos(host.canvas, touch);
        return {
            x: x | 0,
            y: y | 0,
        };
    
}

export function resolveLoginFieldAt(host: WebGLOsrsRendererHost, y: number): 0 | 1 | undefined {

        if (y >= host.LOGIN_FIELD_BASE_Y - 12 && y < host.LOGIN_FIELD_BASE_Y + 3) {
            return 0;
        }
        if (y >= host.LOGIN_FIELD_BASE_Y + 3 && y < host.LOGIN_FIELD_BASE_Y + 18) {
            return 1;
        }
        return undefined;
    
}

export function resolveLoginFieldAtCanvasPoint(host: WebGLOsrsRendererHost, x: number, y: number): 0 | 1 | undefined {

        const loginRenderer = host.osrsClient.loginRenderer;
        const uiMetrics = host.computeUiRenderMetrics(host.canvas.width, host.canvas.height);
        loginRenderer.syncMobileViewportState(
            host.osrsClient.loginState,
            host.isMobileLoginKeyboardOpen(),
        );
        loginRenderer.updateLayout(
            uiMetrics.layoutW,
            uiMetrics.layoutH,
            host.canvas.width,
            host.canvas.height,
        );
        loginRenderer.setMousePosition(x, y);
        const content = loginRenderer.mapPointerToContent(
            loginRenderer.mouseX,
            loginRenderer.mouseY,
        );
        return host.resolveLoginFieldAt(content.y);
    
}

export function isMobileLoginInputActive(host: WebGLOsrsRendererHost, ): boolean {

        return host.isMobileLoginKeyboardOpen();
    
}

export function readMobileLoginViewportMetrics(host: WebGLOsrsRendererHost, ):
        | { width: number; height: number; offsetLeft: number; offsetTop: number }
        | undefined {

        if (typeof window === "undefined") {
            return undefined;
        }

        const viewport = window.visualViewport;
        const width = Math.round(viewport?.width ?? window.innerWidth ?? 0);
        const height = Math.round(viewport?.height ?? window.innerHeight ?? 0);
        if (!(width > 0) || !(height > 0)) {
            return undefined;
        }

        return {
            width,
            height,
            offsetLeft: Math.round(viewport?.offsetLeft ?? 0),
            offsetTop: Math.round(viewport?.offsetTop ?? 0),
        };
    
}

export function updateMobileLoginViewportBaseline(host: WebGLOsrsRendererHost, force: boolean = false): void {

        const viewport = host.readMobileLoginViewportMetrics();
        if (!viewport) {
            return;
        }

        const widthChanged =
            host.mobileLoginViewportBaselineWidth <= 0 ||
            Math.abs(viewport.width - host.mobileLoginViewportBaselineWidth) > 40;
        if (
            force ||
            widthChanged ||
            !host.mobileLoginInputFocused ||
            !host.mobileLoginKeyboardOpen ||
            viewport.height > host.mobileLoginViewportBaselineHeight
        ) {
            host.mobileLoginViewportBaselineWidth = viewport.width;
            host.mobileLoginViewportBaselineHeight = viewport.height;
        }
    
}

export function refreshMobileLoginKeyboardState(host: WebGLOsrsRendererHost, ): boolean {

        if (!host.mobileLoginInputFocused) {
            host.mobileLoginKeyboardOpen = false;
            host.updateMobileLoginViewportBaseline(true);
            return false;
        }

        if (typeof window === "undefined") {
            host.mobileLoginKeyboardOpen = true;
            return true;
        }

        const viewport = window.visualViewport;
        if (!viewport) {
            host.mobileLoginKeyboardOpen = true;
            return true;
        }

        const width = Math.round(viewport.width);
        const height = Math.round(viewport.height);
        const offsetTop = Math.round(viewport.offsetTop ?? 0);
        const widthChanged =
            host.mobileLoginViewportBaselineWidth <= 0 ||
            Math.abs(width - host.mobileLoginViewportBaselineWidth) > 40;
        if (widthChanged) {
            host.mobileLoginViewportBaselineWidth = width;
            host.mobileLoginViewportBaselineHeight = height;
            host.mobileLoginKeyboardOpen = false;
            return false;
        }

        if (height >= host.mobileLoginViewportBaselineHeight - 20 && offsetTop < 20) {
            host.mobileLoginViewportBaselineHeight = height;
        }

        const heightDelta = host.mobileLoginViewportBaselineHeight - height;
        host.mobileLoginKeyboardOpen = heightDelta >= 80 || offsetTop >= 40;
        return host.mobileLoginKeyboardOpen;
    
}

export function isMobileLoginKeyboardOpen(host: WebGLOsrsRendererHost, ): boolean {

        return host.refreshMobileLoginKeyboardState();
    
}

export function syncMobileLoginInputPosition(host: WebGLOsrsRendererHost, ): void {

        const input = host.mobileLoginInput;
        if (!input) {
            return;
        }

        const viewport = host.readMobileLoginViewportMetrics();
        if (!viewport) {
            input.style.left = "50%";
            input.style.top = "46%";
            input.style.transform = "translate(-50%, -50%)";
            return;
        }

        const focusRatioY = 0.46;
        input.style.left = `${viewport.offsetLeft + Math.round(viewport.width / 2)}px`;
        input.style.top = `${viewport.offsetTop + Math.round(viewport.height * focusRatioY)}px`;
        input.style.transform = "translate(-50%, -50%)";
    
}

export function requestMobileLoginKeyboard(host: WebGLOsrsRendererHost, field: 0 | 1): void {

        const state = host.osrsClient.loginState;
        state.currentLoginField = field;
        state.onMobile = true;
        state.virtualKeyboardVisible = true;
        if (!host.mobileLoginInputFocused && !host.mobileLoginKeyboardOpen) {
            host.updateMobileLoginViewportBaseline(true);
        }
        const input = host.ensureMobileLoginInput();
        if (
            input &&
            typeof document !== "undefined" &&
            document.activeElement === input &&
            !host.isMobileLoginKeyboardOpen()
        ) {
            host.allowMobileLoginInputBlur = true;
            host.preserveMobileLoginInputModeOnBlur = true;
            input.blur();
        }
        host.syncMobileLoginInput(true);
    
}

export function syncLoginRendererLayoutForCanvas(host: WebGLOsrsRendererHost, ): void {

        const loginRenderer = host.osrsClient.loginRenderer;
        const uiMetrics = host.computeUiRenderMetrics(host.canvas.width, host.canvas.height);
        loginRenderer.syncMobileViewportState(
            host.osrsClient.loginState,
            host.isMobileLoginKeyboardOpen(),
        );
        loginRenderer.updateLayout(
            uiMetrics.layoutW,
            uiMetrics.layoutH,
            host.canvas.width,
            host.canvas.height,
        );
    
}

export function getActiveLoginFieldValue(host: WebGLOsrsRendererHost, ): string {

        const state = host.osrsClient.loginState;
        return state.currentLoginField === 0 ? state.username : state.password;
    
}

export function setActiveLoginFieldValue(host: WebGLOsrsRendererHost, raw: string): void {

        const state = host.osrsClient.loginState;
        if (state.currentLoginField === 0) {
            state.username = raw.slice(0, 320);
        } else {
            state.password = raw.slice(0, 20);
        }
        state.savePersistedLoginState();
    
}

export function ensureMobileLoginInput(host: WebGLOsrsRendererHost, ): HTMLInputElement | undefined {

        const existing = host.mobileLoginInput;
        if (existing && existing.isConnected) {
            return existing;
        }

        if (typeof document === "undefined") return undefined;

        const input = document.createElement("input");
        input.type = "text";
        input.autocomplete = "off";
        input.autocapitalize = "none";
        input.setAttribute("autocorrect", "off");
        input.spellcheck = false;
        input.inputMode = "email";
        (input as any).enterKeyHint = "next";
        input.tabIndex = -1;
        input.style.position = "fixed";
        input.style.width = "16px";
        input.style.height = "16px";
        input.style.opacity = "0";
        input.style.pointerEvents = "none";
        input.style.border = "0";
        input.style.margin = "0";
        input.style.padding = "0";
        input.style.background = "transparent";
        input.style.color = "transparent";
        input.style.caretColor = "transparent";
        input.style.fontSize = "16px";

        input.addEventListener("input", host.onMobileLoginInput);
        input.addEventListener("keydown", host.onMobileLoginKeyDown);
        input.addEventListener("focus", host.onMobileLoginInputFocus);
        input.addEventListener("blur", host.onMobileLoginInputBlur);
        document.body.appendChild(input);
        host.mobileLoginInput = input;
        host.syncMobileLoginInputPosition();
        return input;
    
}

export function destroyMobileLoginInput(host: WebGLOsrsRendererHost, ): void {

        const input = host.mobileLoginInput;
        if (!input) return;
        input.removeEventListener("input", host.onMobileLoginInput);
        input.removeEventListener("keydown", host.onMobileLoginKeyDown);
        input.removeEventListener("focus", host.onMobileLoginInputFocus);
        input.removeEventListener("blur", host.onMobileLoginInputBlur);
        try {
            input.remove();
        } catch {}
        host.mobileLoginInput = undefined;
        host.mobileLoginInputFocused = false;
        host.mobileLoginKeyboardOpen = false;
    
}

export function syncMobileLoginInput(host: WebGLOsrsRendererHost, focus: boolean): void {

        if (!host.shouldUseMobileLoginInput()) {
            const input = host.mobileLoginInput;
            if (input && document.activeElement === input) {
                host.allowMobileLoginInputBlur = true;
                host.preserveMobileLoginInputModeOnBlur = false;
                input.blur();
            }
            return;
        }

        const input = host.ensureMobileLoginInput();
        if (!input) return;

        const state = host.osrsClient.loginState;
        const wantsPassword = state.currentLoginField === 1;
        const nextType = wantsPassword ? "password" : "text";
        if (input.type !== nextType) {
            input.type = nextType;
        }
        input.inputMode = wantsPassword ? "text" : "email";
        (input as any).enterKeyHint = wantsPassword ? "go" : "next";

        const value = host.getActiveLoginFieldValue();
        if (input.value !== value) {
            input.value = value;
        }

        host.syncMobileLoginInputPosition();

        if (focus && document.activeElement !== input) {
            try {
                input.focus({ preventScroll: true });
            } catch {
                input.focus();
            }
        }
        if (focus) {
            const end = input.value.length;
            input.setSelectionRange(end, end);
        }
    
}
