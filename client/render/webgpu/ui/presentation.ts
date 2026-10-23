import { drawEditModeLoadingScreen, getEditModeSceneLoadingStatus } from "../../../game/plugins/editmode/editModeLoadingScreen";
import { isMobileMode } from "../../../common/utils/DeviceUtil";
import { GameState, LoginIndex } from "../../../game/login";
import type { LoginRenderer } from "../../../game/login/LoginRenderer";
import type { LoginState } from "../../../game/login/LoginState";
import { withRenderTransform } from "../../../game/login/renderer/layout/config";
import { getLogicalFirePositions } from "../../../game/login/renderer/layout/geometry";
import { drawServerListOverlay } from "../../../game/login/renderer/render/serverListOverlay";
import { LoadingMessageOverlay } from "../../../ui/devoverlay/LoadingMessageOverlay";
import type { OverlayUpdateArgs } from "../../../ui/devoverlay/Overlay";
import { SystemUpdateOverlay } from "../../../ui/devoverlay/SystemUpdateOverlay";
import { getChatboxScreenRect } from "../../../widgets/gl/widgetsOverlayFactory";
import type { WebGPURenderer } from "../WebGPURenderer";
import { createMobileLoginInput, type MobileLoginInput } from "./mobileLoginInput";
import type { UiRenderMetrics } from "./WebGPUUi";

/** Widget root the server opens while the post-login welcome screen is up. */
const WELCOME_SCREEN_GROUP_ID = 378;

/**
 * DOM presentation for the WebGPU backend: the title/login surface, the loading message, the
 * system-update countdown and the welcome blackout live on DOM canvases stacked over the main
 * canvas (same pattern WidgetsOverlay uses for the HUD). No main-context GL is involved.
 *
 * The login surface is drawn by the Canvas2D LoginRenderer (fire included via skipFire=false)
 * and blitted 1:1 to device pixels, with the WebGL frame loop's login input routing replicated
 * so typing, clicking and Enter all connect.
 */
export class WebgpuUiPresentation {
    private loginCanvas: HTMLCanvasElement;
    private loginCtx: CanvasRenderingContext2D | null = null;
    private hudFxCanvas: HTMLCanvasElement;
    private hudFxCtx: CanvasRenderingContext2D | null = null;
    private readonly loadingMessageOverlay: LoadingMessageOverlay;
    private readonly systemUpdateOverlay: SystemUpdateOverlay;
    private readonly mobileLoginInput: MobileLoginInput;

    constructor(
        private readonly renderer: WebGPURenderer,
        private readonly computeMetrics: (bufW: number, bufH: number) => UiRenderMetrics,
    ) {
        this.hudFxCanvas = this.createLayer();
        this.loginCanvas = this.createLayer();
        // The login surface covers everything; keep it above the widget overlay regardless of
        // append order. hudFx stays in the default positioned bucket, appended before the
        // widget canvas so the HUD draws over it.
        this.loginCanvas.style.zIndex = "2";
        this.attach(this.hudFxCanvas);
        const osrsClient = renderer.osrsClient;
        this.loadingMessageOverlay = new LoadingMessageOverlay(osrsClient.stateMachine);
        this.systemUpdateOverlay = new SystemUpdateOverlay({
            getChatboxRect: () => getChatboxScreenRect({ osrsClient }),
        });
        this.mobileLoginInput = createMobileLoginInput(renderer, computeMetrics);
    }

    /** Appended after the widget overlay exists, so the title always composites on top. */
    attachLoginLayer(): void {
        this.attach(this.loginCanvas);
    }

