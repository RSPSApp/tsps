import type { BitmapFont } from "../../../../rs/font/BitmapFont";
import type { IndexedSprite } from "../../../../rs/sprite/IndexedSprite";
import type { LoginRendererHost, RenderContext } from "../host";
import { getTitleArtScene, withContentTransform } from "../layout/geometry";

export function drawGradientRect(host: LoginRendererHost, ctx: RenderContext, x: number, y: number, width: number, height: number, startColor: number, endColor: number) {

        const gradient = ctx.createLinearGradient(x, y, x, y + height);
        gradient.addColorStop(0, "#" + (startColor & 0xffffff).toString(16).padStart(6, "0"));
        gradient.addColorStop(1, "#" + (endColor & 0xffffff).toString(16).padStart(6, "0"));
        ctx.fillStyle = gradient;
        ctx.fillRect(x, y, width, height);
    
}

export function drawSpriteWithOverlay(host: LoginRendererHost, ctx: RenderContext, sprite: IndexedSprite, x: number, y: number, alpha: number, overlayColor: number) {

        // Draw sprite first
        drawSprite(host, ctx, sprite, x, y);

        // Then draw overlay with alpha
        const w = sprite.subWidth;
        const h = sprite.subHeight;
        if (w <= 0 || h <= 0) return;

        ctx.save();
        ctx.globalAlpha = alpha / 255;
        ctx.fillStyle = "#" + (overlayColor & 0xffffff).toString(16).padStart(6, "0");
        ctx.fillRect(x + sprite.xOffset, y + sprite.yOffset, w, h);
        ctx.restore();
    
}

export function drawLogoToCtx(host: LoginRendererHost, ctx: RenderContext): void {

        const drawLogo = (ctx: RenderContext) => {
            const logoY = 18;
            // The cache's logo sprite, as the OSRS client draws it; the bundled image only without one.
            if (host.logoSprite) {
                const logoX = host.LOGIN_BOX_CENTER - Math.floor(host.logoSprite.subWidth / 2);
                drawSprite(host, ctx, host.logoSprite, logoX, logoY);
            } else if (host.logoImageLoaded && host.logoImage) {
                const logoX = host.LOGIN_BOX_CENTER - Math.floor(host.logoImage.width / 2);
                ctx.drawImage(host.logoImage, logoX, logoY);
            }
        };
        if (!host.titleBackgroundImage || !host.titleBackgroundFromCache) {
            withContentTransform(host, ctx, drawLogo);
            return;
        }
        // The cache's art grows past the scene on large viewports: the logo is painted on it,
        // so it grows with it, as the flames do.
        const scene = getTitleArtScene(host);
        ctx.save();
        ctx.translate(scene.x, scene.y);
        ctx.scale(scene.scale, scene.scale);
        try {
            drawLogo(ctx);
        } finally {
            ctx.restore();
        }
    
}

export function drawButton(host: LoginRendererHost, ctx: RenderContext, centerX: number, centerY: number, text: string, font: BitmapFont = host.fontBold12!) {

        if (!host.titlebuttonSprite || !font) return;

        const buttonW = host.titlebuttonSprite.subWidth;
        const buttonH = host.titlebuttonSprite.subHeight;
        const buttonX = Math.floor(centerX - buttonW / 2);
        const buttonY = Math.floor(centerY - buttonH / 2);

        drawSprite(host, ctx, host.titlebuttonSprite, buttonX, buttonY);
        drawCenteredText(host, ctx, font, text, centerX, centerY + 5, 0xffffff, true);
    
}

