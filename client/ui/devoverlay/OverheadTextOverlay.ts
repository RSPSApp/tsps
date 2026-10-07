import {
    DrawCall,
    App as PicoApp,
    PicoGL,
    Program,
    Texture,
    VertexArray,
    VertexBuffer,
} from "picogl";

import { colourIdToHex } from "../../common/chat/chatFormatting";
import { CacheIndex } from "../../rs/cache/CacheIndex";
import type { CacheSystem } from "../../rs/cache/CacheSystem";
import { IndexType } from "../../rs/cache/IndexType";
import { BitmapFont } from "../../rs/font/BitmapFont";
import { IndexedSprite } from "../../rs/sprite/IndexedSprite";
import { SpriteLoader } from "../../rs/sprite/SpriteLoader";
import { HSL_RGB_MAP } from "../../rs/util/ColorUtil";
import { FONT_BOLD_12, FONT_PLAIN_11 } from "../fonts";
import {
    OverheadTextEntry,
    Overlay,
    OverlayInitArgs,
    OverlayUpdateArgs,
    RenderPhase,
} from "./Overlay";

interface OverheadTextContext {
    getCacheSystem: () => CacheSystem;
}

const DEFAULT_OVERHEAD_FONT_ID = FONT_BOLD_12;
const SCREEN_VERT_SRC = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_position;
layout(location=1) in vec2 a_texCoord;
uniform vec2 u_resolution;
out vec2 v_uv;
void main(){
    vec2 zeroToOne = a_position / u_resolution;
    vec2 zeroToTwo = zeroToOne * 2.0;
    vec2 clip = zeroToTwo - 1.0;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    v_uv = a_texCoord;
}`;
const SCREEN_FRAG_SRC = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_sprite;
uniform vec4 u_tint;
out vec4 fragColor;
void main(){
    vec4 texel = texture(u_sprite, v_uv);
    fragColor = vec4(texel.rgb * u_tint.rgb, texel.a * u_tint.a);
}`;

type CachedTexture = {
    tex: Texture;
    w: number;
    h: number;
    disposable?: boolean;
};

type IconCanvas = {
    canvas: HTMLCanvasElement;
    w: number;
    h: number;
};

const ICON_SPACING = 2;
const H_PADDING = 2;
const V_PADDING = 2;

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

