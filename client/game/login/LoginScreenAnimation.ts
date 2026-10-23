import { IndexedSprite } from "../../rs/sprite/IndexedSprite";

/**
 * The flame palettes when the cache gives none (graphics defaults opcode 3 holds them): the
 * classic red flames and the green and blue they flash to.
 */
export const CLASSIC_FLAME_PALETTES: number[][] = [
    [0x000000, 0xff0000, 0xffff00, 0xffffff, 0xffffff],
    [0x000000, 0x00ff00, 0x00ffff, 0xffffff, 0xffffff],
    [0x000000, 0x0000ff, 0xff00ff, 0xffffff, 0xffffff],
];

/**
 * A 256-entry flame palette running through five colours, 64 entries from each to the next. A
 * channel steps by (to - from + sign) / 64, which gives the classic palettes exactly (4 a step for
 * a full 0-255 run).
 */
export function buildFlamePalette(colours: number[]): Int32Array {
    const palette = new Int32Array(256);
    for (let segment = 0; segment < 4; segment++) {
        const from = colours[segment] ?? 0;
        const to = colours[segment + 1] ?? from;
        for (let i = 0; i < 64; i++) {
            let colour = 0;
            for (const shift of [16, 8, 0]) {
                const a = (from >> shift) & 0xff;
                const delta = ((to >> shift) & 0xff) - a;
                colour |= (a + Math.trunc((i * (delta + Math.sign(delta))) / 64)) << shift;
            }
            palette[segment * 64 + i] = colour;
        }
    }
    return palette;
}

/**
 * Login screen runes flame animation.
 */
export class LoginScreenAnimation {
    private static readonly FIRE_WIDTH = 128;
    private static readonly FIRE_TEXTURE_HEIGHT = 264;
    private static readonly FIRE_Y_OFFSET = 8;
    private sprites: IndexedSprite[];
    private colorPaletteRed: Int32Array;
    private colorPaletteGreen: Int32Array;
    private colorPaletteBlue: Int32Array;
    private currentPalette: Int32Array;
    private noiseMap: Int32Array;
    private tempNoiseMap: Int32Array;
    private fireBuffer: Int32Array;
    private tempFireBuffer: Int32Array;
    private sineOffsets: Int32Array;
    private sinePhase: number = 0;
    private redFlashTimer: number = 0;
    private greenFlashTimer: number = 0;
    private lastCycle: number = 0;
    private noiseOffset: number = 0;
    private sparkCycle: number = 0;
    private offscreenCanvas: OffscreenCanvas | null = null;
    private offscreenCtx: OffscreenCanvasRenderingContext2D | null = null;
    private cachedImageData: ImageData | null = null;
    private cachedImageDataWidth: number = 0;
    private cachedImageDataHeight: number = 0;
    private lastTimeMs: number = 0;
    private accumulator: number = 0;
    private static readonly MS_PER_TICK = 20;

    constructor(sprites: IndexedSprite[], flamePalettes: number[][] = CLASSIC_FLAME_PALETTES) {
        this.sprites = sprites;
        this.sineOffsets = new Int32Array(256);
        this.colorPaletteRed = new Int32Array(256);
        this.colorPaletteGreen = new Int32Array(256);
        this.colorPaletteBlue = new Int32Array(256);
        this.currentPalette = new Int32Array(256);
        this.noiseMap = new Int32Array(32768);
        this.tempNoiseMap = new Int32Array(32768);
        this.fireBuffer = new Int32Array(32768);
        this.tempFireBuffer = new Int32Array(32768);
        this.initColors(flamePalettes);
    }

    private initColors(flamePalettes: number[][]): void {
        const [base, flash1, flash2] = flamePalettes.length === 3 ? flamePalettes : CLASSIC_FLAME_PALETTES;
        this.colorPaletteRed.set(buildFlamePalette(base));
        this.colorPaletteGreen.set(buildFlamePalette(flash1));
        this.colorPaletteBlue.set(buildFlamePalette(flash2));
        this.resetNoiseMap(null);
    }

