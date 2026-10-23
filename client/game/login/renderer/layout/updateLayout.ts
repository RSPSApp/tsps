import { isMobileMode } from "../../../../common/utils/DeviceUtil";
import { LOGIN_LAYOUT } from "../constants";
import type { LoginRendererHost } from "../host";
import { computeLayoutConfig, getMobileKeyboardFocusTransform } from "./config";

export function updateLayout(
    host: LoginRendererHost,
    canvasWidth: number,
    canvasHeight: number,
    surfaceWidth: number = canvasWidth,
    surfaceHeight: number = canvasHeight,
): void {

        // Validate dimensions - use defaults if invalid
        if (!Number.isFinite(canvasWidth) || canvasWidth <= 0) {
            canvasWidth = host.SCENE_WIDTH;
        }
        if (!Number.isFinite(canvasHeight) || canvasHeight <= 0) {
            canvasHeight = host.SCENE_HEIGHT;
        }
        if (!Number.isFinite(surfaceWidth) || surfaceWidth <= 0) {
            surfaceWidth = canvasWidth;
        }
        if (!Number.isFinite(surfaceHeight) || surfaceHeight <= 0) {
            surfaceHeight = canvasHeight;
        }

        const viewportWidth = Math.max(1, Math.round(canvasWidth));
        const viewportHeight = Math.max(1, Math.round(canvasHeight));
        const drawSurfaceWidth = Math.max(1, Math.round(surfaceWidth));
        const drawSurfaceHeight = Math.max(1, Math.round(surfaceHeight));

        computeLayoutConfig(host, viewportWidth, viewportHeight);

        const layoutScale = host.layoutConfig.scale > 0 ? host.layoutConfig.scale : 1.0;
        const surfaceScaleX = drawSurfaceWidth / viewportWidth;
        const surfaceScaleY = drawSurfaceHeight / viewportHeight;
        const surfaceScale = Math.min(surfaceScaleX, surfaceScaleY);
        const safeSurfaceScale =
            Number.isFinite(surfaceScale) && surfaceScale > 0 ? surfaceScale : 1.0;

        // Use the real viewport as the login layout (dynamic width/height).
        // Surface scale maps CSS layout pixels onto the device-pixel draw buffer.
        let renderScale = layoutScale * safeSurfaceScale;
        const layoutWidth = viewportWidth;
        const layoutHeight = viewportHeight;

        let renderOffsetX = Math.floor(
            (drawSurfaceWidth - Math.round(layoutWidth * renderScale)) / 2,
        );
        let renderOffsetY = Math.floor(
            (drawSurfaceHeight - Math.round(layoutHeight * renderScale)) / 2,
        );
        const mobileFocusTransform = getMobileKeyboardFocusTransform(host, 
            viewportWidth,
            viewportHeight,
            drawSurfaceWidth,
            drawSurfaceHeight,
            safeSurfaceScale,
            layoutScale,
        );
        if (mobileFocusTransform) {
            renderScale = mobileFocusTransform.renderScale;
            renderOffsetX = mobileFocusTransform.renderOffsetX;
            renderOffsetY = mobileFocusTransform.renderOffsetY;
        }

        host.renderScale = renderScale;
        host.renderSurfaceWidth = drawSurfaceWidth;
        host.renderOffsetX = renderOffsetX;
        host.renderOffsetY = renderOffsetY;

        host.canvasWidth = layoutWidth;
        host.canvasHeight = layoutHeight;

        // Background fills the dynamic viewport.
        host.containerWidth = layoutWidth;
        host.containerHeight = layoutHeight;
        host.containerX = 0;

        // Classic login UI is authored for 765×503. Scale it to fit when the viewport
        // is smaller. OSRS never draws it larger, so it only grows past 1:1 with Stretched
        // Mode on: with viewports taller than a 1080p screen's, keeping the same share of a
        // large monitor rather than filling it. On mobile, bias upward so the titlebox
        // stays readable (full-scene fit alone leaves the 360px panel too small on short phones).
        const padX = 8;
        const padTop = 8;
        // Desktop draws the server/mute controls inside the scene (y 463, as the classic
        // client does), so they need no reserve. Mobile can clip the scene and keeps them
        // pinned above the bottom edge instead.
        const padBottom = isMobileMode ? host.BOTTOM_CONTROLS_RESERVE : padTop;
        const availableW = Math.max(1, layoutWidth - padX * 2);
        const availableH = Math.max(1, layoutHeight - padTop - padBottom);
        const stretch = host.loginStretch();
        const viewportGrowth = stretch
            ? Math.max(1, layoutHeight / LOGIN_LAYOUT.SCENE_REFERENCE_VIEWPORT_HEIGHT)
            : 1;
        const sceneFit = Math.min(
            viewportGrowth,
            availableW / host.SCENE_WIDTH,
            availableH / host.SCENE_HEIGHT,
        );
        let contentScale =
            Number.isFinite(sceneFit) && sceneFit > 0 ? sceneFit : 1;
        if (stretch?.integerScaling && contentScale > 1) {
            // Whole device pixels per scene pixel, as Stretched Mode's integer scaling does.
            contentScale = Math.max(
                1,
                Math.floor(contentScale * safeSurfaceScale) / safeSurfaceScale,
            );
        }

        if (isMobileMode) {
            const titleboxW =
                host.titleboxSprite?.subWidth || host.TITLEBOX_FALLBACK_WIDTH;
            const titleboxH =
                host.titleboxSprite?.subHeight || host.TITLEBOX_FALLBACK_HEIGHT;
            // Aim for the panel to use most of the short axis without covering
            // bottom server/mute controls. Side margins of the classic 765 band
            // may clip — that is empty art space around the centered box.
            const titleboxFit = Math.min(
                availableW / (titleboxW + 32),
                availableH / (titleboxH + 72),
            );
            if (Number.isFinite(titleboxFit) && titleboxFit > contentScale) {
                contentScale = Math.min(titleboxFit, contentScale * 1.28);
            }
        }

        host.contentScale = contentScale;
        // Fractional scales drawn nearest-neighbour land glyph columns on 1 or 2 pixels
        // unevenly. Stretched Mode upscales and phones fit the scene to a short screen at
        // any ratio, so both draw through the sharp-bilinear buffer instead.
        host.contentSmoothing =
            (!!stretch && !stretch.integerScaling && contentScale > 1) ||
            (isMobileMode && Math.abs(contentScale - Math.round(contentScale)) > 0.01);

        const scaledW = host.SCENE_WIDTH * host.contentScale;
        const scaledH = host.SCENE_HEIGHT * host.contentScale;
        host.contentOriginX = Math.floor((layoutWidth - scaledW) / 2);

        const titleboxH =
            host.titleboxSprite?.subHeight || host.TITLEBOX_FALLBACK_HEIGHT;
        const titleboxMid = host.TITLEBOX_Y + titleboxH / 2;

        if (isMobileMode) {
            // Center the titlebox on the full viewport (not the band above the
            // bottom-control reserve). That reserve only clamps so the panel
            // doesn't cover server/mute — it must not bias the panel upward.
            const preferredOriginY =
                layoutHeight / 2 - titleboxMid * host.contentScale;
            const minOriginY = padTop - host.TITLEBOX_Y * host.contentScale;
            const maxOriginY =
                layoutHeight -
                padBottom -
                (host.TITLEBOX_Y + titleboxH) * host.contentScale;
            host.contentOriginY = Math.floor(
                maxOriginY < minOriginY
                    ? (minOriginY + maxOriginY) / 2
                    : Math.max(minOriginY, Math.min(preferredOriginY, maxOriginY)),
            );
        } else {
            // Desktop: center the whole scene, bottom controls included.
            host.contentOriginY = Math.floor(
                padTop + Math.max(0, (availableH - scaledH) / 2),
            );
        }
        host.xPadding = host.contentOriginX;

        // Draw/hit-test login panels in classic coordinates; the content transform maps them.
        host.loginBoxX = host.LOGIN_BOX_X;
        host.loginBoxCenter = host.LOGIN_BOX_CENTER;
        host.titleboxY = host.TITLEBOX_Y;
    
}