    update(timeMs: number, deltaMs: number): void {
        const renderer = this.renderer;
        const osrsClient = renderer.osrsClient;
        const bufW = Math.max(1, renderer.canvas.width | 0);
        const bufH = Math.max(1, renderer.canvas.height | 0);
        const metrics = this.computeMetrics(bufW, bufH);
        this.mobileLoginInput.sync(false);

        if (renderer.uiHidden) {
            this.hide(this.loginCanvas);
            if (osrsClient.isLoggedIn()) this.updateHudFx(timeMs, deltaMs, bufW, bufH);
            else this.hide(this.hudFxCanvas);
            return;
        }

        if (osrsClient.isLoggedIn()) {
            // The logout tab's World Switcher opens the server list over the game.
            if (osrsClient.loginState.serverListOpen) this.drawInGameServerList(metrics, bufW, bufH);
            else this.hide(this.loginCanvas);
            this.updateHudFx(timeMs, deltaMs, bufW, bufH);
        } else {
            // Login-like states own the frame: route input, draw the title, black the world out.
            osrsClient.loginRenderer.syncMobileViewportState(osrsClient.loginState, this.mobileLoginInput.isKeyboardOpen());
            osrsClient.loginRenderer.updateLayout(metrics.layoutW, metrics.layoutH, metrics.layoutW, metrics.layoutH);
            if (!osrsClient.scenePreviewEnabled && !osrsClient.editorLaunching) this.handleLoginInput(metrics);
            this.drawLoginSurface(metrics, bufW, bufH);
            this.drawLoadingMessage(timeMs, deltaMs, this.loginCtx);
        }
    }

    dispose(): void {
        this.loadingMessageOverlay.dispose();
        this.systemUpdateOverlay.dispose();
        this.mobileLoginInput.dispose();
        this.loginCanvas.remove();
        this.hudFxCanvas.remove();
    }

    // ------------------------------------------------------------------ login

    /** Mirrors the WebGL frame loop's login early-out (client/render/render/frame/render.ts). */
    private handleLoginInput(metrics: UiRenderMetrics): void {
        const osrsClient = this.renderer.osrsClient;
        const inputManager = osrsClient.inputManager;
        const onLoginScreen = osrsClient.isOnLoginScreen();

        inputManager.onFrameStart();

        if (onLoginScreen) {
            let char = inputManager.readChar();
            while (char !== -1) {
                osrsClient.handleLoginKeyInput("", String.fromCharCode(char));
                char = inputManager.readChar();
            }
            for (const keyEvent of inputManager.keyEvents) {
                if (keyEvent.code === "Tab") {
                    osrsClient.handleLoginKeyInput("Tab", "");
                } else if (keyEvent.code === "Enter" || keyEvent.code === "NumpadEnter") {
                    osrsClient.submitLoginFromKeyboard();
                } else if (keyEvent.code === "Backspace") {
                    osrsClient.handleLoginKeyInput("Backspace", "");
                }
            }
            inputManager.keyEvents.length = 0;

            if (
                inputManager.clickMode3 !== 0 &&
                inputManager.saveClickX !== -1 &&
                inputManager.saveClickY !== -1
            ) {
                const action = osrsClient.handleLoginMouseClick(
                    (inputManager.saveClickX - metrics.renderOffsetX) / metrics.renderScaleX,
                    (inputManager.saveClickY - metrics.renderOffsetY) / metrics.renderScaleY,
                    inputManager.clickMode3,
                );
                const { loginState } = osrsClient;
                this.mobileLoginInput.sync(
                    isMobileMode &&
                        loginState.loginIndex === LoginIndex.LOGIN_FORM &&
                        loginState.virtualKeyboardVisible &&
                        inputManager.isTouch,
                );
                if (action === "connect") {
                    osrsClient.sendLoginRequest();
                }
                inputManager.clickMode3 = 0;
                inputManager.saveClickX = -1;
                inputManager.saveClickY = -1;
            }

            osrsClient.tickLogin();
        } else {
            inputManager.keyEvents.length = 0;
        }
    }

