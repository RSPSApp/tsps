import { isMobileMode, isTouchDevice } from "../../common/utils/DeviceUtil";
import { CacheSystem } from "../../rs/cache/CacheSystem";
import { GameState } from "./GameState";
import { LoginAction } from "./LoginAction";
import type { LoginState } from "./LoginState";
import { LOGIN_LAYOUT } from "./renderer/constants";
import { FALLBACK_SERVERS } from "./renderer/constants";
import type { LoginRendererHost } from "./renderer/host";
import type { LoginLayoutConfig, LoginStretch, ServerListEntry, World } from "./renderer/types";
import * as assets from "./renderer/assets";
import * as canvas from "./renderer/canvas";
import * as controls from "./renderer/controls";
import * as hover from "./renderer/hover";
import * as lifecycle from "./renderer/lifecycle";
import * as serverList from "./renderer/serverList";
import * as layoutConfig from "./renderer/layout/config";
import * as layoutGeometry from "./renderer/layout/geometry";
import { updateLayout } from "./renderer/layout/updateLayout";
import * as inputKeyboard from "./renderer/input/keyboard";
import * as inputMouse from "./renderer/input/mouseClick";
import * as sceneEntry from "./renderer/render/sceneEntry";
import * as titleScene from "./renderer/render/titleScene";
import { getMobileWorldIndexAtPosition } from "./renderer/world/worldSelectMobile";

export type { LoginLayoutConfig, LoginStretch, ServerListEntry, World } from "./renderer/types";
export { WorldFlags } from "./renderer/types";

/**
 * Login screen renderer facade.
 * Delegates to modules under ./renderer/ while preserving the public API.
 */
export class LoginRenderer implements LoginRendererHost {
    readonly LOGIN_BOX_X = LOGIN_LAYOUT.LOGIN_BOX_X;
    readonly LOGIN_BOX_CENTER = LOGIN_LAYOUT.LOGIN_BOX_CENTER;
    readonly TITLEBOX_Y = LOGIN_LAYOUT.TITLEBOX_Y;
    readonly TITLEBOX_FALLBACK_WIDTH = LOGIN_LAYOUT.TITLEBOX_FALLBACK_WIDTH;
    readonly TITLEBOX_FALLBACK_HEIGHT = LOGIN_LAYOUT.TITLEBOX_FALLBACK_HEIGHT;
    readonly BOTTOM_CONTROLS_RESERVE = LOGIN_LAYOUT.BOTTOM_CONTROLS_RESERVE;
    readonly CONTENT_WIDTH = LOGIN_LAYOUT.CONTENT_WIDTH;
    readonly SCENE_WIDTH = LOGIN_LAYOUT.SCENE_WIDTH;
    readonly SCENE_HEIGHT = LOGIN_LAYOUT.SCENE_HEIGHT;

    titleboxY: number = this.TITLEBOX_Y;
    contentOriginY = 0;
    contentOriginX = 0;
    contentScale = 1;
    contentSmoothing = false;
    loginStretch: () => LoginStretch | null = () => null;
    containerX = 0;
    containerWidth = LOGIN_LAYOUT.MAX_BG_WIDTH;
    containerHeight = LOGIN_LAYOUT.MAX_BG_HEIGHT;
    xPadding = 0;
    canvasWidth = this.SCENE_WIDTH;
    canvasHeight = this.SCENE_HEIGHT;
    renderScale = 1;
    renderOffsetX = 0;
    renderOffsetY = 0;
    renderSurfaceWidth = this.SCENE_WIDTH;
    mobileKeyboardFocusActive = false;
    mobileKeyboardFocusField = 0;
    loginBoxX = 202;
    loginBoxCenter = 382;

