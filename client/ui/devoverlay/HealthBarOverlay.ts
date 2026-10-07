import { vec3 } from "gl-matrix";
import {
    DrawCall,
    App as PicoApp,
    PicoGL,
    Program,
    Texture,
    UniformBuffer,
    VertexArray,
    VertexBuffer,
} from "picogl";

import type { CacheIndex } from "../../rs/cache/CacheIndex";
import type { CacheInfo } from "../../rs/cache/CacheInfo";
import type { CacheSystem } from "../../rs/cache/CacheSystem";
import { ConfigType } from "../../rs/cache/ConfigType";
import { IndexType } from "../../rs/cache/IndexType";
import { HealthBarDefinition } from "../../rs/config/healthbar/HealthBarDefinition";
import { ArchiveHealthBarDefinitionLoader } from "../../rs/config/healthbar/HealthBarDefinitionLoader";
import { IndexedSprite } from "../../rs/sprite/IndexedSprite";
import { SpriteLoader } from "../../rs/sprite/SpriteLoader";
import {
    HealthBarEntry,
    Overlay,
    OverlayInitArgs,
    OverlayUpdateArgs,
    RenderPhase,
} from "./Overlay";

export interface HealthBarContext {
    getCacheSystem: () => CacheSystem;
    getLoadedCacheInfo: () => CacheInfo | undefined;
}

interface SpriteTexture {
    tex: Texture;
    w: number;
    h: number;
}

/**
 * Renders RuneScape-style health bars in screen space using the same billboard shader
 * as the hitsplat overlay. The bar is anchored to a world position and rendered in
 * two passes (background + fill), honouring definition widths/padding when available.
 */
export class HealthBarOverlay implements Overlay {
    constructor(
        private readonly program: Program,
        private readonly ctx: HealthBarContext,
    ) {}

    private app!: PicoApp;
    private sceneUniforms!: UniformBuffer;

    private positions?: VertexBuffer;
    private uvs?: VertexBuffer;
    private array?: VertexArray;
    private drawCall?: DrawCall;

    private spriteIndex?: CacheIndex;
    private defs?: Map<number, HealthBarDefinition>;
    private defaultDefId: number = 0;

    private spriteTextures: Map<number, SpriteTexture> = new Map();
    private fallbackTexture?: SpriteTexture;

    private screenSize: Float32Array = new Float32Array(2);
    private tint: Float32Array = new Float32Array([1, 1, 1, 1]);
    private centerWorld: vec3 = vec3.create();
    private quadVerts: Float32Array = new Float32Array(12);
    private quadUvs: Float32Array = new Float32Array([0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0]);
    // Fallback per-actor offset map when no shared stack state is provided.
    private stackOffsets: Map<number, number> = new Map();

    private lastArgs?: OverlayUpdateArgs;
    private entries: HealthBarEntry[] = [];
    private gameCycle: number = 0;
    private actorStacks?: Map<number, number>;

    /** UI/render scale × visual size multiplier. */
    scale: number = 1.0;

    init(args: OverlayInitArgs): void {
        this.app = args.app;
        this.sceneUniforms = args.sceneUniforms;

        this.positions = this.app.createVertexBuffer(PicoGL.FLOAT, 2, new Float32Array(12));
        this.uvs = this.app.createVertexBuffer(PicoGL.FLOAT, 2, this.quadUvs);
        this.array = this.app
            .createVertexArray()
            .vertexAttributeBuffer(0, this.positions)
            .vertexAttributeBuffer(1, this.uvs);
        this.drawCall = this.app
            .createDrawCall(this.program, this.array)
            .uniformBlock("SceneUniforms", this.sceneUniforms)
            .uniform("u_screenSize", this.screenSize)
            .uniform("u_tint", this.tint)
            .primitive(PicoGL.TRIANGLES);

        this.destroyTextures();
        this.initAssetsFromCache();
    }

    private destroyTextures(): void {
        for (const sprite of this.spriteTextures.values()) {
            try {
                sprite.tex.delete?.();
            } catch {}
        }
        this.spriteTextures.clear();
        if (this.fallbackTexture) {
            try {
                this.fallbackTexture.tex.delete?.();
            } catch {}
            this.fallbackTexture = undefined;
        }
    }

    dispose(): void {
        this.destroyTextures();
        try {
            this.positions?.delete?.();
            this.uvs?.delete?.();
            this.array?.delete?.();
        } catch {}
        this.positions = undefined;
        this.uvs = undefined;
        this.array = undefined;
        this.drawCall = undefined;
    }

