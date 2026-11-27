import { colourIdToHex } from "../../../common/chat/chatFormatting";
import { getCustomModIconCanvas, getCustomModIconsRevision } from "../../../common/gamemode/GamemodeContentStore";
import type { CacheIndex } from "../../../rs/cache/CacheIndex";
import { IndexType } from "../../../rs/cache/IndexType";
import { BitmapFont } from "../../../rs/font/BitmapFont";
import { IndexedSprite } from "../../../rs/sprite/IndexedSprite";
import { SpriteLoader } from "../../../rs/sprite/SpriteLoader";
import { HSL_RGB_MAP } from "../../../rs/util/ColorUtil";
import { FONT_BOLD_12, FONT_PLAIN_11 } from "../../../ui/fonts";
import type { OverheadTextEntry } from "../../../ui/devoverlay/Overlay";
import type { OverlayHost } from "./OverlayHost";
import type { QuadClip, ScreenLayer, ScreenTexture } from "./ScreenLayer";
import { createTextCanvas, indexedSpriteToCanvas } from "./textTextures";

const DEFAULT_OVERHEAD_FONT_ID = FONT_BOLD_12;
const ICON_SPACING = 2;
const H_PADDING = 2;
const V_PADDING = 2;

type CachedTexture = {
    texture: ScreenTexture;
    w: number;
    h: number;
    disposable?: boolean;
};

type IconCanvas = { canvas: HTMLCanvasElement; w: number; h: number };

function mapPaletteToLength(palette: Int32Array, length: number): Int32Array | undefined {
    if (length <= 0) return undefined;
    if (palette.length === 0) return undefined;
    if (palette.length === length) return palette;
    const out = new Int32Array(length);
    const ratio = palette.length / length;
    for (let i = 0; i < length; i++) {
        const idx = Math.min(palette.length - 1, Math.floor(i * ratio));
        out[i] = palette[idx] & 0xffffff;
    }
    return out;
}

/**
 * Port of client/ui/devoverlay/OverheadTextOverlay.ts (text texture construction, per-actor
 * stacking, overlap settling and effects 1/2/3/4/5) to the WebGPU screen layer.
 */
export class OverheadTextLayer {
    private readonly host: OverlayHost;
    private readonly screen: ScreenLayer;

    fontId: number = DEFAULT_OVERHEAD_FONT_ID;
    scale = 1.0;

    private font?: BitmapFont;
    private spriteIndex?: CacheIndex;
    private modIconArchiveId = -1;

    private textCache = new Map<string, CachedTexture>();
    private iconCache = new Map<number, IconCanvas>();
    private segmentsCache = new Map<
        string,
        Array<{ type: "icon"; iconIndex: number } | { type: "text"; text: string }>
    >();
    private frameDisposables: ScreenTexture[] = [];

    private layoutScratch: Array<{
        entry: OverheadTextEntry;
        tex: CachedTexture;
        alpha: number;
        centerX: number;
        baseline: number;
        halfWidth: number;
        ascent: number;
    }> = [];

    constructor(host: OverlayHost, screen: ScreenLayer) {
        this.host = host;
        this.screen = screen;
    }

    init(): void {
        this.ensureFont();
        this.ensureSpriteIndex();
    }