    private resetNoiseMap(sprite: IndexedSprite | null): void {
        for (let i = 0; i < this.noiseMap.length; i++) {
            this.noiseMap[i] = 0;
        }

        for (let i = 0; i < 5000; i++) {
            const index = Math.floor(Math.random() * 128 * 256);
            this.noiseMap[index] = Math.floor(Math.random() * 256);
        }

        for (let iter = 0; iter < 20; iter++) {
            for (let y = 1; y < 255; y++) {
                for (let x = 1; x < 127; x++) {
                    const idx = x + (y << 7);
                    this.tempNoiseMap[idx] = Math.floor(
                        (this.noiseMap[idx + 1] +
                            this.noiseMap[idx + 128] +
                            this.noiseMap[idx - 128] +
                            this.noiseMap[idx - 1]) /
                            4,
                    );
                }
            }
            const temp = this.noiseMap;
            this.noiseMap = this.tempNoiseMap;
            this.tempNoiseMap = temp;
        }

        if (sprite !== null) {
            const runeX = sprite.xOffset + 16;
            const runeY = sprite.yOffset + 16;

            let pixelIndex = 0;
            for (let y = 0; y < sprite.subHeight; y++) {
                for (let x = 0; x < sprite.subWidth; x++) {
                    if (sprite.pixels[pixelIndex++] !== 0) {
                        const mapX = x + runeX;
                        const mapY = y + runeY;
                        const mapIndex = mapX + (mapY << 7);
                        if (mapIndex >= 0 && mapIndex < this.noiseMap.length) {
                            this.noiseMap[mapIndex] = 0;
                        }
                    }
                }
            }
        }
    }

    draw(
        ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
        x: number,
        _cycle: number,
    ): void {
        const now = performance.now();
        if (this.lastTimeMs === 0) {
            this.lastTimeMs = now;
        }

        const elapsedMs = now - this.lastTimeMs;
        this.lastTimeMs = now;

        this.accumulator += elapsedMs;

        if (this.accumulator > 500) {
            this.accumulator = 500;
        }

        while (this.accumulator >= LoginScreenAnimation.MS_PER_TICK) {
            this.accumulator -= LoginScreenAnimation.MS_PER_TICK;
            this.lastCycle++;
            this.updateFire(1, this.lastCycle);
        }

        this.renderFire(ctx, x);
    }