    private initAssetsFromCache(): void {
        try {
            const cacheSystem = this.ctx.getCacheSystem();
            if (!cacheSystem) return; // Cache not loaded yet
            const configIndex = cacheSystem.getIndex(IndexType.DAT2.configs);
            if (!configIndex.archiveExists(ConfigType.OSRS.healthBar)) {
                return;
            }
            const cacheInfo = this.ctx.getLoadedCacheInfo?.();
            if (!cacheInfo) return;
            const archive = configIndex.getArchive(ConfigType.OSRS.healthBar);
            const loader = new ArchiveHealthBarDefinitionLoader(cacheInfo, archive);
            const ids = Array.from(archive.fileIds) as number[];
            ids.sort((a, b) => a - b);
            const map = new Map<number, HealthBarDefinition>();
            for (const id of ids) {
                try {
                    const def = loader.load(id);
                    if (def) map.set(id, def);
                } catch (err) {
                    console.warn("[HealthBarOverlay] failed to load definition", id, err);
                }
            }
            if (map.size > 0) {
                this.defs = map;
                this.defaultDefId = ids[0] ?? 0;
            }
        } catch (err) {
            console.warn("[HealthBarOverlay] initAssetsFromCache error", err);
        }

        try {
            const cacheSystem = this.ctx.getCacheSystem();
            this.spriteIndex = cacheSystem.getIndex(IndexType.DAT2.sprites);
        } catch {
            this.spriteIndex = undefined;
        }
    }

    private ensureFallbackTexture(): SpriteTexture {
        if (this.fallbackTexture) return this.fallbackTexture;
        const tex = this.app.createTexture2D(new Uint8Array([255, 255, 255, 255]), 1, 1, {
            internalFormat: PicoGL.RGBA8,
            type: PicoGL.UNSIGNED_BYTE,
            minFilter: PicoGL.NEAREST,
            magFilter: PicoGL.NEAREST,
            wrapS: PicoGL.CLAMP_TO_EDGE,
            wrapT: PicoGL.CLAMP_TO_EDGE,
        });
        const sprite = { tex, w: 1, h: 1 };
        this.fallbackTexture = sprite;
        return sprite;
    }

    private textureFromSprite(id: number | undefined): SpriteTexture | undefined {
        if (id == null || id < 0) return undefined;
        const cached = this.spriteTextures.get(id);
        if (cached) return cached;
        const spriteIndex = this.spriteIndex;
        if (!spriteIndex) return undefined;
        try {
            const indexed = SpriteLoader.loadIntoIndexedSprite(spriteIndex, id);
            if (!indexed) return undefined;
            const sprite = this.createTextureFromIndexedSprite(indexed);
            this.spriteTextures.set(id, sprite);
            return sprite;
        } catch (err) {
            console.warn("[HealthBarOverlay] failed to load sprite", id, err);
            return undefined;
        }
    }

    private createTextureFromIndexedSprite(spr: IndexedSprite): SpriteTexture {
        const width = Math.max(1, spr.subWidth | 0);
        const height = Math.max(1, spr.subHeight | 0);
        const pixels = new Uint8Array(width * height * 4);
        const palette = spr.palette ?? new Int32Array([0xff_ff_ff_ff]);
        const src = spr.pixels ?? new Uint8Array(width * height);
        for (let i = 0; i < width * height; i++) {
            const idx = src[i] & 0xff;
            const color = palette[idx] ?? 0;
            const r = (color >> 16) & 0xff;
            const g = (color >> 8) & 0xff;
            const b = color & 0xff;
            const a = color === 0 ? 0 : 0xff;
            const di = i * 4;
            pixels[di] = r;
            pixels[di + 1] = g;
            pixels[di + 2] = b;
            pixels[di + 3] = a;
        }
        const tex = this.app.createTexture2D(pixels, width, height, {
            internalFormat: PicoGL.RGBA8,
            type: PicoGL.UNSIGNED_BYTE,
            minFilter: PicoGL.NEAREST,
            magFilter: PicoGL.NEAREST,
            wrapS: PicoGL.CLAMP_TO_EDGE,
            wrapT: PicoGL.CLAMP_TO_EDGE,
        });
        return { tex, w: width, h: height };
    }

