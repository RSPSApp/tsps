import type { Camera } from "../Camera";
import type { InputManager } from "../InputManager";
import type { DrawCall, Program } from "picogl";
import type { ProgramSource } from "../../render/shaders/ShaderUtil";
import type { WebGLOsrsRenderer } from "../../render/WebGLOsrsRenderer";
import type { GLRenderer } from "../../widgets/gl/renderer";
import type { ClickRegistry } from "../../widgets/gl/click-registry";
import type { SimpleMenuEntry } from "../../ui/menu/MenuEngine";
import type { MenuTransformContext } from "../../ui/menu/menuTransforms";
import type { FontLoader } from "../../widgets/components/TextRenderer";

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
};

/** UI drawn above the widgets and under the right-click menu (RuneLite's ABOVE_WIDGETS). */
export interface WidgetOverlay {
    /** Changes whenever the drawing would; a change redraws the UI. */
    signature(): string;
    /** Draws the overlay and returns the device rects it covered. */
    draw(context: WidgetOverlayDrawContext): { x: number; y: number; w: number; h: number }[];
}

export type CameraInputContext = {
    camera: Camera;
    input: InputManager;
    deltaTime: number;
};

export type CameraFollowContext = {
    camera: Camera;
    playerX: number;
    playerY?: number;
    playerZ: number;
};

export interface ClientPlugin {
    transformSceneProgram?(source: ProgramSource): ProgramSource;
    sceneProgramsReady?(renderer: WebGLOsrsRenderer, programs: Program[]): void;
    beforeSceneRender?(renderer: WebGLOsrsRenderer, drawActors: () => void): void;
    /** Draws over the finished scene (depth test and blending still active). */
    afterSceneRender?(renderer: WebGLOsrsRenderer): void;
    configureSceneDrawCall?(renderer: WebGLOsrsRenderer, drawCall: DrawCall): void;
    disposeRenderer?(renderer: WebGLOsrsRenderer): void;
    handleCameraKeys?(context: CameraInputContext): boolean;
    handleCameraMouse?(context: CameraInputContext): boolean;
    handleCameraScroll?(context: CameraInputContext): boolean;
    updateInteractionPointer?(camera: Camera): void;
    handleCameraFollow?(context: CameraFollowContext): boolean;
    shouldKeepWorldMenuOpen?(): boolean;
    /** Supplies an alternate gameframe (e.g. the classic 317 frame). */
    gameFrame?: GameFrameProvider;
    widgetOverlay?: WidgetOverlay;
    /** Handle a client-side `::command`; return true to consume it (no server round trip). */
    handleClientCommand?(command: string): boolean;
    /** Reorders or extends a menu (top first); its first eligible entry is the left-click. */
    transformMenuEntries?(
        entries: SimpleMenuEntry[],
        context: MenuTransformContext,
    ): SimpleMenuEntry[];
}

export class ClientPluginManager {
    private readonly plugins: ClientPlugin[] = [];

    add(plugin: ClientPlugin): void {
        this.plugins.push(plugin);
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

    handleCameraFollow(context: CameraFollowContext): boolean {
        return this.plugins.some((plugin) => plugin.handleCameraFollow?.(context) === true);
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

    handleClientCommand(command: string): boolean {
        return this.plugins.some((plugin) => plugin.handleClientCommand?.(command) === true);
    }

}