    private updateFire(delta: number, cycle: number): void {
        this.noiseOffset += delta * 128;
        if (this.noiseOffset > this.noiseMap.length) {
            this.noiseOffset -= this.noiseMap.length;
            if (this.sprites.length > 0) {
                const runeCount = Math.min(12, this.sprites.length);
                const runeIndex = (Math.random() * runeCount) | 0;
                this.resetNoiseMap(this.sprites[runeIndex]);
            }
        }

        let bufferIndex = 0;
        const rowsToMove = delta * 128;
        const rowsToKeep = (256 - delta) * 128;

        for (let i = 0; i < rowsToKeep; i++) {
            const noiseIdx = (bufferIndex + this.noiseOffset) & (this.noiseMap.length - 1);
            let value =
                (this.fireBuffer[rowsToMove + bufferIndex] -
                    (this.noiseMap[noiseIdx] * delta) / 6) |
                0;
            if (value < 0) value = 0;
            this.fireBuffer[bufferIndex++] = value;
        }

        const edgeMargin = 10;
        const innerRight = 128 - edgeMargin;

        for (let row = 256 - delta; row < 256; row++) {
            const rowOffset = row * 128;
            for (let col = 0; col < 128; col++) {
                const randomPct = (Math.random() * 100) | 0;
                if (randomPct < 50 && col > edgeMargin && col < innerRight) {
                    this.fireBuffer[col + rowOffset] = 255;
                } else {
                    this.fireBuffer[col + rowOffset] = 0;
                }
            }
        }

        if (this.redFlashTimer > 0) {
            this.redFlashTimer -= delta * 4;
            if (this.redFlashTimer < 0) {
                this.redFlashTimer = 0;
            }
        }
        if (this.greenFlashTimer > 0) {
            this.greenFlashTimer -= delta * 4;
            if (this.greenFlashTimer < 0) {
                this.greenFlashTimer = 0;
            }
        }

        if (this.redFlashTimer === 0 && this.greenFlashTimer === 0) {
            const flashChance = (Math.random() * (2000 / delta)) | 0;
            if (flashChance === 0) {
                this.redFlashTimer = 1024;
            }
            if (flashChance === 1) {
                this.greenFlashTimer = 1024;
            }
        }

        for (let i = 0; i < 256 - delta; i++) {
            this.sineOffsets[i] = this.sineOffsets[i + delta];
        }
        for (let i = 256 - delta; i < 256; i++) {
            this.sineOffsets[i] = Math.floor(
                Math.sin(this.sinePhase / 14) * 16 +
                    Math.sin(this.sinePhase / 15) * 14 +
                    Math.sin(this.sinePhase / 16) * 12,
            );
            this.sinePhase++;
        }

        this.sparkCycle += delta;
        const blurRadius = (((cycle & 1) + delta) / 2) | 0;

        if (blurRadius > 0) {
            const sparkMargin = 2;
            const sparkWidth = 128 - sparkMargin - sparkMargin;
            for (let i = 0; i < this.sparkCycle * 100; i++) {
                const sparkX = ((Math.random() * sparkWidth) | 0) + sparkMargin;
                const sparkY = ((Math.random() * 128) | 0) + 128;
                this.fireBuffer[sparkX + (sparkY << 7)] = 192;
            }
            this.sparkCycle = 0;

            for (let y = 0; y < 256; y++) {
                let sum = 0;
                const rowOffset = y * 128;
                for (let x = -blurRadius; x < 128; x++) {
                    if (x + blurRadius < 128) {
                        sum += this.fireBuffer[x + blurRadius + rowOffset];
                    }
                    if (x - (blurRadius + 1) >= 0) {
                        sum -= this.fireBuffer[x - (blurRadius + 1) + rowOffset];
                    }
                    if (x >= 0) {
                        this.tempFireBuffer[rowOffset + x] = (sum / (blurRadius * 2 + 1)) | 0;
                    }
                }
            }

            for (let x = 0; x < 128; x++) {
                let sum = 0;
                for (let y = -blurRadius; y < 256; y++) {
                    const colOffset = y * 128;
                    if (y + blurRadius < 256) {
                        sum += this.tempFireBuffer[blurRadius * 128 + colOffset + x];
                    }
                    if (y - (blurRadius + 1) >= 0) {
                        sum -= this.tempFireBuffer[x + colOffset - (blurRadius + 1) * 128];
                    }
                    if (y >= 0) {
                        this.fireBuffer[colOffset + x] = (sum / (blurRadius * 2 + 1)) | 0;
                    }
                }
            }
        }
    }

    private updatePalette(): void {
        if (this.redFlashTimer > 0) {
            this.blendPalette(this.redFlashTimer, this.colorPaletteGreen);
        } else if (this.greenFlashTimer > 0) {
            this.blendPalette(this.greenFlashTimer, this.colorPaletteBlue);
        } else {
            for (let i = 0; i < 256; i++) {
                this.currentPalette[i] = this.colorPaletteRed[i];
            }
        }
    }

    private blendPalette(fade: number, targetPalette: Int32Array): void {
        for (let i = 0; i < this.currentPalette.length; i++) {
            if (fade > 768) {
                this.currentPalette[i] = this.blendColor(
                    this.colorPaletteRed[i],
                    targetPalette[i],
                    1024 - fade,
                );
            } else if (fade > 256) {
                this.currentPalette[i] = targetPalette[i];
            } else {
                this.currentPalette[i] = this.blendColor(
                    targetPalette[i],
                    this.colorPaletteRed[i],
                    256 - fade,
                );
            }
        }
    }

    private blendColor(colorA: number, colorB: number, amount: number): number {
        const inv = 256 - amount;
        const high = ((amount * (colorB & 0xff00) + inv * (colorA & 0xff00)) & 0xff0000) >>> 0;
        const low = ((amount * (colorB & 0xff00ff) + inv * (colorA & 0xff00ff)) & 0xff00ff00) >>> 0;
        return ((high + low) >>> 8) | 0;
    }