export function drawSprite(host: LoginRendererHost, ctx: RenderContext, sprite: IndexedSprite, x: number, y: number) {

        const w = sprite.subWidth;
        const h = sprite.subHeight;
        if (w <= 0 || h <= 0) return;
        const drawX = Math.floor(x + sprite.xOffset);
        const drawY = Math.floor(y + sprite.yOffset);

        // Performance: check cache first to avoid expensive re-rendering
        const cached = host.spriteCache.get(sprite);
        if (cached) {
            ctx.drawImage(cached, drawX, drawY);
            return;
        }

        // Check for OffscreenCanvas support
        if (typeof OffscreenCanvas === "undefined") {
            console.warn(
                "[LoginRenderer] OffscreenCanvas not supported, sprite rendering may be degraded",
            );
            return;
        }

        // Create a dedicated OffscreenCanvas for this sprite (cached synchronously)
        const spriteCanvas = new OffscreenCanvas(w, h);
        const spriteCtx = spriteCanvas.getContext("2d");
        if (!spriteCtx) {
            return;
        }

        // Render sprite to its dedicated canvas
        const imageData = spriteCtx.createImageData(w, h);
        const data = imageData.data;
        const pixels = sprite.pixels;
        const palette = sprite.palette;
        const alpha = sprite.alpha;

        for (let i = 0; i < pixels.length; i++) {
            const paletteIndex = pixels[i] & 0xff;
            if (paletteIndex === 0 && (!alpha || alpha[i] === 0)) {
                data[i * 4] = 0;
                data[i * 4 + 1] = 0;
                data[i * 4 + 2] = 0;
                data[i * 4 + 3] = 0;
            } else {
                const color = palette[paletteIndex];
                data[i * 4] = (color >> 16) & 0xff;
                data[i * 4 + 1] = (color >> 8) & 0xff;
                data[i * 4 + 2] = color & 0xff;
                data[i * 4 + 3] = alpha ? alpha[i] : 255;
            }
        }

        spriteCtx.putImageData(imageData, 0, 0);

        // Cache synchronously - no async createImageBitmap overhead
        host.spriteCache.set(sprite, spriteCanvas);

        // Draw from the cached canvas
        ctx.drawImage(spriteCanvas, drawX, drawY);
    
}

export function drawCenteredText(host: LoginRendererHost, ctx: RenderContext, font: BitmapFont, text: string, x: number, y: number, color: number, shadowed = false) {

        const textWidth = measureText(host, font, text);
        drawText(host, ctx, font, text, x - Math.floor(textWidth / 2), y, color, shadowed);
    
}

export function measureText(host: LoginRendererHost, font: BitmapFont, text: string) {

        let fontCache = host.textMeasureCache.get(font);
        if (!fontCache) {
            fontCache = new Map<string, number>();
            host.textMeasureCache.set(font, fontCache);
        }
        const cached = fontCache.get(text);
        if (cached !== undefined) {
            return cached;
        }
        const width = font.measure(text);
        fontCache.set(text, width);
        return width;
    
}

export function drawText(host: LoginRendererHost, ctx: RenderContext, font: BitmapFont, text: string, x: number, y: number, color: number, shadowed = false) {

        // The native title screen draws login-box text with a black +1,+1 shadow
        // (AbstractFont.draw(..., color, 0)); world select and the loading bar
        // pass -1 (no shadow).
        if (shadowed) {
            font.draw(ctx, text, x + 1, y + 1, "#000000");
        }
        const colorStr = "#" + (color & 0xffffff).toString(16).padStart(6, "0");
        font.draw(ctx, text, x, y, colorStr);
    
}

export function getCheckboxSprite(host: LoginRendererHost, checked: boolean, hover: boolean) {

        if (checked) {
            return hover ? host.optionsRadioSprite6 : host.optionsRadioSprite2;
        } else {
            return hover ? host.optionsRadioSprite4 : host.optionsRadioSprite0;
        }
    
}

export function truncateFromStart(host: LoginRendererHost, str: string, maxWidth: number) {

        if (!host.fontBold12) return str;
        while (host.fontBold12.measure(str) > maxWidth && str.length > 0) {
            str = str.substring(1);
        }
        return str;
    
}

export function ellipsis(host: LoginRendererHost, str: string, maxWidth: number) {

        if (!host.fontPlain12) return str;
        if (host.fontPlain12.measure(str) <= maxWidth) return str;
        const ellip = "...";
        const ellipW = host.fontPlain12.measure(ellip);
        while (host.fontPlain12.measure(str) + ellipW > maxWidth && str.length > 0) {
            str = str.slice(0, -1);
        }
        return str + ellip;
    
}
