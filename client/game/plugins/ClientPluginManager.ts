import type { WidgetActionEvent } from "../widgets/widgetActionPayload";
import type { Camera } from "../Camera";
import type { HitsplatEventPayload } from "../GameRenderer";
import type { InputManager } from "../InputManager";
import type { DrawCall, Program } from "picogl";
import type { ProgramSource } from "../../render/shaders/ShaderUtil";
import type { WebGLOsrsRenderer } from "../../render/WebGLOsrsRenderer";
import type { GLRenderer } from "../../widgets/gl/renderer";
import type { ClickRegistry } from "../../widgets/gl/click-registry";
import type { SimpleMenuEntry } from "../../ui/menu/MenuEngine";
import type { MenuTransformContext } from "../../ui/menu/menuTransforms";
import type { FontLoader } from "../../widgets/components/TextRenderer";
import type { IndexedSprite } from "../../rs/sprite/IndexedSprite";
import type { OverlayPosition } from "@runelite/client/ui/overlay/OverlayPosition";
import type { Cs2Vm } from "../../rs/cs2/Cs2Vm";
import type {
    WebGPUSceneExtension,
    WebGPUSceneExtensionContext,
} from "../../render/webgpu/sceneExtension";
import { createElement, Fragment, type ReactNode } from "react";
import type { OsrsClient } from "../OsrsClient";
import type { ClientGroundItemStack, GroundItemOverlayEntry } from "../data/ground/GroundItemStore";
import type { LoginStretch } from "../login/renderer/types";
import type { WebGLOsrsRendererHost } from "../../render/render/hostInterface";
import type { OverheadTextEntry } from "../../ui/devoverlay/Overlay";
import type { GpuSettings } from "./gpu/GpuPlugin";
import type { InteractHighlightPluginConfig } from "./interacthighlight/InteractHighlightConfig";
import type { FixedStretch } from "./stretchedmode/StretchedModePlugin";
import { DISABLED_TILE_MARKERS_CONFIG, type TileMarkersPluginConfig } from "./tilemarkers/TileMarkersConfig";

/**
 * Draw/input context handed to a plugin that supplies a custom gameframe (the
 * sidebar and chatbox). Coordinates are the overlay canvas in device pixels, the
 * same space the widget overlay draws into.
 */
export type GameFrameDrawContext = {
    renderer: GLRenderer;
    /** Multiplier from widget layout units to canvas pixels. */
    renderScaleX: number;
    renderScaleY: number;
    renderOffsetX: number;
    renderOffsetY: number;
    switchTab(tab: number): void;
    /** Resolved rects (logical units) of the content the frame decorates. */
    anchors: {
        chat?: { x: number; y: number; width: number; height: number };
        tabContent?: { x: number; y: number; width: number; height: number };
    };
    /** Rebuilt each UI frame; register tab hit regions here. */
    clicks?: ClickRegistry;
};

export interface GameFrameProvider {
    isGameFrameActive(): boolean;
    /** Hide stock widgets by uid/group/type/contentType (e.g. the OSRS compass). */
    widgetRules?(): {
        uid?: number;
        group?: number;
        type?: number;
        contentType?: number;
        item?: boolean;
        colour?: number;
        hide?: boolean;
    }[];
    /** Root-interface uids whose own chrome must NOT be hidden by hideStockChrome. */
    keepChrome?(): number[];
    /**
     * Return true while active to hide the stock root interface's own decorative
     * widgets (backgrounds/borders), keeping its mounted content (tab interfaces,
     * minimap, chat). Lets a custom frame replace the chrome without doubling up.
     */
    hideStockChrome?(): boolean;
    drawGameFrame(context: GameFrameDrawContext): void;
}