    /**
     * Update fire animation and return the offscreen canvas.
     */
    updateAndGetCanvas(_cycle: number): OffscreenCanvas | null {
        const now = performance.now();
        if (this.lastTimeMs === 0) {
            this.lastTimeMs = now;
        }

        const elapsedMs = now - this.lastTimeMs;
        this.lastTimeMs = now;

        this.accumulator += elapsedMs;

        if (this.accumulator > 500) {
            this.accumulator = 500;
        }

        while (this.accumulator >= LoginScreenAnimation.MS_PER_TICK) {
            this.accumulator -= LoginScreenAnimation.MS_PER_TICK;
            this.lastCycle++;
            this.updateFire(1, this.lastCycle);
        }

        return this.renderFireToCanvas();
    }

    /** Render fire to offscreen canvas. */
    private renderFireToCanvas(): OffscreenCanvas | null {
        this.updatePalette();

        const width = LoginScreenAnimation.FIRE_WIDTH;
        const height = LoginScreenAnimation.FIRE_TEXTURE_HEIGHT;

        if (typeof OffscreenCanvas === "undefined") {
            return null;
        }

        if (!this.offscreenCanvas) {
            this.offscreenCanvas = new OffscreenCanvas(width, height);
            const ctx2d = this.offscreenCanvas.getContext("2d");
            if (!ctx2d) {
                return null;
            }
            this.offscreenCtx = ctx2d;
        }

        if (!this.offscreenCtx) {
            return null;
        }

        if (
            !this.cachedImageData ||
            this.cachedImageDataWidth !== width ||
            this.cachedImageDataHeight !== height
        ) {
            this.cachedImageData = this.offscreenCtx.createImageData(width, height);
            this.cachedImageDataWidth = width;
            this.cachedImageDataHeight = height;
        }
        const imageData = this.cachedImageData;
        const data = imageData.data;
        data.fill(0);

        let bufferIndex = 0;
        for (let y = 1; y < 255; y++) {
            const sineOffset = ((256 - y) * this.sineOffsets[y]) >> 8;
            const startX = Math.max(0, -sineOffset);
            const endX = Math.min(
                LoginScreenAnimation.FIRE_WIDTH,
                LoginScreenAnimation.FIRE_WIDTH - sineOffset,
            );

            bufferIndex += startX;

            for (let col = startX; col < endX; col++) {
                const fireValue = this.fireBuffer[bufferIndex++];
                if (fireValue > 0) {
                    const color = this.currentPalette[Math.min(255, fireValue)];
                    const imgIdx =
                        ((y + LoginScreenAnimation.FIRE_Y_OFFSET) * width + col + sineOffset) * 4;
                    if (imgIdx >= 0 && imgIdx < data.length - 3) {
                        const r = (color >> 16) & 0xff;
                        const g = (color >> 8) & 0xff;
                        const b = color & 0xff;

                        data[imgIdx] = r;
                        data[imgIdx + 1] = g;
                        data[imgIdx + 2] = b;
                        data[imgIdx + 3] = Math.min(255, fireValue);
                    }
                }
            }

            bufferIndex += LoginScreenAnimation.FIRE_WIDTH - endX;
        }

        this.offscreenCtx.putImageData(imageData, 0, 0);
        return this.offscreenCanvas;
    }

    private renderFire(
        ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
        x: number,
    ): void {
        const canvas = this.renderFireToCanvas();
        if (canvas) {
            ctx.drawImage(canvas, x, 0);
        }
    }

    /**
     * Reset animation state.
     */
    reset(): void {
        this.sinePhase = 0;
        this.redFlashTimer = 0;
        this.greenFlashTimer = 0;
        this.lastCycle = 0;
        this.noiseOffset = 0;
        this.sparkCycle = 0;
        this.lastTimeMs = 0;
        this.accumulator = 0;

        this.fireBuffer.fill(0);
        this.tempFireBuffer.fill(0);

        this.sineOffsets.fill(0);

        this.resetNoiseMap(null);
    }

    destroy(): void {
        this.colorPaletteRed = new Int32Array(0);
        this.colorPaletteGreen = new Int32Array(0);
        this.colorPaletteBlue = new Int32Array(0);
        this.currentPalette = new Int32Array(0);
        this.noiseMap = new Int32Array(0);
        this.tempNoiseMap = new Int32Array(0);
        this.fireBuffer = new Int32Array(0);
        this.tempFireBuffer = new Int32Array(0);
        this.offscreenCanvas = null;
        this.offscreenCtx = null;
    }
}