    private drawLoginSurface(metrics: UiRenderMetrics, bufW: number, bufH: number): void {
        const osrsClient = this.renderer.osrsClient;
        const loginRenderer = osrsClient.loginRenderer;
        const loginState = osrsClient.loginState;
        const inputManager = osrsClient.inputManager;

        const editorLoading = getEditModeSceneLoadingStatus(osrsClient) ??
            (osrsClient.editorLaunching && osrsClient.gameState === GameState.LOGIN_SCREEN
                ? "Loading world settings"
                : undefined);
        if (osrsClient.scenePreviewEnabled && !editorLoading) {
            // Dev preview replaces the title with the world; nothing to cover it with.
            this.hide(this.loginCanvas);
            return;
        }

        const layoutW = metrics.layoutW;
        const layoutH = metrics.layoutH;

        loginRenderer.setMousePosition(
            (inputManager.mouseX - metrics.renderOffsetX) / metrics.renderScaleX,
            (inputManager.mouseY - metrics.renderOffsetY) / metrics.renderScaleY,
        );
        loginState.hoveredServerIndex = loginRenderer.computeHoveredServerIndex(loginState);

        if (editorLoading) {
            loginRenderer.drawInitial(loginState, layoutW, layoutH, layoutW, layoutH);
            const ctx = loginRenderer.getCanvas(layoutW, layoutH).getContext("2d");
            if (ctx) drawEditModeLoadingScreen(loginRenderer, ctx, editorLoading);
        } else if (osrsClient.gameState === GameState.DOWNLOADING) {
            loginRenderer.drawDownload(loginState, layoutW, layoutH, layoutW, layoutH);
        } else if (osrsClient.gameState === GameState.LOADING) {
            loginRenderer.drawInitial(loginState, layoutW, layoutH, layoutW, layoutH);
        } else {
            // skipFire=true: the title cache holds the static surface; the fire is stamped on
            // the braziers every frame below (the cached redraw only runs on caret/state
            // changes, so drawing it inside the cache would animate at ~2fps).
            loginRenderer.drawTitle(
                loginState,
                osrsClient.gameState,
                layoutW,
                layoutH,
                true,
                false,
                layoutW,
                layoutH,
            );
            this.drawFire(loginRenderer, layoutW, layoutH, loginState);
        }

        const canvas = this.loginCanvas;
        this.resize(canvas, bufW, bufH);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        this.loginCtx = ctx;
        const src = loginRenderer.getCanvas(layoutW, layoutH);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.imageSmoothingEnabled = false;
        // Opaque black under the surface hides the (skipped) world behind it.
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, bufW, bufH);
        // Clamp the source like the WebGL login quad's UV clamp so each layout pixel maps to
        // exactly `renderScale` device pixels instead of resampling the overshoot.
        const srcW = Math.min(layoutW, bufW / Math.max(1e-6, metrics.renderScaleX));
        const srcH = Math.min(layoutH, bufH / Math.max(1e-6, metrics.renderScaleY));
        ctx.drawImage(
            src,
            0,
            0,
            srcW,
            srcH,
            metrics.renderOffsetX,
            metrics.renderOffsetY,
            bufW - metrics.renderOffsetX,
            bufH - metrics.renderOffsetY,
        );
        this.show(canvas);
    }

    /** Mirrors LoginOverlay.drawInGameServerList: the list over the world, in buffer pixels. */
    private drawInGameServerList(metrics: UiRenderMetrics, bufW: number, bufH: number): void {
        const { loginRenderer, loginState, inputManager } = this.renderer.osrsClient;
        // Surface = buffer, as on WebGL, so handleInGameServerListInput's raw clicks line up.
        loginRenderer.updateLayout(metrics.layoutW, metrics.layoutH, bufW, bufH);
        loginRenderer.setMousePosition(inputManager.mouseX, inputManager.mouseY);
        loginState.hoveredServerIndex = loginRenderer.computeHoveredServerIndex(loginState);
        const canvas = this.loginCanvas;
        this.resize(canvas, bufW, bufH);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, bufW, bufH);
        withRenderTransform(loginRenderer, ctx, () => drawServerListOverlay(loginRenderer, ctx, loginState));
        this.show(canvas);
    }

    /**
     * Stamps the current fire frame on both braziers. Mirrors LoginOverlay's per-frame fire
     * texture (and titleScene's cached draw placement); the title itself is cached with
     * skipFire=true.
     */
    private drawFire(
        loginRenderer: LoginRenderer,
        layoutW: number,
        layoutH: number,
        loginState: LoginState,
    ): void {
        if (
            this.renderer.osrsClient.gameState < GameState.LOGIN_SCREEN ||
            loginState.serverListOpen ||
            loginState.worldSelectOpen
        ) {
            return;
        }
        const fireCanvas = loginRenderer.getFireAnimation()?.updateAndGetCanvas(loginRenderer.cycle);
        if (!fireCanvas) return;
        const ctx = loginRenderer.getCanvas(layoutW, layoutH).getContext("2d");
        if (!ctx) return;
        withRenderTransform(loginRenderer, ctx, () => {
            ctx.save();
            ctx.beginPath();
            ctx.rect(
                loginRenderer.containerX,
                0,
                loginRenderer.containerWidth,
                loginRenderer.containerHeight,
            );
            ctx.clip();
            const firePos = getLogicalFirePositions(loginRenderer);
            for (const x of [firePos.leftX, firePos.rightX]) {
                ctx.save();
                ctx.translate(x, firePos.y);
                ctx.scale(firePos.scale, firePos.scale);
                ctx.drawImage(fireCanvas, 0, 0);
                ctx.restore();
            }
            ctx.restore();
        });
    }

    private drawLoadingMessage(
        timeMs: number,
        deltaMs: number,
        ctx: CanvasRenderingContext2D | null,
    ): void {
        const renderer = this.renderer;
        this.loadingMessageOverlay.update(
            makeOverlayArgs(timeMs, deltaMs, renderer.canvas.width, renderer.canvas.height),
        );
        if (ctx && this.loadingMessageOverlay.isVisible()) {
            this.loadingMessageOverlay.drawTo2D(ctx);
        }
    }

    // -------------------------------------------------------------- gameplay

    private updateHudFx(timeMs: number, deltaMs: number, bufW: number, bufH: number): void {
        const osrsClient = this.renderer.osrsClient;
        const canvas = this.hudFxCanvas;
        this.resize(canvas, bufW, bufH);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        this.hudFxCtx = ctx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, bufW, bufH);
        // Sky clears and HD/FXAA cover the full target; mask them without clipping canvas input.
        const viewport = this.renderer.getSceneViewportWidgetRect();
        const hasGutters =
            viewport.x > 0 || viewport.y > 0 ||
            viewport.x + viewport.width < bufW || viewport.y + viewport.height < bufH;
        if (hasGutters) {
            ctx.fillStyle = "#000000";
            ctx.fillRect(0, 0, bufW, bufH);
            ctx.clearRect(viewport.x, viewport.y, viewport.width, viewport.height);
        }
        if (this.renderer.uiHidden) {
            if (hasGutters) this.show(canvas);
            else this.hide(canvas);
            return;
        }

        const rootInterface = osrsClient.widgetManager?.rootInterface ?? -1;
        if (rootInterface === WELCOME_SCREEN_GROUP_ID) {
            // The loaded scene stays hot but must not show behind the Welcome Screen; the widget
            // DOM canvas (transparent around its widgets) composites on top of this black layer.
            ctx.fillStyle = "#000000";
            ctx.fillRect(0, 0, bufW, bufH);
            this.show(canvas);
            return;
        }

        const args = makeOverlayArgs(timeMs, deltaMs, bufW, bufH);
        this.loadingMessageOverlay.update(args);
        this.systemUpdateOverlay.update(args);
        let hasContent = hasGutters;
        if (this.loadingMessageOverlay.isVisible()) {
            this.loadingMessageOverlay.drawTo2D(ctx);
            hasContent = true;
        }
        if (this.systemUpdateOverlay.isVisible()) {
            this.systemUpdateOverlay.drawTo2D(ctx);
            hasContent = true;
        }
        if (hasContent) this.show(canvas);
        else this.hide(canvas);
    }

    // -------------------------------------------------------------- canvases

    private createLayer(): HTMLCanvasElement {
        const canvas = document.createElement("canvas");
        canvas.style.position = "absolute";
        canvas.style.inset = "0";
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.pointerEvents = "none";
        canvas.style.background = "transparent";
        canvas.style.display = "none";
        return canvas;
    }

    private attach(canvas: HTMLCanvasElement): void {
        const parent = this.renderer.canvas.parentElement;
        if (!parent || canvas.parentElement === parent) return;
        parent.appendChild(canvas);
    }

    private resize(canvas: HTMLCanvasElement, width: number, height: number): void {
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
    }

    private show(canvas: HTMLCanvasElement): void {
        if (canvas.style.display !== "") canvas.style.display = "";
    }

    private hide(canvas: HTMLCanvasElement): void {
        if (canvas.style.display !== "none") canvas.style.display = "none";
    }
}

function makeOverlayArgs(
    timeMs: number,
    deltaMs: number,
    width: number,
    height: number,
): OverlayUpdateArgs {
    return {
        time: timeMs,
        delta: deltaMs,
        resolution: { width, height },
        state: {
            hoverEnabled: false,
            playerLevel: 0,
            clientTickPhase: 0,
        },
        helpers: undefined as unknown as OverlayUpdateArgs["helpers"],
    };
}