    draw(sceneClip?: readonly number[]): void {
        for (const texture of this.frameDisposables) this.screen.releaseTexture(texture);
        this.frameDisposables.length = 0;

        const args = this.host.buildUpdateArgs();
        const entries = args.state.overheadTexts;
        if (!entries || entries.length === 0) return;
        const helpers = args.helpers;

        const canvasHeight = this.host.canvas.height;
        const baseClip: QuadClip = sceneClip
            ? { x: sceneClip[0], y: sceneClip[1], width: sceneClip[2], height: sceneClip[3] }
            : { x: 0, y: 0, width: this.host.canvas.width, height: canvasHeight };

        const stacks = args.state.actor2dStacks;
        this.ensureFont();
        const fontAscent = this.font ? this.font.maxAscent || this.font.ascent || 12 : 12;

        // Textures are drawn at `scale` (device pixel ratio), so every pixel offset that
        // relates to the texture has to use the same scale.
        const scale = Number.isFinite(this.scale) && this.scale > 0 ? this.scale : 1.0;

        const layouts = this.layoutScratch;
        layouts.length = 0;
        for (const entry of entries) {
            const plane = entry.plane | 0;
            const height = helpers.getMinTileHeightInRadius(
                entry.worldX,
                entry.worldZ,
                plane,
                entry.footprintRadius ?? 0,
            );
            const tex = this.getTextTexture(entry, args.time);
            if (!tex) continue;

            const alpha = Math.max(0, Math.min(1, entry.life));
            if (alpha <= 0) continue;

            const screenPos = helpers.worldToScreen?.(
                entry.worldX,
                height - entry.heightOffsetTiles,
                entry.worldZ,
            ) as number[] | Float32Array | undefined;
            if (!screenPos || typeof screenPos[0] !== "number" || typeof screenPos[1] !== "number") {
                continue;
            }

            const groupKey = typeof entry.groupKey === "number" ? entry.groupKey | 0 : undefined;
            const var18 = (groupKey !== undefined ? stacks?.get(groupKey) : undefined) ?? -2;
            const centerX = Math.round(screenPos[0]);
            const baseline = Math.round(screenPos[1]) - var18;
            if (groupKey !== undefined) {
                stacks?.set(groupKey, var18 + Math.round(12 * scale));
            }
            layouts.push({
                entry,
                tex,
                alpha,
                centerX,
                baseline,
                halfWidth: Math.floor((Math.max(0, tex.w - H_PADDING * 2) * scale) / 2),
                ascent: Math.round(fontAscent * scale),
            });
        }

        for (let i = 0; i < layouts.length; i++) {
            const current = layouts[i];
            let y = current.baseline;
            let moved = true;
            while (moved) {
                moved = false;
                for (let j = 0; j < i; j++) {
                    const other = layouts[j];
                    if (
                        y + 2 > other.baseline - other.ascent &&
                        y - current.ascent < other.baseline + 2 &&
                        current.centerX - current.halfWidth < other.centerX + other.halfWidth &&
                        current.centerX + current.halfWidth > other.centerX - other.halfWidth &&
                        other.baseline - other.ascent < y
                    ) {
                        y = other.baseline - other.ascent;
                        moved = true;
                    }
                }
            }
            current.baseline = y;
        }

        for (const layout of layouts) {
            const entry = layout.entry;
            const tex = layout.tex;
            const alpha = layout.alpha;
            const centerX = layout.centerX;
            const width = Math.max(1, Math.round(tex.w * scale));
            const heightPx = Math.max(1, Math.round(tex.h * scale));
            const cyclesRemaining = this.toCyclesRemaining150(entry);
            const progress = 150 - cyclesRemaining;
            const offsetY = Math.round(this.computeEffectOffset(entry.effect, progress) * scale);

            let left = centerX - Math.round(width / 2);
            const top = layout.baseline - Math.round(V_PADDING * scale) - layout.ascent + offsetY;
            let quadClip: QuadClip | undefined;

            if ((entry.effect | 0) === 4) {
                const textWidth = Math.max(0, tex.w - H_PADDING * 2) * scale;
                const scrollHalf = 50 * scale;
                const scroll = (progress * (textWidth + scrollHalf * 2)) / 150;
                const drawX = centerX + scrollHalf - scroll;
                left = Math.round(drawX - H_PADDING * scale);
                quadClip = {
                    x: Math.round(centerX - scrollHalf),
                    y: top,
                    width: Math.round(scrollHalf * 2),
                    height: heightPx,
                };
            } else if ((entry.effect | 0) === 5) {
                quadClip = { x: Math.round(left), y: top, width, height: heightPx };
            }

            this.screen.queueTexture(
                tex.texture,
                left,
                top,
                width,
                heightPx,
                0,
                0,
                1,
                1,
                1,
                1,
                1,
                alpha,
                quadClip,
            );

            if (tex.disposable) {
                this.frameDisposables.push(tex.texture);
            }
        }

        // Keep the scene clip for later flush; a no-op default forces scissor use.
        void baseClip;
    }

