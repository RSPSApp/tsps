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
import type { CacheSystem } from "../../rs/cache/CacheSystem";
import { IndexType } from "../../rs/cache/IndexType";
import { GraphicsDefaults } from "../../rs/config/defaults/GraphicsDefaults";
import { IndexedSprite } from "../../rs/sprite/IndexedSprite";
import { SpriteLoader } from "../../rs/sprite/SpriteLoader";
import {
    OverheadPrayerEntry,
    Overlay,
    OverlayInitArgs,
    OverlayUpdateArgs,
    RenderPhase,
} from "./Overlay";

export interface OverheadPrayerContext {
    getCacheSystem: () => CacheSystem;
    getLoadedCacheInfo: () => any;
}

interface SpriteTexture {
    tex: Texture;
    w: number;
    h: number;
}

/** Renders PK skull and prayer icons above players in OSRS stacking order. */
export class OverheadPrayerOverlay implements Overlay {
    constructor(
        private readonly program: Program,
        private readonly ctx: OverheadPrayerContext,
    ) {}

    private app!: PicoApp;
    private sceneUniforms!: UniformBuffer;

    private positions?: VertexBuffer;
    private uvs?: VertexBuffer;
    private array?: VertexArray;
    private drawCall?: DrawCall;

    private spriteIndex?: CacheIndex;
    private iconSprites = {
        pk: new Map<number, SpriteTexture>(),
        prayer: new Map<number, SpriteTexture>(),
    };
    private failedSpriteIndices = {
        pk: new Set<number>(),
        prayer: new Set<number>(),
    };
    private npcIconSprites = new Map<string, SpriteTexture>();
    private failedNpcIconKeys = new Set<string>();
    private archiveIds = { pk: -1, prayer: -1 };

    private screenSize: Float32Array = new Float32Array(2);
    private tint: Float32Array = new Float32Array([1, 1, 1, 1]);
    private centerWorld: vec3 = vec3.create();
    private quadVerts: Float32Array = new Float32Array(12);
    private quadUvs: Float32Array = new Float32Array([0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0]);

    private lastArgs?: OverlayUpdateArgs;
    private actorStacks?: Map<number, number>;
    private entries: OverheadPrayerEntry[] = [];

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
        for (const kind of ["pk", "prayer"] as const) {
            for (const sprite of this.iconSprites[kind].values()) {
                try {
                    sprite.tex.delete?.();
                } catch {}
            }
            this.iconSprites[kind].clear();
            this.failedSpriteIndices[kind].clear();
        }
        for (const sprite of this.npcIconSprites.values()) {
            try {
                sprite.tex.delete?.();
            } catch {}
        }
        this.npcIconSprites.clear();
        this.failedNpcIconKeys.clear();
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
            this.spriteIndex = cacheSystem.getIndex(IndexType.DAT2.sprites);

            // Load the same head-icon archives used by the official client.
            const cacheInfo = this.ctx.getLoadedCacheInfo?.();
            if (cacheInfo) {
                const defaults = GraphicsDefaults.load(cacheInfo, cacheSystem);
                this.archiveIds.pk = defaults.headIconsPk;
                this.archiveIds.prayer = defaults.headIconsPrayer;
            }