function spriteToCanvas(sprite: IndexedSprite): HTMLCanvasElement {
    const width = sprite.width || sprite.subWidth;
    const height = sprite.height || sprite.subHeight;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    const ctx = canvas.getContext("2d", {
        willReadFrequently: true as any,
    }) as CanvasRenderingContext2D;
    const img = ctx.createImageData(canvas.width, canvas.height);
    const palette = sprite.palette;
    const pixels = sprite.pixels;
    const subWidth = sprite.subWidth;
    const subHeight = sprite.subHeight;
    const ox = sprite.xOffset | 0;
    const oy = sprite.yOffset | 0;
    for (let y = 0; y < subHeight; y++) {
        for (let x = 0; x < subWidth; x++) {
            const srcIdx = x + y * subWidth;
            const palIndex = pixels[srcIdx] & 0xff;
            if (palIndex === 0) continue;
            const dx = x + ox;
            const dy = y + oy;
            if (dx < 0 || dy < 0 || dx >= canvas.width || dy >= canvas.height) continue;
            const di = (dx + dy * canvas.width) * 4;
            const rgb = palette[palIndex];
            img.data[di] = (rgb >> 16) & 0xff;
            img.data[di + 1] = (rgb >> 8) & 0xff;
            img.data[di + 2] = rgb & 0xff;
            img.data[di + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
}

export class OverheadTextOverlay implements Overlay {
    constructor(
        _program: Program,
        private ctx: OverheadTextContext,
    ) {}

    fontId: number = DEFAULT_OVERHEAD_FONT_ID;
    scale: number = 1.0;

    private app!: PicoApp;
    private positions?: VertexBuffer;
    private uvs?: VertexBuffer;
    private array?: VertexArray;
    private drawCall?: DrawCall;

    private screenSize = new Float32Array(2);
    private tint = new Float32Array([1, 1, 1, 1]);
    private quadVerts = new Float32Array(12);
    private quadUvs = new Float32Array([0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0]);

    private font?: BitmapFont;
    private spriteIndex?: CacheIndex;
    private modIconArchiveId: number = -1;
    private screenProgram?: Program;

    private textCache: Map<string, CachedTexture> = new Map();
    private iconCache: Map<number, IconCanvas> = new Map();
    // PERF: Cache parsed segments to avoid re-parsing same text every frame
    private segmentsCache: Map<
        string,
        Array<{ type: "icon"; iconIndex: number } | { type: "text"; text: string }>
    > = new Map();

    private lastArgs?: OverlayUpdateArgs;
    // Reused layout scratch for the per-frame text de-overlap pass.
    private layoutScratch: Array<{
        entry: OverheadTextEntry;
        tex: CachedTexture;
        alpha: number;
        centerX: number;
        baseline: number;
        halfWidth: number;
        ascent: number;
    }> = [];

    init(args: OverlayInitArgs): void {
        this.app = args.app;
        this.positions = this.app.createVertexBuffer(PicoGL.FLOAT, 2, new Float32Array(12));
        this.uvs = this.app.createVertexBuffer(PicoGL.FLOAT, 2, new Float32Array(this.quadUvs));
        this.uvs.data(this.quadUvs);
        this.array = this.app
            .createVertexArray()
            .vertexAttributeBuffer(0, this.positions)
            .vertexAttributeBuffer(1, this.uvs);

        this.screenProgram = this.app.createProgram(SCREEN_VERT_SRC, SCREEN_FRAG_SRC);
        this.drawCall = this.app
            .createDrawCall(this.screenProgram, this.array)
            .uniform("u_resolution", this.screenSize)
            .uniform("u_tint", this.tint)
            .primitive(PicoGL.TRIANGLES);

        this.ensureFont();
        this.ensureSpriteIndex();
    }

    update(args: OverlayUpdateArgs): void {
        this.lastArgs = args;
    }

    draw(phase: RenderPhase, sceneClip?: readonly number[]): void {
        if (phase !== RenderPhase.ToFrameTexture) return;
        if (!this.drawCall || !this.positions || !this.uvs) return;
        const args = this.lastArgs;
        const entries = args?.state.overheadTexts;
        if (!args || !entries || entries.length === 0) return;
        const helpers = args.helpers;

        this.screenSize[0] = this.app.width;
        this.screenSize[1] = this.app.height;
        this.app.enable(PicoGL.BLEND);
        this.app.disable(PicoGL.DEPTH_TEST);
        // Text effects narrow the scene clip, never replace it.
        const clip = sceneClip ?? [0, 0, this.app.width, this.app.height];
        this.app.enable(PicoGL.SCISSOR_TEST);
        this.app.scissor(clip[0], clip[1], clip[2], clip[3]);

        const stacks = args.state.actor2dStacks;
        this.ensureFont();
        const fontAscent = this.font ? this.font.maxAscent || this.font.ascent || 12 : 12;

        // First pass: project anchors, claim the per-actor element offset, and
        // collect layout metrics for the overlap pass.
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
            const tex = this.getTextTexture(entry, args);
            if (!tex) continue;

            const alpha = Math.max(0, Math.min(1, entry.life));
            if (alpha <= 0) continue;

            const screenPos = args.helpers.worldToScreen?.(
                entry.worldX,
                height - entry.heightOffsetTiles,
                entry.worldZ,
            ) as number[] | Float32Array | undefined;
            if (!screenPos || typeof screenPos[0] !== "number" || typeof screenPos[1] !== "number")
                continue;

            const groupKey = typeof entry.groupKey === "number" ? entry.groupKey | 0 : undefined;
            const var18 = (groupKey !== undefined ? stacks?.get(groupKey) : undefined) ?? -2;
            const centerX = Math.round(screenPos[0]);
            const baseline = Math.round(screenPos[1]) - var18;
            if (groupKey !== undefined) {
                stacks?.set(groupKey, var18 + 12);
            }
            layouts.push({
                entry,
                tex,
                alpha,
                centerX,
                baseline,
                halfWidth: Math.floor(Math.max(0, tex.w - H_PADDING * 2) / 2),
                ascent: fontAscent,
            });
        }

        // Push overlapping texts above earlier ones, comparing against already
        // settled positions.
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
            const width = Math.max(1, Math.round(tex.w * this.scale));
            const heightPx = Math.max(1, Math.round(tex.h * this.scale));
            const cyclesRemaining = this.toCyclesRemaining150(entry);
            const progress = 150 - cyclesRemaining;
            const offsetY = Math.round(this.computeEffectOffset(entry.effect, progress));

            let left = centerX - Math.round(width / 2);
            // The texture's internal baseline sits at V_PADDING + ascent from its top.
            const top = layout.baseline - V_PADDING - layout.ascent + offsetY;

            if ((entry.effect | 0) === 4) {
                const textWidth = Math.max(0, tex.w - H_PADDING * 2);
                const scroll = (progress * (textWidth + 100)) / 150;
                const drawX = centerX + 50 - scroll;
                left = Math.round(drawX - H_PADDING);
                const scLeft = Math.round(centerX - 50);
                const scTop = top;
                const scWidth = Math.round(100);
                const scHeight = heightPx;
                const scBottom = Math.round(this.app.height - (scTop + scHeight));
                if (scWidth > 0 && scHeight > 0) {
                    this.app.enable(PicoGL.SCISSOR_TEST);
                    const x = Math.max(scLeft, clip[0]);
                    const y = Math.max(scBottom, clip[1]);
                    this.app.scissor(x, y,
                        Math.max(0, Math.min(scLeft + scWidth, clip[0] + clip[2]) - x),
                        Math.max(0, Math.min(scBottom + scHeight, clip[1] + clip[3]) - y));
                }
            } else if ((entry.effect | 0) === 5) {
                const scLeft = Math.round(left);
                const scTop = top;
                const scWidth = width;
                const scHeight = heightPx;
                const scBottom = Math.round(this.app.height - (scTop + scHeight));
                if (scWidth > 0 && scHeight > 0) {
                    this.app.enable(PicoGL.SCISSOR_TEST);
                    const x = Math.max(scLeft, clip[0]);
                    const y = Math.max(scBottom, clip[1]);
                    this.app.scissor(x, y,
                        Math.max(0, Math.min(scLeft + scWidth, clip[0] + clip[2]) - x),
                        Math.max(0, Math.min(scBottom + scHeight, clip[1] + clip[3]) - y));
                }
            }

            this.quadVerts[0] = left;
            this.quadVerts[1] = top;
            this.quadVerts[2] = left;
            this.quadVerts[3] = top + heightPx;
            this.quadVerts[4] = left + width;
            this.quadVerts[5] = top + heightPx;
            this.quadVerts[6] = left;
            this.quadVerts[7] = top;
            this.quadVerts[8] = left + width;
            this.quadVerts[9] = top + heightPx;
            this.quadVerts[10] = left + width;
            this.quadVerts[11] = top;

            this.positions.data(this.quadVerts);
            this.uvs.data(this.quadUvs);

            this.tint[0] = 1;
            this.tint[1] = 1;
            this.tint[2] = 1;
            this.tint[3] = alpha;

            this.drawCall
                .uniform("u_resolution", this.screenSize)
                .uniform("u_tint", this.tint)
                .texture("u_sprite", tex.tex)
                .draw();

            if ((entry.effect | 0) === 4 || (entry.effect | 0) === 5) {
                this.app.scissor(clip[0], clip[1], clip[2], clip[3]);
            }

            if (tex.disposable) {
                try {
                    tex.tex.delete?.();
                } catch {}
            }
        }
        if (!sceneClip) this.app.disable(PicoGL.SCISSOR_TEST);
    }

    dispose(): void {
        try {
            this.positions?.delete?.();
            this.uvs?.delete?.();
            this.array?.delete?.();
            this.drawCall?.delete?.();
        } catch {}
        for (const cached of this.textCache.values()) {
            try {
                cached.tex.delete?.();
            } catch {}
        }
        this.textCache.clear();
        this.iconCache.clear();
        this.segmentsCache.clear();
        this.font = undefined;
        this.spriteIndex = undefined;
        try {
            this.screenProgram?.delete?.();
        } catch {}
        this.screenProgram = undefined;
    }

    private getTextTexture(
        entry: OverheadTextEntry,
        args: OverlayUpdateArgs | undefined,
    ): CachedTexture | undefined {
        this.ensureFont();
        const segments = this.parseSegments(entry.text, entry.modIcon);
        const style = this.resolveOverheadStyle(entry, args, segments);
        const key = style.dynamic ? undefined : this.buildCacheKey(style.colour, segments);
        if (key) {
            const cached = this.textCache.get(key);
            if (cached) {
                return cached;
            }
        }
        const font = this.font;
        if (!font) return undefined;

        const measure = this.measureSegments(font, segments);
        if (measure.width <= 0 || measure.height <= 0) return undefined;

        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, measure.width);
        canvas.height = Math.max(1, measure.height);
        const ctx = canvas.getContext("2d", {
            willReadFrequently: true as any,
        }) as CanvasRenderingContext2D | null;
        if (!ctx) return undefined;

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

        const tex = this.app.createTexture2D(canvas as any, {
            flipY: false,
            minFilter: PicoGL.NEAREST,
            magFilter: PicoGL.NEAREST,
            wrapS: PicoGL.CLAMP_TO_EDGE,
            wrapT: PicoGL.CLAMP_TO_EDGE,
        });
        const cachedTexture: CachedTexture = {
            tex,
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
    ): Array<
        | { type: "icon"; iconIndex: number }
        | {
              type: "text";
              text: string;
          }
    > {
        // PERF: Check cache first to avoid re-parsing same text every frame
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
        // PERF: Filter in-place instead of creating new array
        let writeIdx = 0;
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            if (seg.type === "icon" ? seg.iconIndex >= 0 : seg.text.length > 0) {
                segments[writeIdx++] = seg;
            }
        }
        segments.length = writeIdx;

        // Cache the result (limit cache size to prevent memory leaks)
        if (this.segmentsCache.size > 500) {
            // Clear oldest entries
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
        // PERF: Build key without intermediate array allocation
        let key = `${color >>> 0}`;
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            if (seg.type === "icon") key += `|icon:${seg.iconIndex}`;
            else key += `|text:${seg.text}`;
        }
        return key;
    }

    private resolveOverheadStyle(
        entry: OverheadTextEntry,
        args: OverlayUpdateArgs | undefined,
        segments: Array<{ type: "icon"; iconIndex: number } | { type: "text"; text: string }>,
    ): {
        colour: number;
        dynamic: boolean;
        perCharColours?: Int32Array;
        xOffsets?: Int32Array;
        yOffsets?: Int32Array;
    } {
        const viewportDrawCount = Math.floor((args?.time ?? 0) / 20) | 0;
        const progress = 150 - this.toCyclesRemaining150(entry);

        // PERF: Build rawText without .filter().map().join() to avoid intermediate arrays
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

        // Unreachable.
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
                if (progress < 50) {
                    const value = 0xff0000 + progress * 0x500;
                    return value & 0xffffff;
                }
                if (progress < 100) {
                    const value = 0xffff00 - (progress - 50) * 0x50000;
                    return value & 0xffffff;
                }
                return (0x00ff00 + (progress - 100) * 0x5) & 0xffffff;
            case 10:
                if (progress < 50) {
                    const value = 0xff0000 + progress * 0x5;
                    return value & 0xffffff;
                }
                if (progress < 100) {
                    const value = 0xff00ff - (progress - 50) * 0x50000;
                    return value & 0xffffff;
                }
                return (0x0000ff + (progress - 100) * 0x50000 - (progress - 100) * 0x5) & 0xffffff;
            case 11:
            default:
                if (progress < 50) {
                    const value = 0xffffff - progress * 0x50005;
                    return value & 0xffffff;
                }
                if (progress < 100) {
                    const value = 0x00ff00 + (progress - 50) * 0x50005;
                    return value & 0xffffff;
                }
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
        const cached = this.iconCache.get(iconIndex);
        if (cached) return cached;
        this.ensureSpriteIndex();
        if (!this.spriteIndex || this.modIconArchiveId < 0) return undefined;
        try {
            const sprites = SpriteLoader.loadIntoIndexedSprites(
                this.spriteIndex,
                this.modIconArchiveId,
            );
            const sprite = sprites?.[iconIndex] ?? sprites?.[0];
            if (!sprite) return undefined;
            const canvas = spriteToCanvas(sprite);
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
            const cache = this.ctx.getCacheSystem();
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
            this.spriteIndex = this.ctx.getCacheSystem().getIndex(IndexType.DAT2.sprites);
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
