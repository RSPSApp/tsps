import { getOrientation, isMobileMode, isTouchDevice } from "../../../../common/utils/DeviceUtil";
import { LoginIndex } from "../../GameState";
import type { LoginState } from "../../LoginState";
import type { LoginRendererHost, RenderContext } from "../host";
import type { LoginLayoutConfig } from "../types";

export function computeLayoutConfig(host: LoginRendererHost, canvasWidth: number, canvasHeight: number) {

        const orientation = getOrientation();
        const isMobile = isMobileMode;
        const isTouch = isTouchDevice;

        // OSRS desktop title/login used to stay at a fixed 765x503 scene. Layout now follows
        // the real viewport; keep scale at 1 so we don't shrink a scene that already matches.
        let scale = 1.0;

        // On mobile with small screens (portrait or small landscape), use list mode for world select
        // List mode provides 60px rows vs 19px grid rows for touch targets
        const worldSelectListMode = isMobile && (orientation === "portrait" || canvasHeight < 400);

        // Minimum touch target (44px is Apple HIG recommendation)
        const minTouchTarget = isTouch ? 44 : 0;

        host.layoutConfig = {
            scale,
            isMobile,
            isTouch,
            minTouchTarget,
            worldSelectListMode,
            orientation,
            viewportWidth: canvasWidth,
            viewportHeight: canvasHeight,
        };

        // Update scaled positions
        host.scaledLoginBoxX = host.loginBoxX * scale;
        host.scaledLoginBoxCenter = host.loginBoxCenter * scale;

        return host.layoutConfig;
    
}

export function getLayoutConfig(host: LoginRendererHost) {

        return host.layoutConfig;
    
}

export function getRenderScale(host: LoginRendererHost) {

        return host.renderScale;
    
}

export function getTitleAssetStateHash(host: LoginRendererHost) {

        return `${host.logoImageLoaded ? 1 : 0}|${host.logoSprite ? 1 : 0}|${
            host.titleBackgroundImage ? 1 : 0
        }|${host.titleboxSprite ? 1 : 0}|${host.titlebuttonSprite ? 1 : 0}|${
            host.titleMuteSprites?.length ?? 0
        }|${host.fontBold12 ? 1 : 0}|${host.fontPlain11 ? 1 : 0}|${host.fontPlain12 ? 1 : 0}|${
            host.loginScreenRunesAnimation ? 1 : 0
        }`;
    
}

export function syncMobileViewportState(host: LoginRendererHost, state: LoginState, keyboardFocused = false) {

        host.mobileKeyboardFocusActive =
            state.loginIndex === LoginIndex.LOGIN_FORM &&
            state.onMobile &&
            state.virtualKeyboardVisible &&
            keyboardFocused;
        host.mobileKeyboardFocusField = state.currentLoginField === 1 ? 1 : 0;
    
}

export function getViewportTransformStateHash(host: LoginRendererHost) {

        return `${host.mobileKeyboardFocusActive ? 1 : 0}|${host.mobileKeyboardFocusField}|${
            host.renderScale
        }|${host.renderOffsetX}|${host.renderOffsetY}|${host.contentScale}|${
            host.contentSmoothing ? 1 : 0
        }`;
    
}

function clampFocusedOffset(offset: number, scaledSceneSize: number, surfaceSize: number) {

        if (!Number.isFinite(offset)) {
            return 0;
        }
        if (scaledSceneSize <= surfaceSize) {
            return Math.round((surfaceSize - scaledSceneSize) / 2);
        }

        const minOffset = Math.round(surfaceSize - scaledSceneSize);
        if (offset < minOffset) {
            return minOffset;
        }
        if (offset > 0) {
            return 0;
        }
        return Math.round(offset);
    
}

export function getMobileKeyboardFocusTransform(host: LoginRendererHost, viewportWidth: number, viewportHeight: number, drawSurfaceWidth: number, drawSurfaceHeight: number, safeSurfaceScale: number, layoutScale: number) {

        if (!host.mobileKeyboardFocusActive || !host.layoutConfig.isMobile) {
            return undefined;
        }

        // Layout already matches the viewport; zoom in slightly so fields stay above the keyboard.
        const focusedScale = Math.max(layoutScale, Math.min(2.4, layoutScale * 1.35));
        if (!Number.isFinite(focusedScale) || focusedScale <= layoutScale) {
            return undefined;
        }

        const renderScale = focusedScale * safeSurfaceScale;
        const scaledSceneWidth = viewportWidth * renderScale;
        const scaledSceneHeight = viewportHeight * renderScale;
        const focusX =
            host.contentOriginX + host.LOGIN_BOX_CENTER * host.contentScale;
        const focusY =
            host.contentOriginY +
            (host.TITLEBOX_Y + (host.mobileKeyboardFocusField === 1 ? 86 : 71)) *
                host.contentScale;
        const targetFocusX = drawSurfaceWidth / 2;
        const targetFocusY = drawSurfaceHeight * 0.46;
        const renderOffsetX = clampFocusedOffset(
            targetFocusX - focusX * renderScale,
            scaledSceneWidth,
            drawSurfaceWidth,
        );
        const renderOffsetY = clampFocusedOffset(
            targetFocusY - focusY * renderScale,
            scaledSceneHeight,
            drawSurfaceHeight,
        );

        return {
            renderScale,
            renderOffsetX,
            renderOffsetY,
        };
    
}

export function withRenderTransform(host: LoginRendererHost, ctx: RenderContext, drawFn: () => void): void {

        const scale = host.renderScale;
        const offsetX = host.renderOffsetX;
        const offsetY = host.renderOffsetY;
        const priorSmoothing = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = false;

        if (Math.abs(scale - 1.0) < 0.0001 && offsetX === 0 && offsetY === 0) {
            try {
                drawFn();
            } finally {
                ctx.imageSmoothingEnabled = priorSmoothing;
            }
            return;
        }

        ctx.save();
        ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
        try {
            drawFn();
        } finally {
            ctx.restore();
            ctx.imageSmoothingEnabled = priorSmoothing;
        }
    
}

export function toLayoutPoint(host: LoginRendererHost, x: number, y: number): { x: number; y: number } {

        const scale = host.renderScale;
        if (!Number.isFinite(scale) || scale <= 0) {
            return { x: x | 0, y: y | 0 };
        }

        const layoutX = Math.floor((x - host.renderOffsetX) / scale);
        const layoutY = Math.floor((y - host.renderOffsetY) / scale);
        return { x: layoutX, y: layoutY };
    
}