    update(args: OverlayUpdateArgs): void {
        this.lastArgs = args;
        // OverlayManager updates overlays twice per frame. Preserve the scene-pass
        // health bar payload when the later post-present update omits it.
        if (Object.prototype.hasOwnProperty.call(args.state, "healthBars")) {
            this.entries = Array.isArray(args.state.healthBars) ? args.state.healthBars : [];
        }
        if (typeof args.state.gameCycle === "number") {
            this.gameCycle = args.state.gameCycle | 0;
        }
        if (args.state.actor2dStacks) {
            this.actorStacks = args.state.actor2dStacks;
        }
    }

    draw(phase: RenderPhase): void {
        if (phase !== RenderPhase.PostPresent) return;
        if (!this.drawCall || !this.positions || !this.uvs) return;

        const args = this.lastArgs;
        if (!args) return;
        const entries = this.entries;
        if (entries.length === 0) return;

        this.screenSize[0] = this.app.width;
        this.screenSize[1] = this.app.height;
        this.app.enable(PicoGL.BLEND);
        this.app.disable(PicoGL.DEPTH_TEST);

        const helpers = args.helpers;
        const center = this.centerWorld;
        const stacks = this.actorStacks ?? this.stackOffsets;
        if (stacks === this.stackOffsets) {
            this.stackOffsets.clear();
        }
        const gameCycle = this.gameCycle | 0;
        const visualScale =
            typeof this.scale === "number" && Number.isFinite(this.scale) && this.scale > 0
                ? this.scale
                : 1.0;

        for (const entry of entries) {
            const plane = entry.plane | 0;
            const height = helpers.getMinTileHeightInRadius(
                entry.worldX,
                entry.worldZ,
                plane,
                entry.footprintRadius ?? 0,
            );
            const headOffset = entry.heightOffsetTiles ?? 0.5;
            center[0] = entry.worldX;
            center[1] = height - headOffset;
            center[2] = entry.worldZ;

            const definition = this.resolveDefinition(entry.defId);
            const back = this.textureFromSprite(definition?.backSpriteId);
            const front = this.textureFromSprite(definition?.frontSpriteId);
            const groupKey = typeof entry.groupKey === "number" ? entry.groupKey | 0 : undefined;
            let var18 = (groupKey !== undefined ? stacks.get(groupKey) : undefined) ?? -2;

            const barWidth = Math.max(1, (definition?.width ?? 30) | 0);
            const displayDuration = (definition?.int5 ?? 70) | 0;
            const fadeOutStartCycle = (definition?.int3 ?? -1) | 0;
            const secondarySaturation = (definition?.stepIncrement ?? 1) | 0;
            const elapsed = gameCycle - (entry.cycle | 0);
            if (elapsed < 0) {
                continue;
            }
            const remaining = displayDuration + (entry.cycleOffset | 0) - elapsed;
            if (remaining <= 0) {
                continue;
            }

            let pad = 0;
            let usable: number;
            if (back && front) {
                const padding = (definition?.widthPadding ?? 0) | 0;
                if (padding * 2 < front.w) {
                    pad = padding;
                }
                usable = front.w - pad * 2;
            } else {
                usable = barWidth;
            }

            let alpha256 = 255;
            const target = Math.trunc((usable * (entry.health2 | 0)) / barWidth);
            let fill: number;
            if ((entry.cycleOffset | 0) > elapsed) {
                const step =
                    secondarySaturation === 0
                        ? 0
                        : secondarySaturation * Math.trunc(elapsed / secondarySaturation);
                const start = Math.trunc((usable * (entry.health | 0)) / barWidth);
                fill = Math.trunc((step * (target - start)) / (entry.cycleOffset | 0)) + start;
            } else {
                fill = target;
                if (fadeOutStartCycle >= 0) {
                    alpha256 = Math.trunc(
                        (remaining << 8) / (displayDuration - fadeOutStartCycle),
                    );
                }
            }
            if ((entry.health2 | 0) > 0 && fill < 1) {
                fill = 1;
            }
            const alpha = alpha256 >= 0 && alpha256 < 255 ? alpha256 / 255 : 1;

            if (back && front) {
                if (fill === usable) {
                    fill += pad * 2;
                } else {
                    fill += pad;
                }

                const backW = back.w * visualScale;
                const backH = back.h * visualScale;
                const padS = pad * visualScale;
                const usableS = usable * visualScale;
                const fillS = fill * visualScale;

                var18 += backH;
                const y = -var18;
                const x = -(usableS * 0.5) - padS;

                this.writeQuad(x, y, backW, backH);
                this.resetFullUvs();
                this.tint[0] = this.tint[1] = this.tint[2] = 1.0;
                this.tint[3] = alpha;
                this.positions.data(this.quadVerts);
                this.uvs.data(this.quadUvs);
                this.drawCall
                    .uniform("u_screenSize", this.screenSize)
                    .uniform("u_centerWorld", center)
                    .uniform("u_tint", this.tint)
                    .texture("u_sprite", back.tex)
                    .draw();

                if (fillS > 0) {
                    // The fill is the front sprite clipped to the back sprite's height.
                    const clipH = Math.min(front.h, back.h) * visualScale;
                    this.writeQuad(x, y, fillS, clipH);
                    this.updateFillUvs(fill / front.w, clipH / (front.h * visualScale));
                    this.positions.data(this.quadVerts);
                    this.uvs.data(this.quadUvs);
                    this.drawCall
                        .uniform("u_screenSize", this.screenSize)
                        .uniform("u_centerWorld", center)
                        .uniform("u_tint", this.tint)
                        .texture("u_sprite", front.tex)
                        .draw();
                }
                this.resetFullUvs();
                var18 += 2 * visualScale;
            } else {
                // Sprite-less bars draw an opaque 5px green fill with red remainder.
                fill = Math.max(0, Math.min(usable, fill));
                const barH = 5 * visualScale;
                const usableS = usable * visualScale;
                const fillS = fill * visualScale;
                var18 += barH;
                const y = -var18;
                const x = -(usableS * 0.5);
                const fallback = this.ensureFallbackTexture();
                this.resetFullUvs();
                if (fillS > 0) {
                    this.writeQuad(x, y, fillS, barH);
                    this.tint[0] = 0;
                    this.tint[1] = 1;
                    this.tint[2] = 0;
                    this.tint[3] = 1;
                    this.positions.data(this.quadVerts);
                    this.uvs.data(this.quadUvs);
                    this.drawCall
                        .uniform("u_screenSize", this.screenSize)
                        .uniform("u_centerWorld", center)
                        .uniform("u_tint", this.tint)
                        .texture("u_sprite", fallback.tex)
                        .draw();
                }
                if (fillS < usableS) {
                    this.writeQuad(x + fillS, y, usableS - fillS, barH);
                    this.tint[0] = 1;
                    this.tint[1] = 0;
                    this.tint[2] = 0;
                    this.tint[3] = 1;
                    this.positions.data(this.quadVerts);
                    this.uvs.data(this.quadUvs);
                    this.drawCall
                        .uniform("u_screenSize", this.screenSize)
                        .uniform("u_centerWorld", center)
                        .uniform("u_tint", this.tint)
                        .texture("u_sprite", fallback.tex)
                        .draw();
                }
                var18 += 2 * visualScale;
            }

            if (groupKey !== undefined) {
                stacks.set(groupKey, var18 | 0);
            }
        }
    }