    dispose(): void {
        for (const cached of this.textCache.values()) this.screen.releaseTexture(cached.texture);
        this.textCache.clear();
        this.iconCache.clear();
        this.segmentsCache.clear();
        for (const texture of this.frameDisposables) this.screen.releaseTexture(texture);
        this.frameDisposables.length = 0;
        this.font = undefined;
        this.spriteIndex = undefined;
    }

    private getTextTexture(
        entry: OverheadTextEntry,
        time: number,
    ): CachedTexture | undefined {
        this.ensureFont();
        const segments = this.parseSegments(entry.text, entry.modIcon);
        const style = this.resolveOverheadStyle(entry, time, segments);
        const key = style.dynamic ? undefined : this.buildCacheKey(style.colour, segments);
        if (key) {
            const cached = this.textCache.get(key);
            if (cached) return cached;
        }
        const font = this.font;
        if (!font) return undefined;

        const measure = this.measureSegments(font, segments);
        if (measure.width <= 0 || measure.height <= 0) return undefined;

        const created = createTextCanvas(measure.width, measure.height);
        if (!created) return undefined;
        const { canvas, ctx } = created;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const baseline = V_PADDING + (font.maxAscent || font.ascent || 12);
        let penX = H_PADDING;
        const baseColorHex = `#${(style.colour >>> 0).toString(16).padStart(6, "0")}`;

        let charIndex = 0;
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            if (seg.type === "icon") {
                const icon = this.getIconCanvas(seg.iconIndex);
                if (icon) {
                    ctx.drawImage(icon.canvas, penX, baseline - icon.h);
                    penX += icon.w;
                    if (i < segments.length - 1) penX += ICON_SPACING;
                }
                continue;
            }
            const text = seg.text;
            if (!text) continue;

            const hasPerChar =
                style.perCharColours !== undefined ||
                style.xOffsets !== undefined ||
                style.yOffsets !== undefined;

            if (!hasPerChar) {
                font.draw(ctx, text, penX, baseline, baseColorHex);
                penX += font.measure(text);
                charIndex += text.length;
                continue;
            }

            for (let j = 0; j < text.length; j++) {
                const ch = text[j];
                const xOff = style.xOffsets ? (style.xOffsets[charIndex] ?? 0) : 0;
                const yOff = style.yOffsets ? (style.yOffsets[charIndex] ?? 0) : 0;
                const colour =
                    style.perCharColours !== undefined
                        ? (style.perCharColours[charIndex] ?? style.colour)
                        : style.colour;
                const hex = `#${(colour >>> 0).toString(16).padStart(6, "0")}`;
                font.draw(ctx, ch, penX + xOff, baseline + yOff, hex);
                penX += font.measure(ch);
                charIndex++;
            }
        }