    titleBackgroundImage: ImageBitmap | undefined;
    titleBackgroundFromCache = false;
    logoSprite: import("../../rs/sprite/IndexedSprite").IndexedSprite | undefined;
    logoImage: HTMLImageElement | undefined;
    logoImageLoaded = false;
    titleboxSprite: import("../../rs/sprite/IndexedSprite").IndexedSprite | undefined;
    titlebuttonSprite: import("../../rs/sprite/IndexedSprite").IndexedSprite | undefined;
    titlebuttonLargeSprite: import("../../rs/sprite/IndexedSprite").IndexedSprite | undefined;
    playNowTextSprite: import("../../rs/sprite/IndexedSprite").IndexedSprite | undefined;
    runesSprites: import("../../rs/sprite/IndexedSprite").IndexedSprite[] | undefined;
    titleMuteSprites: import("../../rs/sprite/IndexedSprite").IndexedSprite[] | undefined;
    optionsRadioSprite0: import("../../rs/sprite/IndexedSprite").IndexedSprite | undefined;
    optionsRadioSprite2: import("../../rs/sprite/IndexedSprite").IndexedSprite | undefined;
    optionsRadioSprite4: import("../../rs/sprite/IndexedSprite").IndexedSprite | undefined;
    optionsRadioSprite6: import("../../rs/sprite/IndexedSprite").IndexedSprite | undefined;
    worldSelectLeftSprite: import("../../rs/sprite/IndexedSprite").IndexedSprite | undefined;
    worldSelectRightSprite: import("../../rs/sprite/IndexedSprite").IndexedSprite | undefined;
    worldSelectButtonSprite: import("../../rs/sprite/IndexedSprite").IndexedSprite | undefined;
    worldSelectBackSprites: import("../../rs/sprite/IndexedSprite").IndexedSprite[] | undefined;
    worldSelectFlagSprites: import("../../rs/sprite/IndexedSprite").IndexedSprite[] | undefined;
    worldSelectStarSprites: import("../../rs/sprite/IndexedSprite").IndexedSprite[] | undefined;
    worldSelectArrowSprites: import("../../rs/sprite/IndexedSprite").IndexedSprite[] | undefined;

    fontBold12: import("../../rs/font/BitmapFont").BitmapFont | undefined;
    fontPlain11: import("../../rs/font/BitmapFont").BitmapFont | undefined;
    fontPlain12: import("../../rs/font/BitmapFont").BitmapFont | undefined;

    cycle = 0;
    lastTickTime = 0;
    caretBlinkMs = 0;
    mouseX = 0;
    mouseY = 0;
    serverList: ServerListEntry[] = [...FALLBACK_SERVERS];
    serverListFetched = false;
    probing = false;
    probed = false;
    worldSortOption = 0;
    worldSortDirection = 0;
    currentSortedWorlds: World[] = [];
    cachedSortedWorlds: World[] | null = null;
    cachedSortOption = -1;
    cachedSortDirection = -1;
    loginScreenRunesAnimation: import("./LoginScreenAnimation").LoginScreenAnimation | undefined;

    canvas: HTMLCanvasElement | undefined;
    ctx: CanvasRenderingContext2D | undefined;
    spriteCache = new WeakMap<import("../../rs/sprite/IndexedSprite").IndexedSprite, OffscreenCanvas>();
    textMeasureCache = new WeakMap<import("../../rs/font/BitmapFont").BitmapFont, Map<string, number>>();

    worldSelectCache: OffscreenCanvas | null = null;
    worldSelectCacheCtx: OffscreenCanvasRenderingContext2D | null = null;
    worldSelectCachePage = -1;
    worldSelectCacheSortOption = -1;
    worldSelectCacheSortDirection = -1;
    worldSelectCacheWidth = 0;
    worldSelectCacheHeight = 0;

    titleCache: OffscreenCanvas | null = null;
    titleCacheCtx: OffscreenCanvasRenderingContext2D | null = null;
    titleCacheStateHash = "";
    titleCacheWidth = 0;
    titleCacheHeight = 0;

    layoutConfig: LoginLayoutConfig = {
        scale: 1,
        isMobile: isMobileMode,
        isTouch: isTouchDevice,
        minTouchTarget: 44,
        worldSelectListMode: false,
        orientation: "landscape",
        viewportWidth: 765,
        viewportHeight: 503,
    };
    scaledLoginBoxX = 202;
    scaledLoginBoxCenter = 382;
    cachedGridLayout = null;
    cachedGridWorldCount = -1;

    constructor() {
        canvas.initCanvas(this);
    }

