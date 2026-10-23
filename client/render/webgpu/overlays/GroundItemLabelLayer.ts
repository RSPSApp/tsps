import { BitmapFont } from "../../../rs/font/BitmapFont";
import { FONT_PLAIN_11 } from "../../../ui/fonts";
import type { OverlayHost } from "./OverlayHost";
import type { ScreenLayer, ScreenTexture } from "./ScreenLayer";
import { createTextCanvas } from "./textTextures";

const H_PADDING = 2;
const V_PADDING = 2;
const TEXTURE_CACHE_MAX = 512;

type CachedText = { texture: ScreenTexture; w: number; h: number };

/**
 * Port of client/ui/devoverlay/GroundItemOverlay.ts using the screen layer. Labels are drawn
 * for the entries produced by the ground items plugin (same cap/fallback
 * selection as the WebGL path).
 */
export class GroundItemLabelLayer {
    private readonly host: OverlayHost;
    private readonly screen: ScreenLayer;

    private font?: BitmapFont;
    private textCache = new Map<string, CachedText>();

    fontId: number = FONT_PLAIN_11;
    scale = 1.0;

    constructor(host: OverlayHost, screen: ScreenLayer) {
        this.host = host;
        this.screen = screen;
    }

    init(): void {
        this.ensureFont();
    }

    draw(): void {
        const args = this.host.buildUpdateArgs();
        const entries = this.host.groundOverlayEntries;
        if (entries.length === 0) return;
        const helpers = args.helpers;
        const scale = this.scale || 1.0;

        for (const entry of entries) {
            const baseLabel = typeof entry.label === "string" ? entry.label : "";
            const timerLabel = typeof entry.timerLabel === "string" ? entry.timerLabel : "";
            if (baseLabel.length === 0 && timerLabel.length === 0) continue;

            const h = helpers.getTileHeightAtPlane(
                entry.tileX + 0.5,
                entry.tileY + 0.5,
                entry.level,
            );
            const line = Math.max(0, entry.line ?? 0);
            const heightOffset = Math.max(0, entry.heightOffsetTiles ?? 0);
            const screenPos = helpers.worldToScreen?.(
                entry.tileX + 0.5,
                h - heightOffset - 0.05 - line * 0.22,
                entry.tileY + 0.5,
            );
            if (!screenPos || typeof screenPos[0] !== "number" || typeof screenPos[1] !== "number") {
                continue;
            }

            const tex = this.getTextTexture(
                baseLabel,
                timerLabel,
                entry.color ?? 0xffffff,
                Number.isFinite(entry.timerColor) ? (entry.timerColor as number) : 0xffff00,
            );
            if (!tex) continue;

            const centerX = Math.round(screenPos[0]);
            const centerY = Math.round(screenPos[1]);
            const width = Math.max(1, Math.round(tex.w * scale));
            const heightPx = Math.max(1, Math.round(tex.h * scale));
            this.screen.queueTexture(
                tex.texture,
                centerX - Math.round(width / 2),
                centerY - Math.round(heightPx / 2),
                width,
                heightPx,
            );
        }
    }

    dispose(): void {
        for (const cached of this.textCache.values()) this.screen.releaseTexture(cached.texture);
        this.textCache.clear();
        this.font = undefined;
    }

    private ensureFont(): void {
        try {
            if (this.font) return;
            const cache = this.host.osrsClient.cacheSystem;
            if (!cache) return;
            let font = BitmapFont.tryLoad(cache, this.fontId);
            if (!font && this.fontId !== FONT_PLAIN_11) {
                font = BitmapFont.tryLoad(cache, FONT_PLAIN_11);
            }
            if (font) this.font = font;
        } catch {}
    }

    private getTextTexture(
        baseLabel: string,
        timerLabel: string,
        baseColor: number,
        timerColor: number,
    ): CachedText | undefined {
        this.ensureFont();
        const font = this.font;
        if (!font) return undefined;

        const key = `${baseColor >>> 0}|${timerColor >>> 0}|${baseLabel}|${timerLabel}`;
        const cached = this.textCache.get(key);
        if (cached) return cached;

        const baseWidth = baseLabel.length > 0 ? font.measure(baseLabel) : 0;
        const timerWidth = timerLabel.length > 0 ? font.measure(timerLabel) : 0;
        const width = Math.max(1, Math.ceil(H_PADDING * 2 + baseWidth + timerWidth));
        const ascent = font.maxAscent || font.ascent || 11;
        const descent = font.maxDescent || 2;
        const height = Math.max(1, Math.ceil(V_PADDING * 2 + ascent + descent));

        const created = createTextCanvas(width, height);
        if (!created) return undefined;
        const { canvas, ctx } = created;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const baseline = V_PADDING + ascent;
        let penX = H_PADDING;
        if (baseLabel.length > 0) {
            font.draw(
                ctx,
                baseLabel,
                penX,
                baseline,
                `#${(baseColor >>> 0).toString(16).padStart(6, "0")}`,
            );
            penX += baseWidth;
        }
        if (timerLabel.length > 0) {
            font.draw(
                ctx,
                timerLabel,
                penX,
                baseline,
                `#${(timerColor >>> 0).toString(16).padStart(6, "0")}`,
            );
        }

        const texture = this.screen.getCanvasTexture(canvas);
        if (!texture) return undefined;
        const next: CachedText = { texture, w: canvas.width, h: canvas.height };
        if (this.textCache.size >= TEXTURE_CACHE_MAX) {
            const firstKey = this.textCache.keys().next().value;
            if (firstKey !== undefined) {
                const first = this.textCache.get(firstKey);
                if (first) this.screen.releaseTexture(first.texture);
                this.textCache.delete(firstKey);
            }
        }
        this.textCache.set(key, next);
        return next;
    }
}