        const texture = this.screen.getCanvasTexture(canvas);
        if (!texture) return undefined;
        const cachedTexture: CachedTexture = {
            texture,
            w: canvas.width,
            h: canvas.height,
            disposable: style.dynamic,
        };
        if (key) {
            this.textCache.set(key, cachedTexture);
        }
        return cachedTexture;
    }

    private computeEffectOffset(effect: number, progress: number): number {
        if ((effect | 0) !== 5) return 0;
        const p = progress | 0;
        if (p < 25) return p - 25;
        if (p > 125) return p - 125;
        return 0;
    }

    private parseSegments(
        text: string,
        modIcon?: number,
    ): Array<{ type: "icon"; iconIndex: number } | { type: "text"; text: string }> {
        const cacheKey = `${modIcon ?? -1}|${text}`;
        const cached = this.segmentsCache.get(cacheKey);
        if (cached) return cached;

        const segments: Array<
            { type: "icon"; iconIndex: number } | { type: "text"; text: string }
        > = [];
        if (typeof modIcon === "number" && modIcon >= 0) {
            segments.push({ type: "icon", iconIndex: modIcon | 0 });
        }
        const regex = /<img=(\d+)>/gi;
        let lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
            if (match.index > lastIndex) {
                const slice = text.substring(lastIndex, match.index);
                const cleaned = this.stripFormatting(slice);
                if (cleaned.length > 0) segments.push({ type: "text", text: cleaned });
            }
            const iconIdx = parseInt(match[1], 10);
            segments.push({ type: "icon", iconIndex: iconIdx });
            lastIndex = regex.lastIndex;
        }
        if (lastIndex < text.length || segments.length === 0) {
            const tail = this.stripFormatting(text.substring(lastIndex));
            if (tail.length > 0 || segments.length === 0)
                segments.push({ type: "text", text: tail });
        }
        let writeIdx = 0;
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            if (seg.type === "icon" ? seg.iconIndex >= 0 : seg.text.length > 0) {
                segments[writeIdx++] = seg;
            }
        }
        segments.length = writeIdx;

        if (this.segmentsCache.size > 500) {
            const keys = Array.from(this.segmentsCache.keys());
            for (let i = 0; i < 100; i++) {
                this.segmentsCache.delete(keys[i]);
            }
        }
        this.segmentsCache.set(cacheKey, segments);
        return segments;
    }

    private stripFormatting(value: string): string {
        if (!value) return "";
        let out = value;
        out = out.replace(/<col=#[0-9a-fA-F]{6}>/gi, "");
        out = out.replace(/<col=[0-9a-fA-F]{1,6}>/gi, "");
        out = out.replace(/<\/col>/gi, "");
        out = out.replace(/<color=#[0-9a-fA-F]{6}>/gi, "");
        out = out.replace(/<color=[0-9a-fA-F]{1,6}>/gi, "");
        out = out.replace(/<\/color>/gi, "");
        out = out.replace(/<shad=#[0-9a-fA-F]{6}>/gi, "");
        out = out.replace(/<shad=[0-9a-fA-F]{1,6}>/gi, "");
        out = out.replace(/<\/shad>/gi, "");
        out = out.replace(/<img=\d+>/gi, "");
        out = out.replace(/<u>/gi, "").replace(/<\/u>/gi, "");
        out = out.replace(/<str>/gi, "").replace(/<\/str>/gi, "");
        out = out.replace(/\u00a0/g, " ");
        return out;
    }

    private buildCacheKey(
        color: number,
        segments: Array<{ type: "icon"; iconIndex: number } | { type: "text"; text: string }>,
    ): string {
        let key = `${color >>> 0}|m${getCustomModIconsRevision()}`;
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            if (seg.type === "icon") key += `|icon:${seg.iconIndex}`;
            else key += `|text:${seg.text}`;
        }
        return key;
    }

    private resolveOverheadStyle(
        entry: OverheadTextEntry,
        time: number,
        segments: Array<{ type: "icon"; iconIndex: number } | { type: "text"; text: string }>,
    ): {
        colour: number;
        dynamic: boolean;
        perCharColours?: Int32Array;
        xOffsets?: Int32Array;
        yOffsets?: Int32Array;
    } {
        const viewportDrawCount = Math.floor(time / 20) | 0;
        const progress = 150 - this.toCyclesRemaining150(entry);

        let rawText = "";
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            if (seg.type === "text") rawText += seg.text;
        }
        const len = rawText.length | 0;

        const id = typeof entry.colorId === "number" ? entry.colorId | 0 : -1;
        const effect = entry.effect | 0;

        let colour = ((entry.color >>> 0) & 0xffffff) | 0;
        let dynamicColour = false;
        if (id >= 0) {
            if (id <= 5) {
                colour = colourIdToHex(id) & 0xffffff;
            } else {
                const toggle = viewportDrawCount % 20 < 10;
                if (id === 6) {
                    colour = toggle ? 0xff0000 : 0xffff00;
                    dynamicColour = true;
                } else if (id === 7) {
                    colour = toggle ? 0x0000ff : 0x00ffff;
                    dynamicColour = true;
                } else if (id === 8) {
                    colour = toggle ? 0x00b000 : 0x80ff80;
                    dynamicColour = true;
                } else if (id === 9 || id === 10 || id === 11) {
                    colour = this.computeGlowColour(id, entry) & 0xffffff;
                    dynamicColour = true;
                } else {
                    colour = colourIdToHex(0) & 0xffffff;
                }
            }
        } else if ((colour | 0) === 0) {
            colour = colourIdToHex(0) & 0xffffff;
        }

        let perCharColours: Int32Array | undefined = undefined;
        if (len > 0 && id === 12) {
            const out = new Int32Array(len);
            for (let i = 0; i < len; i++) {
                const var19 = Math.floor((i / len) * 64.0) | 0;
                const var20 = ((var19 << 10) | 896 | 64) & 0xffff;
                out[i] = HSL_RGB_MAP[var20] & 0xffffff;
            }
            perCharColours = out;
        } else if (len > 0 && id >= 13 && id <= 20) {
            const palette = entry.pattern;
            if (palette && palette.length > 0) {
                perCharColours = mapPaletteToLength(palette, len);
            }
        }

        let xOffsets: Int32Array | undefined = undefined;
        let yOffsets: Int32Array | undefined = undefined;
        let dynamicOffsets = false;
        if (len > 0) {
            if (effect === 1) {
                yOffsets = new Int32Array(len);
                for (let i = 0; i < len; i++) {
                    yOffsets[i] = (Math.sin(i / 2.0 + viewportDrawCount / 5.0) * 5.0) | 0;
                }
                dynamicOffsets = true;
            } else if (effect === 2) {
                xOffsets = new Int32Array(len);
                yOffsets = new Int32Array(len);
                for (let i = 0; i < len; i++) {
                    xOffsets[i] = (Math.sin(i / 5.0 + viewportDrawCount / 5.0) * 5.0) | 0;
                    yOffsets[i] = (Math.sin(i / 3.0 + viewportDrawCount / 5.0) * 5.0) | 0;
                }
                dynamicOffsets = true;
            } else if (effect === 3) {
                let amplitude = 7.0 - progress / 8.0;
                if (amplitude < 0.0) amplitude = 0.0;
                yOffsets = new Int32Array(len);
                for (let i = 0; i < len; i++) {
                    yOffsets[i] = (Math.sin(i / 1.5 + viewportDrawCount / 1.0) * amplitude) | 0;
                }
                dynamicOffsets = true;
            }
        }

        const dynamic = dynamicColour || dynamicOffsets || perCharColours !== undefined;
        return { colour, dynamic, perCharColours, xOffsets, yOffsets };
    }

    private toCyclesRemaining150(entry: OverheadTextEntry): number {
        const duration = entry.duration > 0 ? entry.duration : 150;
        const remainingClamped = Math.max(0, Math.min(entry.remaining ?? duration, duration));
        const scaledRemaining =
            duration > 0 ? Math.round((remainingClamped / duration) * 150) : 150;
        return Math.max(0, Math.min(150, scaledRemaining));
    }

    private computeGlowColour(id: number, entry: OverheadTextEntry): number {
        const progress = Math.max(0, Math.min(149, 150 - this.toCyclesRemaining150(entry)));

        switch (id) {
            case 9:
                if (progress < 50) return (0xff0000 + progress * 0x500) & 0xffffff;
                if (progress < 100) return (0xffff00 - (progress - 50) * 0x50000) & 0xffffff;
                return (0x00ff00 + (progress - 100) * 0x5) & 0xffffff;
            case 10:
                if (progress < 50) return (0xff0000 + progress * 0x5) & 0xffffff;
                if (progress < 100) return (0xff00ff - (progress - 50) * 0x50000) & 0xffffff;
                return (0x0000ff + (progress - 100) * 0x50000 - (progress - 100) * 0x5) & 0xffffff;
            case 11:
            default:
                if (progress < 50) return (0xffffff - progress * 0x50005) & 0xffffff;
                if (progress < 100) return (0x00ff00 + (progress - 50) * 0x50005) & 0xffffff;
                return (0xffffff - (progress - 100) * 0x50000) & 0xffffff;
        }
    }

    private measureSegments(
        font: BitmapFont,
        segments: Array<{ type: "icon"; iconIndex: number } | { type: "text"; text: string }>,
    ): { width: number; height: number } {
        let width = H_PADDING * 2;
        let maxIconHeight = 0;
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            if (seg.type === "icon") {
                const icon = this.getIconCanvas(seg.iconIndex);
                if (icon) {
                    width += icon.w;
                    maxIconHeight = Math.max(maxIconHeight, icon.h);
                    if (i < segments.length - 1) width += ICON_SPACING;
                }
                continue;
            }
            width += font.measure(seg.text);
        }
        const ascent = font.maxAscent || font.ascent || 12;
        const descent = font.maxDescent || 2;
        const lineHeight = ascent + descent;
        const height = V_PADDING * 2 + Math.max(lineHeight, maxIconHeight);
        return { width: Math.max(1, Math.ceil(width)), height: Math.max(1, Math.ceil(height)) };
    }

    private getIconCanvas(iconIndex: number): IconCanvas | undefined {
        if (iconIndex < 0) return undefined;
        const customCanvas = getCustomModIconCanvas(iconIndex);
        if (customCanvas) {
            return { canvas: customCanvas, w: customCanvas.width, h: customCanvas.height };
        }
        const cached = this.iconCache.get(iconIndex);
        if (cached) return cached;
        this.ensureSpriteIndex();
        if (!this.spriteIndex || this.modIconArchiveId < 0) return undefined;
        try {
            const sprites = SpriteLoader.loadIntoIndexedSprites(
                this.spriteIndex,
                this.modIconArchiveId,
            );
            const sprite = sprites?.[iconIndex];
            if (!sprite) return undefined;
            const canvas = indexedSpriteToCanvas(sprite as IndexedSprite);
            const icon = { canvas, w: canvas.width, h: canvas.height };
            this.iconCache.set(iconIndex, icon);
            return icon;
        } catch {
            return undefined;
        }
    }

    private ensureFont(): void {
        if (this.font) return;
        try {
            const cache = this.host.osrsClient.cacheSystem;
            if (!cache) return;
            const ids = [this.fontId, FONT_BOLD_12, FONT_PLAIN_11];
            for (const id of ids) {
                const font = BitmapFont.tryLoad(cache, id);
                if (font) {
                    this.font = font;
                    this.fontId = id;
                    break;
                }
            }
        } catch {}
    }

    private ensureSpriteIndex(): void {
        if (this.spriteIndex && this.modIconArchiveId >= 0) return;
        try {
            this.spriteIndex = this.host.osrsClient.cacheSystem.getIndex(IndexType.DAT2.sprites);
        } catch {
            this.spriteIndex = undefined;
        }
        if (this.spriteIndex && this.modIconArchiveId < 0) {
            try {
                this.modIconArchiveId = this.spriteIndex.getArchiveId("mod_icons");
            } catch {
                this.modIconArchiveId = -1;
            }
        }
    }
}