/** Draw context for a `WidgetOverlay`; coordinates are device pixels on the UI canvas. */
export type WidgetOverlayDrawContext = {
    renderer: GLRenderer;
    fontLoader: FontLoader;
    /** A cache sprite as a texture. */
    sprite(id: number): { tex: WebGLTexture; w: number; h: number } | undefined;
    /** Where a movable overlay of this size (layout units) draws this frame; nothing while the HUD is hidden. */
    place(overlay: WidgetOverlay, width: number, height: number): OverlayPlacement | undefined;
};

/** A movable overlay's top left in device pixels, and the device pixels per layout unit. */
export type OverlayPlacement = { x: number; y: number; scaleX: number; scaleY: number };

/** UI drawn above the widgets and under the right-click menu (RuneLite's ABOVE_WIDGETS). */
export interface WidgetOverlay {
    /** Changes whenever the drawing would; a change redraws the UI. */
    signature(): string;
    /** Draws the overlay and returns the device rects it covered. */
    draw(context: WidgetOverlayDrawContext): { x: number; y: number; w: number; h: number }[];
    /**
     * Draw just after the side-panel anchor widget instead of above the whole widget tree.
     * Used by overlays that sit over the side panel (status bars) so tooltips still win.
     */
    drawAtAnchor?: boolean;
    /**
     * Makes it a RuneLite movable overlay: Alt-drag moves it, Alt + right-click resets it. The
     * name keys its saved position (RuneLite's overlay class name); position is its default
     * snap corner. It draws where `context.place` says.
     */
    movable?: { name: string; position: OverlayPosition };
}

export type CameraInputContext = {
    camera: Camera;
    input: InputManager;
    deltaTime: number;
};

/**
 * This frame's camera rotation from the player, in RS angle units (2048 per turn), before it
 * is applied: the arrow keys, and the middle-mouse drag and middle-held wheel. A plugin may
 * change it (RuneLite's camera speed and invert), or add to it with no input (a slide).
 */
export type CameraRotation = {
    camera: Camera;
    deltaTime: number;
    keyYaw: number;
    keyPitch: number;
    dragYaw: number;
    dragPitch: number;
};

export type GamepadContext = {
    gamepad: Gamepad;
    camera: Camera;
    input: InputManager;
    deltaTime: number;
};

export type CameraFollowContext = {
    camera: Camera;
    playerX: number;
    playerY?: number;
    playerZ: number;
    /** The player's plane, for the lookups below. */
    plane?: number;
    /** Ground height (tiles, y down) at a world position, when loaded. */
    groundHeightAt?(x: number, z: number): number | undefined;
    /** Collision flags at a world tile (0 where the renderer has none). */
    collisionFlagAt?(plane: number, tileX: number, tileY: number): number;
};

/** A health bar update from the server, for a player or an NPC (by server index). */
export type HealthBarEvent = {
    type: "npc" | "player";
    serverId: number;
    bar: { id: number; health: number; health2: number; removed?: boolean };
};

/**
 * A `runelite_callback` a clientscript ran (RuneLite's ScriptCallbackEvent). The event's
 * values are on the VM's stacks (see rs/cs2/sortCallbacks.ts for the sort callbacks).
 */
export type ScriptCallbackEvent = { eventName: string; vm: Cs2Vm };

/** A widget dragged onto another (RuneLite's WidgetDrag on release). */
export type WidgetDragEvent = { source: any; target: any };

