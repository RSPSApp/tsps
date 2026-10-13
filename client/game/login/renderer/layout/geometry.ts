import { LOGIN_LAYOUT } from "../constants";
import type { LoginRendererHost, RenderContext } from "../host";

export function getTitleBackgroundLayout(host: LoginRendererHost) {

        const targetW = Math.max(1, host.containerWidth);
        const targetH = Math.max(1, host.containerHeight);
        const img = host.titleBackgroundImage;
        const srcW = img?.width || LOGIN_LAYOUT.TITLE_BG_WIDTH;
        const srcH = img?.height || LOGIN_LAYOUT.MAX_BG_HEIGHT;
        const scale = Math.max(targetW / srcW, targetH / srcH);
        const drawW = srcW * scale;
        const drawH = srcH * scale;
        return {
            drawX: host.containerX + (targetW - drawW) / 2,
            drawY: (targetH - drawH) / 2,
            drawW,
            drawH,
            scale,
        };
    
}

export function getLogicalFirePositions(host: LoginRendererHost) {

        // Classic 765-scene fire edges mapped into the 1089-wide title art:
        //   cropX = (1089 - 765) / 2 = 162
        //   left  = 162 + (-22) = 140
        //   right = 162 + (765 - 128 + 22) = 821
        // Track those art-space X values through the cover-fit background transform.
        const bg = getTitleBackgroundLayout(host);
        const artW = LOGIN_LAYOUT.TITLE_BG_WIDTH;
        const leftSrcX = LOGIN_LAYOUT.TITLE_BG_CROP_X - 22;
        const rightSrcX = LOGIN_LAYOUT.TITLE_BG_CROP_X + host.SCENE_WIDTH - 128 + 22;
        // Scale fire sprites with the background so bowl size matches the art.
        const fireScale = bg.drawW / artW;
        return {
            leftX: bg.drawX + (leftSrcX / artW) * bg.drawW,
            rightX: bg.drawX + (rightSrcX / artW) * bg.drawW,
            y: bg.drawY,
            scale: fireScale,
        };
    
}

export function getVisibleLayoutRightEdge(host: LoginRendererHost) {

        const scale = Math.max(host.renderScale, 0.0001);
        return (host.renderSurfaceWidth - host.renderOffsetX) / scale;
    
}

/**
 * The visible part of the viewport in content space. On desktop the whole 765x503
 * scene fits; on short phones the mobile titlebox boost can push its edges off screen.
 */
function getVisibleContentBounds(host: LoginRendererHost) {

        const scale = host.contentScale > 0 ? host.contentScale : 1;
        const rightEdge = Math.min(
            host.containerX + host.containerWidth,
            getVisibleLayoutRightEdge(host),
        );
        return {
            left: (host.containerX - host.contentOriginX) / scale,
            right: (rightEdge - host.contentOriginX) / scale,
            bottom: (host.canvasHeight - host.contentOriginY) / scale,
        };

}

function getBottomControlsY(host: LoginRendererHost) {

        // Classic client: both controls at y 463 of the scene, kept on screen.
        const bounds = getVisibleContentBounds(host);
        return Math.floor(Math.min(LOGIN_LAYOUT.BOTTOM_CONTROLS_Y, bounds.bottom - 40));

}

/** World switch button, in content space: the scene's bottom-left corner (xPadding + 5). */
export function getServerListButtonPosition(host: LoginRendererHost) {

        const bounds = getVisibleContentBounds(host);
        return {
            x: Math.ceil(Math.max(5, bounds.left + 5)),
            y: getBottomControlsY(host),
        };

}

/** Music mute button, in content space: the scene's bottom-right corner (xPadding + 765 - 40). */
export function getTitleMuteDrawPosition(host: LoginRendererHost) {

        const bounds = getVisibleContentBounds(host);
        return {
            x: Math.floor(Math.min(host.SCENE_WIDTH - 40, bounds.right - 40)),
            y: getBottomControlsY(host),
        };

}

function getTitleBoxLayout(host: LoginRendererHost) {

        const width = host.titleboxSprite?.subWidth || host.TITLEBOX_FALLBACK_WIDTH;
        const height = host.titleboxSprite?.subHeight || host.TITLEBOX_FALLBACK_HEIGHT;
        const x = host.LOGIN_BOX_X;
        const y = host.TITLEBOX_Y;
        return {
            x,
            y,
            width,
            height,
            centerX: x + Math.floor(width / 2),
        };
    
}

export function getWelcomeLayout(host: LoginRendererHost) {

        const box = getTitleBoxLayout(host);
        return {
            centerX: box.centerX,
            titleY: box.y + Math.round(box.height * 0.405),
            buttonY: box.y + Math.round(box.height * 0.605),
            buttonSpacing: Math.max(60, Math.round(box.width * 0.222)),
        };
    
}

export function toContentPoint(host: LoginRendererHost, layoutX: number, layoutY: number) {

        const scale = host.contentScale > 0 ? host.contentScale : 1;
        return {
            x: (layoutX - host.contentOriginX) / scale,
            y: (layoutY - host.contentOriginY) / scale,
        };
    
}

export function mapPointerToContent(host: LoginRendererHost, layoutX: number, layoutY: number) {

        return toContentPoint(host, layoutX, layoutY);
    
}

let upscaleBuffer: OffscreenCanvas | undefined;
let upscaleCtx: OffscreenCanvasRenderingContext2D | undefined;

function getUpscaleContext(width: number, height: number): OffscreenCanvasRenderingContext2D | undefined {

        if (typeof OffscreenCanvas === "undefined") return undefined;
        if (!upscaleBuffer || upscaleBuffer.width !== width || upscaleBuffer.height !== height) {
            upscaleBuffer = new OffscreenCanvas(width, height);
            upscaleCtx = upscaleBuffer.getContext("2d") ?? undefined;
        }
        return upscaleCtx;

}

/**
 * Draws classic 765x503 content into the scaled content band. When Stretched Mode
 * enlarges it without integer scaling, the content is drawn "sharp bilinear": nearest-neighbour up to the next whole multiple of
 * the device scale in a buffer, then filtered down once to the exact size. Edges stay
 * crisp without the uneven blocks of fractional nearest-neighbour or the blur and
 * per-sprite fringes of filtering every sprite on its own.
 */
export function withContentTransform(host: LoginRendererHost, ctx: RenderContext, drawFn: (ctx: RenderContext) => void): void {

        const deviceScale = host.contentScale * (host.renderScale > 0 ? host.renderScale : 1);
        const factor = Math.ceil(deviceScale - 0.01);
        const buffer =
            host.contentSmoothing && factor > 1
                ? getUpscaleContext(host.SCENE_WIDTH * factor, host.SCENE_HEIGHT * factor)
                : undefined;

        ctx.save();
        ctx.translate(host.contentOriginX, host.contentOriginY);
        if (host.contentScale !== 1) {
            ctx.scale(host.contentScale, host.contentScale);
        }
        try {
            if (!buffer) {
                drawFn(ctx);
                return;
            }
            buffer.setTransform(1, 0, 0, 1, 0, 0);
            buffer.clearRect(0, 0, buffer.canvas.width, buffer.canvas.height);
            buffer.save();
            buffer.scale(factor, factor);
            buffer.imageSmoothingEnabled = false;
            try {
                drawFn(buffer);
            } finally {
                buffer.restore();
            }
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(buffer.canvas, 0, 0, host.SCENE_WIDTH, host.SCENE_HEIGHT);
        } finally {
            ctx.restore();
        }

}