    async fetchServerList(): Promise<void> {
        return serverList.fetchServerList(this);
    }
    refreshServerList(): void {
        serverList.refreshServerList(this);
    }
    computeLayoutConfig(w: number, h: number): LoginLayoutConfig {
        return layoutConfig.computeLayoutConfig(this, w, h);
    }
    getLayoutConfig(): LoginLayoutConfig {
        return layoutConfig.getLayoutConfig(this);
    }
    getRenderScale(): number {
        return layoutConfig.getRenderScale(this);
    }
    getTitleAssetStateHash(): string {
        return layoutConfig.getTitleAssetStateHash(this);
    }
    syncMobileViewportState(state: LoginState, keyboardFocused = false): void {
        layoutConfig.syncMobileViewportState(this, state, keyboardFocused);
    }
    getViewportTransformStateHash(): string {
        return layoutConfig.getViewportTransformStateHash(this);
    }
    getCanvas(width: number, height: number): HTMLCanvasElement {
        return canvas.getCanvas(this, width, height);
    }
    getContext(): CanvasRenderingContext2D | undefined {
        return canvas.getContext(this);
    }
    tick(): void {
        canvas.tick(this);
    }
    getFireAnimation() {
        return canvas.getFireAnimation(this);
    }
    getFirePositions() {
        return canvas.getFirePositions(this);
    }
    computeHoveredWorldIndex(state: LoginState, w: number, h: number): number {
        return hover.computeHoveredWorldIndex(this, state, w, h);
    }
    computeHoveredServerIndex(state: LoginState): number {
        return hover.computeHoveredServerIndex(this, state);
    }
    setMousePosition(x: number, y: number): void {
        hover.setMousePosition(this, x, y);
    }
    updateLayout(
        canvasWidth: number,
        canvasHeight: number,
        surfaceWidth?: number,
        surfaceHeight?: number,
    ): void {
        updateLayout(this, canvasWidth, canvasHeight, surfaceWidth, surfaceHeight);
    }
    mapPointerToContent(layoutX: number, layoutY: number) {
        return layoutGeometry.mapPointerToContent(this, layoutX, layoutY);
    }
    loadLogoImage(): Promise<boolean> {
        return assets.loadLogoImage(this);
    }
    loadTitleBackground(cache?: CacheSystem): Promise<boolean> {
        return assets.loadTitleBackground(this, cache);
    }
    loadTitleSprites(cache: CacheSystem, flamePalettes?: number[][]): boolean {
        return assets.loadTitleSprites(this, cache, flamePalettes);
    }
    loadFonts(cache: CacheSystem): boolean {
        return assets.loadFonts(this, cache);
    }
    handleKeyInput(state: LoginState, key: string, char: string): boolean {
        return inputKeyboard.handleKeyInput(this, state, key, char);
    }
    handleMouseClick(
        state: LoginState,
        x: number,
        y: number,
        button: number,
        gameState: GameState = GameState.LOGIN_SCREEN,
    ): LoginAction | undefined {
        return inputMouse.handleMouseClick(this, state, x, y, button, gameState);
    }
    drawDownload(
        state: LoginState,
        width: number,
        height: number,
        layoutWidth?: number,
        layoutHeight?: number,
    ): void {
        sceneEntry.drawDownload(this, state, width, height, layoutWidth, layoutHeight);
    }
    drawInitial(
        state: LoginState,
        width: number,
        height: number,
        layoutWidth?: number,
        layoutHeight?: number,
    ): void {
        sceneEntry.drawInitial(this, state, width, height, layoutWidth, layoutHeight);
    }
    drawTitle(
        state: LoginState,
        gameState: GameState,
        width: number,
        height: number,
        skipFire?: boolean,
        hoverOnly?: boolean,
        layoutWidth?: number,
        layoutHeight?: number,
    ): void {
        titleScene.drawTitle(
            this,
            state,
            gameState,
            width,
            height,
            skipFire,
            hoverOnly,
            layoutWidth,
            layoutHeight,
        );
    }
    getMobileWorldIndexAtPosition(
        state: LoginState,
        x: number,
        y: number,
        width: number,
        height: number,
    ): number {
        return getMobileWorldIndexAtPosition(this, state, x, y, width, height);
    }
    dispose(): void {
        lifecycle.dispose(this);
    }
    resetAnimationState(): void {
        lifecycle.resetAnimationState(this);
    }
}