export interface ClientPlugin {
    /** Extra player headicons; return stable, immutable sprites so textures can be reused. */
    getPlayerHeadIcons?(serverId: number): readonly IndexedSprite[] | undefined;
    transformSceneProgram?(source: ProgramSource): ProgramSource;
    sceneProgramsReady?(renderer: WebGLOsrsRenderer, programs: Program[]): void;
    beforeSceneRender?(renderer: WebGLOsrsRenderer, drawActors: () => void): void;
    /** Draws over the finished scene (depth test and blending still active). */
    afterSceneRender?(renderer: WebGLOsrsRenderer): void;
    configureSceneDrawCall?(renderer: WebGLOsrsRenderer, drawCall: DrawCall): void;
    disposeRenderer?(renderer: WebGLOsrsRenderer): void;
    /** WebGPU: extra scene pipelines, resources and passes (see render/webgpu/sceneExtension.ts). */
    createWebGPUSceneExtension?(context: WebGPUSceneExtensionContext): WebGPUSceneExtension | undefined;
    handleCameraKeys?(context: CameraInputContext): boolean;
    handleCameraMouse?(context: CameraInputContext): boolean;
    handleCameraScroll?(context: CameraInputContext): boolean;
    updateInteractionPointer?(camera: Camera): void;
    transformCameraRotation?(rotation: CameraRotation): void;
    handleCameraFollow?(context: CameraFollowContext): boolean;
    /** A connected standard-mapping controller, each frame; return true to take it over. */
    handleGamepad?(context: GamepadContext): boolean;
    /** A hitsplat arrived from the server (before it is drawn). */
    onHitsplat?(event: HitsplatEventPayload): void;
    /** A health bar update arrived from the server. */
    onHealthBar?(event: HealthBarEvent): void;
    /** A clientscript finished, nested calls included (RuneLite's ScriptPostFired). */
    onScriptFinished?(scriptId: number): void;
    /** A clientscript ran `runelite_callback`. */
    onScriptCallback?(event: ScriptCallbackEvent): void;
    /** A widget was dropped on another; return true to keep the drag from the server. */
    onWidgetDragComplete?(event: WidgetDragEvent): boolean;
    shouldKeepWorldMenuOpen?(): boolean;
    /** Supplies an alternate gameframe (e.g. the classic 317 frame). */
    gameFrame?: GameFrameProvider;
    widgetOverlay?: WidgetOverlay;
    /** Lays out movable overlays (the RuneLite OverlayRenderer). */
    placeOverlay?(
        overlay: WidgetOverlay,
        width: number,
        height: number,
        canvas: { w: number; h: number },
    ): OverlayPlacement | undefined;
    /** Handle a client-side `::command`; return true to consume it (no server round trip). */
    handleClientCommand?(command: string): boolean;
    /** Handle a widget action locally; return true to consume it before CS2 or network dispatch. */
    handleWidgetAction?(event: WidgetActionEvent): boolean;
    /** Reorders or extends a menu (top first); its first eligible entry is the left-click. */
    transformMenuEntries?(
        entries: SimpleMenuEntry[],
        context: MenuTransformContext,
    ): SimpleMenuEntry[];
    /** Graphics settings overriding the renderer's own (first answer wins). */
    gpuSettings?(): GpuSettings | undefined;
    /** Whether HD lighting is on, which widens draw distance and fog. */
    hdEnabled?(): boolean;
    /** How scenery animations are baked when a map square loads (first answer wins). */
    objectSettings?(): { smoothLocAnimations: boolean; smoothLocAnimationSteps: number };
    smoothsPlayer?(seqId: number): boolean;
    smoothsNpcs?(): boolean;
    smoothsNpc?(npcTypeId: number, seqId: number, action: boolean): boolean;
    smoothsGraphics?(): boolean;
    /** Scales the fixed gameframe to fill the window (first answer wins). */
    fixedStretch?(bufW: number, bufH: number, minScale: number): FixedStretch | null;
    /** Scales resizable mode's interface on top of interface scaling. */
    resizableScale?(uiScale: number, width: number, height: number): number;
    isStretchingResizable?(): boolean;
    /** The scene's render resolution as a fraction of the canvas; the lowest wins. */
    sceneResolutionScale?(): number;
    loginStretch?(): LoginStretch | null;
    /** Destination and true-tile highlights (first answer wins). */
    tileMarkersConfig?(): TileMarkersPluginConfig | undefined;
    /** Hover and interaction outlines on world objects (first answer wins). */
    interactHighlightConfig?(): InteractHighlightPluginConfig | undefined;
    /** Ground item labels around a tile (first answer wins). */
    groundItemOverlayEntries?(
        tileX: number,
        tileY: number,
        level: number,
        opts?: { radius?: number; maxEntries?: number },
    ): GroundItemOverlayEntry[] | undefined;
    groundItemMenuName?(stack: ClientGroundItemStack, name: string): string;
    groundItemMenuTarget?(stack: ClientGroundItemStack, target: string): string;
    deprioritizeGroundItem?(stack: ClientGroundItemStack): boolean;
    /** Text drawn with the local player's overhead chat. */
    appendLocalPlayerOverheads?(
        host: WebGLOsrsRendererHost,
        index: number | undefined,
        output: OverheadTextEntry[],
        maxEntries: number,
        playerDefaultHeightTiles: number | undefined,
    ): void;
    /** Mounted widgets are about to be laid out. */
    updateWidgetLayout?(): void;
    /** DOM drawn over the game canvas. */
    renderHud?(client: OsrsClient): ReactNode;
}