    private writeQuad(x: number, y: number, w: number, h: number): void {
        const verts = this.quadVerts;
        verts[0] = x;
        verts[1] = y;
        verts[2] = x;
        verts[3] = y + h;
        verts[4] = x + w;
        verts[5] = y + h;
        verts[6] = x;
        verts[7] = y;
        verts[8] = x + w;
        verts[9] = y + h;
        verts[10] = x + w;
        verts[11] = y;
    }

    private resetFullUvs(): void {
        const uvs = this.quadUvs;
        uvs[0] = 0;
        uvs[1] = 0;
        uvs[2] = 0;
        uvs[3] = 1;
        uvs[4] = 1;
        uvs[5] = 1;
        uvs[6] = 0;
        uvs[7] = 0;
        uvs[8] = 1;
        uvs[9] = 1;
        uvs[10] = 1;
        uvs[11] = 0;
    }

    private updateFillUvs(uMax: number, vMax: number = 1): void {
        const u = Math.min(1, Math.max(0, uMax));
        const v = Math.min(1, Math.max(0, vMax));
        const uvs = this.quadUvs;
        uvs[0] = 0;
        uvs[1] = 0;
        uvs[2] = 0;
        uvs[3] = v;
        uvs[4] = u;
        uvs[5] = v;
        uvs[6] = 0;
        uvs[7] = 0;
        uvs[8] = u;
        uvs[9] = v;
        uvs[10] = u;
        uvs[11] = 0;
    }

    private resolveDefinition(id?: number): HealthBarDefinition | undefined {
        const defs = this.defs;
        if (!defs || defs.size === 0) return undefined;
        const targetId = typeof id === "number" && defs.has(id) ? id : this.defaultDefId;
        return defs.get(targetId);
    }

    getDefinition(id?: number): HealthBarDefinition | undefined {
        return this.resolveDefinition(id);
    }
}