            // Fallback for cache variants without populated graphics defaults.
            if (this.spriteIndex) {
                for (const kind of ["pk", "prayer"] as const) {
                    if (this.archiveIds[kind] >= 0) continue;
                    try {
                        this.archiveIds[kind] = this.spriteIndex.getArchiveId(
                            kind === "pk" ? "headicons_pk" : "headicons_prayer",
                        );
                    } catch {}
                }
            }
        } catch (err) {
            console.warn("[OverheadPrayerOverlay] initAssetsFromCache error", err);
        }
    }

    private getSprite(kind: "pk" | "prayer", index: number): SpriteTexture | undefined {
        if (index < 0) return undefined;
        const cached = this.iconSprites[kind].get(index);
        if (cached) return cached;

        if (!this.spriteIndex || this.archiveIds[kind] < 0) {
            // The overlay can be constructed before cache loading finishes.
            // Re-resolve here rather than permanently hiding every icon.
            this.initAssetsFromCache();
        }
        if (!this.spriteIndex || this.archiveIds[kind] < 0) {
            return undefined;
        }

        // Don't repeatedly parse a confirmed missing sprite frame.
        if (this.failedSpriteIndices[kind].has(index)) return undefined;

        try {
            const sprites = SpriteLoader.loadIntoIndexedSprites(
                this.spriteIndex,
                this.archiveIds[kind],
            );
            if (!sprites || index >= sprites.length) {
                this.failedSpriteIndices[kind].add(index);
                return undefined;
            }

            const indexed = sprites[index];
            if (!indexed) {
                this.failedSpriteIndices[kind].add(index);
                return undefined;
            }

            const sprite = this.createTextureFromIndexedSprite(indexed);
            this.iconSprites[kind].set(index, sprite);
            return sprite;
        } catch (err) {
            console.warn(`[OverheadPrayerOverlay] failed to load ${kind} sprite`, index, err);
            this.failedSpriteIndices[kind].add(index);
            return undefined;
        }
    }

    private getNpcSprite(archiveId: number, spriteId: number): SpriteTexture | undefined {
        const key = `${archiveId}:${spriteId}`;
        const cached = this.npcIconSprites.get(key);
        if (cached) return cached;
        if (this.failedNpcIconKeys.has(key) || archiveId < 0 || spriteId < 0) return undefined;

        if (!this.spriteIndex) this.initAssetsFromCache();
        if (!this.spriteIndex) return undefined;

        try {
            const indexed = SpriteLoader.loadIntoIndexedSprites(this.spriteIndex, archiveId)?.[spriteId];
            if (!indexed) {
                this.failedNpcIconKeys.add(key);
                return undefined;
            }
            const sprite = this.createTextureFromIndexedSprite(indexed);
            this.npcIconSprites.set(key, sprite);
            return sprite;
        } catch {
            this.failedNpcIconKeys.add(key);
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
            // Index 0 is transparent in OSRS indexed sprites
            const a = idx === 0 ? 0 : (spr.alpha?.[i] ?? 0xff);
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
        // OverlayManager updates overlays multiple times per frame. Preserve the
        // scene-pass payload when a later update omits it.
        if (Object.prototype.hasOwnProperty.call(args.state, "overheadPrayers")) {
            this.entries = Array.isArray(args.state.overheadPrayers)
                ? args.state.overheadPrayers
                : [];
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
        const stacks = this.actorStacks;

        for (const entry of entries) {
            const sprites = [
                this.getSprite("pk", entry.headIconPk | 0),
                this.getSprite("prayer", entry.headIconPrayer | 0),
                ...(entry.npcHeadIcons ?? []).map((icon) => this.getNpcSprite(icon.archiveId, icon.spriteId)),
            ].filter((sprite): sprite is SpriteTexture => sprite !== undefined);
            if (sprites.length === 0) continue;

            const plane = entry.plane | 0;
            const height = helpers.getMinTileHeightInRadius(
                entry.worldX,
                entry.worldZ,
                plane,
                entry.footprintRadius ?? 0,
            );
            const headOffset = entry.heightOffsetTiles ?? 0.9;

            center[0] = entry.worldX;
            center[1] = height - headOffset;
            center[2] = entry.worldZ;

            const scale =
                Number.isFinite(this.scale) && this.scale > 0 ? this.scale : 1.0;
            // Continue the per-actor element offset above any text/health bars;
            // an untouched offset advances by 7 before icons are placed. OSRS
            // draws the skull first and then stacks the prayer icon above it.
            const groupKey = typeof entry.groupKey === "number" ? entry.groupKey | 0 : undefined;
            const stackOffset = groupKey !== undefined ? stacks?.get(groupKey) : undefined;
            let var18 = stackOffset ?? -2 * scale;
            if (stackOffset === undefined) {
                var18 += 7 * scale;
            }
            for (const sprite of sprites) {
                var18 += 25 * scale;
                this.writeQuad(
                    -12 * scale,
                    -var18,
                    Math.max(1, Math.round(sprite.w * scale)),
                    Math.max(1, Math.round(sprite.h * scale)),
                );
                this.resetFullUvs();

                this.tint[0] = 1.0;
                this.tint[1] = 1.0;
                this.tint[2] = 1.0;
                this.tint[3] = 1.0;

                this.positions.data(this.quadVerts);
                this.uvs.data(this.quadUvs);
                this.drawCall
                    .uniform("u_screenSize", this.screenSize)
                    .uniform("u_centerWorld", center)
                    .uniform("u_tint", this.tint)
                    .texture("u_sprite", sprite.tex)
                    .draw();
            }
            if (groupKey !== undefined) stacks?.set(groupKey, var18);
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
}