export class ClientPluginManager {
    private readonly plugins: ClientPlugin[] = [];
    // Per-frame and per-actor hooks walk only the plugins that implement them.
    private readonly implementers = new Map<keyof ClientPlugin, ClientPlugin[]>();

    add(plugin: ClientPlugin): void {
        this.plugins.push(plugin);
        this.implementers.clear();
    }

    private implementing(hook: keyof ClientPlugin): ClientPlugin[] {
        let plugins = this.implementers.get(hook);
        if (!plugins) this.implementers.set(hook, (plugins = this.plugins.filter((plugin) => plugin[hook] !== undefined)));
        return plugins;
    }

    playerHeadIcons(serverId: number): IndexedSprite[] {
        const icons: IndexedSprite[] = [];
        for (const plugin of this.plugins) {
            const sprites = plugin.getPlayerHeadIcons?.(serverId);
            if (sprites) icons.push(...sprites);
        }
        return icons;
    }

    transformSceneProgram(source: ProgramSource): ProgramSource {
        for (const plugin of this.plugins) source = plugin.transformSceneProgram?.(source) ?? source;
        return source;
    }

    transformMenuEntries(
        entries: SimpleMenuEntry[],
        context: MenuTransformContext,
    ): SimpleMenuEntry[] {
        for (const plugin of this.plugins) {
            entries = plugin.transformMenuEntries?.(entries, context) ?? entries;
        }
        return entries;
    }

    sceneProgramsReady(renderer: WebGLOsrsRenderer, programs: Program[]): void {
        for (const plugin of this.plugins) plugin.sceneProgramsReady?.(renderer, programs);
    }

    beforeSceneRender(renderer: WebGLOsrsRenderer, drawActors: () => void): void {
        for (const plugin of this.plugins) plugin.beforeSceneRender?.(renderer, drawActors);
    }

    afterSceneRender(renderer: WebGLOsrsRenderer): void {
        for (const plugin of this.plugins) plugin.afterSceneRender?.(renderer);
    }

    configureSceneDrawCall(renderer: WebGLOsrsRenderer, drawCall: DrawCall): void {
        for (const plugin of this.plugins) plugin.configureSceneDrawCall?.(renderer, drawCall);
    }

    disposeRenderer(renderer: WebGLOsrsRenderer): void {
        for (const plugin of this.plugins) plugin.disposeRenderer?.(renderer);
    }

    // ponytail: one WebGPU scene extension (the first offered); composing several needs
    // per-extension binding/location ranges and a pipeline set per active combination.
    createWebGPUSceneExtension(context: WebGPUSceneExtensionContext): WebGPUSceneExtension | undefined {
        for (const plugin of this.plugins) {
            const extension = plugin.createWebGPUSceneExtension?.(context);
            if (extension) return extension;
        }
        return undefined;
    }

    handleCameraKeys(context: CameraInputContext): boolean {
        return this.plugins.some((plugin) => plugin.handleCameraKeys?.(context) === true);
    }

