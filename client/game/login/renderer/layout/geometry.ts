import { LOGIN_LAYOUT } from "../constants";
import type { LoginRendererHost, RenderContext } from "../host";

export function getTitleBackgroundLayout(host: LoginRendererHost) {

        const art = host.titleBackgroundImage;
        if (art && host.titleBackgroundFromCache) {
            // The cache's title art: centred on the scene and drawn whole, growing past the scene's
            // scale (up to TITLE_ART_MAX_GROWTH times) while the viewport still fits it, so large
            // screens are not mostly black. Where even the scene's scale doesn't fit it whole, its
            // classic 765x503 part (centred, at the top) lies under the scene, as in the classic client.
            const sceneScale = host.contentScale > 0 ? host.contentScale : 1;
            const centerX = host.contentOriginX + (host.SCENE_WIDTH * sceneScale) / 2;
            const centerY = host.contentOriginY + (host.SCENE_HEIGHT * sceneScale) / 2;
            const fit = Math.min(
                (2 * Math.min(centerX - host.containerX, host.containerX + host.containerWidth - centerX)) / art.width,
                (2 * Math.min(centerY, host.containerHeight - centerY)) / art.height,
            );
            if (fit < sceneScale) {
                const sceneX = (art.width - host.SCENE_WIDTH) / 2;
                return {
                    drawX: host.contentOriginX - sceneX * sceneScale,
                    drawY: host.contentOriginY,
                    drawW: art.width * sceneScale,
                    drawH: art.height * sceneScale,
                    scale: sceneScale,
                };
            }
            const scale = Math.min(sceneScale * LOGIN_LAYOUT.TITLE_ART_MAX_GROWTH, fit);
            const drawW = art.width * scale;
            const drawH = art.height * scale;
            return { drawX: centerX - drawW / 2, drawY: centerY - drawH / 2, drawW, drawH, scale };
        }
        // The bundled widescreen image covers the viewport.
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

/**
 * Where the classic 765x503 scene lies in the drawn title art: its middle 765 columns (from the
 * top), (1089 - 765) / 2 = 162 in for the cache's titlewide art and the bundled image, none for
 * title.jpg. What is painted on the art (the flames, the logo) goes through this, so it stays
 * on the art and grows with it on large viewports.
 */
export function getTitleArtScene(host: LoginRendererHost) {

        const bg = getTitleBackgroundLayout(host);
        const artW = host.titleBackgroundImage?.width || LOGIN_LAYOUT.TITLE_BG_WIDTH;
        const cropX = Math.max(0, Math.floor((artW - host.SCENE_WIDTH) / 2));
        const scale = bg.drawW / artW;
        return { x: bg.drawX + cropX * scale, y: bg.drawY, scale };

}

export function getLogicalFirePositions(host: LoginRendererHost) {

        // Classic 765-scene fire edges (-22 and 765 - 128 + 22), scaled with the art so the
        // bowl size matches it.
        const scene = getTitleArtScene(host);
        return {
            leftX: scene.x - 22 * scene.scale,
            rightX: scene.x + (host.SCENE_WIDTH - 128 + 22) * scene.scale,
            y: scene.y,
            scale: scene.scale,
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
 * enlarges it without integer scaling, or a phone fits it at a fractional scale, the
 * content is drawn "sharp bilinear": nearest-neighbour up to the next whole multiple of
 * the device scale in a buffer, then filtered down once to the exact size. Edges stay
 * crisp without the uneven blocks of fractional nearest-neighbour or the blur and
 * per-sprite fringes of filtering every sprite on its own.
 */
export function withContentTransform(host: LoginRendererHost, ctx: RenderContext, drawFn: (ctx: RenderContext) => void): void {

        const deviceScale = host.contentScale * (host.renderScale > 0 ? host.renderScale : 1);
        const factor = Math.ceil(deviceScale - 0.01);
        const buffer =
            host.contentSmoothing && Math.abs(deviceScale - factor) > 0.01
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

/** Login form "Remember username" row (also asks to stay logged in), above the Login/Cancel buttons. */
export const REMEMBER_USERNAME_TEXT = "Remember username: ";
export const LOGIN_FORM_REMEMBER_Y = 281;
export const LOGIN_FORM_BUTTON_Y = 321;

/**
 * Remembered-account screen, laid out like live's launcher login (measured from a live
 * screenshot): "Welcome to ...", then the large "Play Now" button with the account name in it,
 * and below it a "Sign out" button, as live's mobile client has (its "Switch character" has no
 * counterpart here). Sign out forgets the remembered login, on the server too.
 */
export const REMEMBERED_TITLE_Y = 207;
/** Centre of titlebutton_large; "Play Now" sits 13 above it, the name's baseline 18 below. */
export const REMEMBERED_PLAY_Y = 262;
export const REMEMBERED_SIGN_OUT_TEXT = "Sign out";
/** Centre of the Sign out button (titlebutton), where the screens' single "Back" buttons sit. */
export const REMEMBERED_SIGN_OUT_Y = 326;

/** The large Play Now button's bounds around its centre (titlebutton_large is 218x68). */
export function getRememberedPlayBounds(host: LoginRendererHost) {
    const width = host.titlebuttonLargeSprite?.width || 218;
    const height = host.titlebuttonLargeSprite?.height || 68;
    const centerX = host.loginBoxX + 180;
    return { x: centerX - Math.floor(width / 2), y: REMEMBERED_PLAY_Y - Math.floor(height / 2), width, height };
}