    handleCameraMouse(context: CameraInputContext): boolean {
        return this.plugins.some((plugin) => plugin.handleCameraMouse?.(context) === true);
    }

    handleCameraScroll(context: CameraInputContext): boolean {
        return this.plugins.some((plugin) => plugin.handleCameraScroll?.(context) === true);
    }

    updateInteractionPointer(camera: Camera): void {
        for (const plugin of this.plugins) plugin.updateInteractionPointer?.(camera);
    }

    transformCameraRotation(rotation: CameraRotation): void {
        for (const plugin of this.plugins) plugin.transformCameraRotation?.(rotation);
    }

    handleCameraFollow(context: CameraFollowContext): boolean {
        return this.plugins.some((plugin) => plugin.handleCameraFollow?.(context) === true);
    }

    handleGamepad(context: GamepadContext): boolean {
        return this.plugins.some((plugin) => plugin.handleGamepad?.(context) === true);
    }

    onHitsplat(event: HitsplatEventPayload): void {
        for (const plugin of this.plugins) plugin.onHitsplat?.(event);
    }

    onHealthBar(event: HealthBarEvent): void {
        for (const plugin of this.plugins) plugin.onHealthBar?.(event);
    }

    onScriptFinished(scriptId: number): void {
        for (const plugin of this.plugins) plugin.onScriptFinished?.(scriptId);
    }

    onScriptCallback(event: ScriptCallbackEvent): void {
        for (const plugin of this.plugins) plugin.onScriptCallback?.(event);
    }

    onWidgetDragComplete(event: WidgetDragEvent): boolean {
        return this.plugins.some((plugin) => plugin.onWidgetDragComplete?.(event) === true);
    }

    shouldKeepWorldMenuOpen(): boolean {
        return this.plugins.some((plugin) => plugin.shouldKeepWorldMenuOpen?.() === true);
    }

    /** The active custom gameframe, if any plugin supplies one. */
    activeGameFrame(): GameFrameProvider | undefined {
        for (const plugin of this.plugins) {
            const frame = plugin.gameFrame;
            if (frame?.isGameFrameActive()) return frame;
        }
        return undefined;
    }

    widgetOverlays(): WidgetOverlay[] {
        const overlays: WidgetOverlay[] = [];
        for (const plugin of this.plugins) if (plugin.widgetOverlay) overlays.push(plugin.widgetOverlay);
        return overlays;
    }

    placeOverlay(
        overlay: WidgetOverlay,
        width: number,
        height: number,
        canvas: { w: number; h: number },
    ): OverlayPlacement | undefined {
        for (const plugin of this.plugins) {
            if (plugin.placeOverlay) return plugin.placeOverlay(overlay, width, height, canvas);
        }
        return undefined;
    }

    handleWidgetAction(event: WidgetActionEvent): boolean {
        return this.plugins.some(plugin => plugin.handleWidgetAction?.(event) === true);
    }

    handleClientCommand(command: string): boolean {
        return this.plugins.some((plugin) => plugin.handleClientCommand?.(command) === true);
    }

    gpuSettings(): GpuSettings | undefined {
        for (const plugin of this.implementing("gpuSettings")) {
            const settings = plugin.gpuSettings!();
            if (settings) return settings;
        }
        return undefined;
    }

    hdEnabled(): boolean {
        for (const plugin of this.implementing("hdEnabled")) if (plugin.hdEnabled!()) return true;
        return false;
    }

    objectSettings(): { smoothLocAnimations: boolean; smoothLocAnimationSteps: number } | undefined {
        for (const plugin of this.implementing("objectSettings")) {
            const settings = plugin.objectSettings!();
            if (settings) return settings;
        }
        return undefined;
    }

    smoothsPlayer(seqId: number): boolean {
        for (const plugin of this.implementing("smoothsPlayer")) if (plugin.smoothsPlayer!(seqId)) return true;
        return false;
    }

    smoothsNpcs(): boolean {
        for (const plugin of this.implementing("smoothsNpcs")) if (plugin.smoothsNpcs!()) return true;
        return false;
    }

    smoothsNpc(npcTypeId: number, seqId: number, action: boolean): boolean {
        for (const plugin of this.implementing("smoothsNpc")) if (plugin.smoothsNpc!(npcTypeId, seqId, action)) return true;
        return false;
    }

    smoothsGraphics(): boolean {
        for (const plugin of this.implementing("smoothsGraphics")) if (plugin.smoothsGraphics!()) return true;
        return false;
    }

    fixedStretch(bufW: number, bufH: number, minScale: number): FixedStretch | null {
        for (const plugin of this.plugins) {
            const stretch = plugin.fixedStretch?.(bufW, bufH, minScale);
            if (stretch) return stretch;
        }
        return null;
    }

    resizableScale(uiScale: number, width: number, height: number): number {
        for (const plugin of this.plugins) uiScale = plugin.resizableScale?.(uiScale, width, height) ?? uiScale;
        return uiScale;
    }

    isStretchingResizable(): boolean {
        return this.plugins.some((plugin) => plugin.isStretchingResizable?.() === true);
    }

    sceneResolutionScale(): number {
        let scale = 1;
        for (const plugin of this.implementing("sceneResolutionScale")) scale = Math.min(scale, plugin.sceneResolutionScale!());
        return scale;
    }

    loginStretch(): LoginStretch | null {
        for (const plugin of this.plugins) {
            const stretch = plugin.loginStretch?.();
            if (stretch) return stretch;
        }
        return null;
    }

    tileMarkersConfig(): TileMarkersPluginConfig {
        for (const plugin of this.plugins) {
            const config = plugin.tileMarkersConfig?.();
            if (config) return config;
        }
        return DISABLED_TILE_MARKERS_CONFIG;
    }

    interactHighlightConfig(): InteractHighlightPluginConfig | undefined {
        for (const plugin of this.plugins) {
            const config = plugin.interactHighlightConfig?.();
            if (config) return config;
        }
        return undefined;
    }

    groundItemOverlayEntries(
        tileX: number,
        tileY: number,
        level: number,
        opts?: { radius?: number; maxEntries?: number },
    ): GroundItemOverlayEntry[] {
        for (const plugin of this.plugins) {
            const entries = plugin.groundItemOverlayEntries?.(tileX, tileY, level, opts);
            if (entries) return entries;
        }
        return [];
    }

    groundItemMenuName(stack: ClientGroundItemStack, name: string): string {
        for (const plugin of this.plugins) name = plugin.groundItemMenuName?.(stack, name) ?? name;
        return name;
    }

    groundItemMenuTarget(stack: ClientGroundItemStack, target: string): string {
        for (const plugin of this.plugins) target = plugin.groundItemMenuTarget?.(stack, target) ?? target;
        return target;
    }

    deprioritizeGroundItem(stack: ClientGroundItemStack): boolean {
        return this.plugins.some((plugin) => plugin.deprioritizeGroundItem?.(stack) === true);
    }

    appendLocalPlayerOverheads(
        host: WebGLOsrsRendererHost,
        index: number | undefined,
        output: OverheadTextEntry[],
        maxEntries: number,
        playerDefaultHeightTiles: number | undefined,
    ): void {
        for (const plugin of this.plugins) {
            plugin.appendLocalPlayerOverheads?.(host, index, output, maxEntries, playerDefaultHeightTiles);
        }
    }

    updateWidgetLayout(): void {
        for (const plugin of this.plugins) plugin.updateWidgetLayout?.();
    }

    renderHud(client: OsrsClient): ReactNode[] {
        const huds: ReactNode[] = [];
        this.plugins.forEach((plugin, i) => {
            const hud = plugin.renderHud?.(client);
            // The plugin list only grows, so its index is a stable key.
            if (hud) huds.push(createElement(Fragment, { key: i }, hud));
        });
        return huds;
    }

}
