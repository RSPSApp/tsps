import type { WebGPURenderer } from "../WebGPURenderer";
import type { WebGPUMapSquare } from "../WebGPUMapSquare";
import type { WorldResources } from "../WorldResources";
import { GfxCache, graphicFrameCycle } from "../../gfx/GfxCache";
import { GfxManager } from "../../gfx/GfxManager";
import type { WebGLOsrsRenderer } from "../../WebGLOsrsRenderer";
import { ProjectileManager } from "../../projectiles/ProjectileManager";

/**
 * Creates the CPU graphics runtime (spot-animation cache/manager, projectile manager) against
 * a renderer proxy. The proxy lets the unmodified WebGL-era classes read the three host
 * members they need from the WebGPU renderer without touching WebGL state:
 *   - gfxRenderer : supplies the shared spot-animation GfxCache
 *   - textureIdIndexMap / updateTextureArray / loadedTextureIds : world atlas bookkeeping
 *   - playerRenderer.getRenderPlayersForMap : player slot order for attached GFX
 */
export class ActorGfxRuntime {
    readonly cache: GfxCache;
    readonly manager: GfxManager;
    readonly projectiles: ProjectileManager;

    private readonly frameOffsetCache = new Map<number, number[] | null>();

    constructor(
        renderer: WebGPURenderer,
        world: WorldResources,
        textureIdIndexMap: Map<number, number>,
        getRenderPlayersForMap: (map: WebGPUMapSquare) => number[],
        shouldRenderNpcFromMap?: (map: WebGPUMapSquare, ecsId: number) => boolean,
    ) {
        const proxy: any = Object.create(renderer);
        const cacheHolder: { cache?: GfxCache } = {};
        proxy.gfxRenderer = { getCache: () => cacheHolder.cache };
        proxy.textureIdIndexMap = textureIdIndexMap;
        proxy.updateTextureArray = (textures: Map<number, Int32Array>): void =>
            world.uploadMapTextures(textures);
        proxy.loadedTextureIds = world.loadedTextureIds;
        proxy.playerRenderer = {
            getRenderPlayersForMap: (map: WebGPUMapSquare) => getRenderPlayersForMap(map),
        };
        if (shouldRenderNpcFromMap) {
            proxy.shouldRenderNpcFromMap = (map: WebGPUMapSquare, ecsId: number): boolean =>
                shouldRenderNpcFromMap(map, ecsId);
        }

        const glProxy = proxy as WebGLOsrsRenderer;
        this.cache = new GfxCache(glProxy);
        cacheHolder.cache = this.cache;
        this.manager = new GfxManager(glProxy);
        this.projectiles = new ProjectileManager(glProxy);
    }

    /** Drops every graphic's geometry and timing (custom graphics changed). */
    clear(): void {
        this.cache.clear();
        this.frameOffsetCache.clear();
    }

    /** Port of GfxRenderer.getFrameOffsets. */
    frameOffsets(spotId: number): number[] | null {
        const cached = this.frameOffsetCache.get(spotId);
        if (cached !== undefined) return cached;

        const lengths = this.cache.getFrameLengths(spotId);
        if (!lengths || lengths.length === 0) {
            this.frameOffsetCache.set(spotId, null);
            return null;
        }
        const offsets = new Array<number>(lengths.length);
        let acc = 0;
        for (let i = 0; i < lengths.length; i++) {
            acc += Math.max(1, lengths[i] | 0);
            offsets[i] = acc;
        }
        this.frameOffsetCache.set(spotId, offsets);
        return offsets;
    }

    /** Port of GfxRenderer.computeSpotFrameIdxByMs. */
    frameIndexByAge(spotId: number, ageMs: number): number {
        try {
            const cycles = Math.max(0, Math.floor((ageMs | 0) / 20));
            const offsets = this.frameOffsets(spotId);
            if (offsets && offsets.length > 0) {
                const total = offsets[offsets.length - 1];
                const t = total > 0 ? ((cycles % total) + total) % total : cycles % offsets.length;
                let low = 0;
                let high = offsets.length - 1;
                while (low < high) {
                    const mid = (low + high) >>> 1;
                    if (t < offsets[mid]) {
                        high = mid;
                    } else {
                        low = mid + 1;
                    }
                }
                return low | 0;
            }
            const frameCount = Math.max(1, this.cache.getFrameCount(spotId) | 0);
            return ((cycles % frameCount) + frameCount) % frameCount;
        } catch {
            return 0;
        }
    }

    /** Frame cycle used by animation smoothing (0 when the plugin is off). */
    frameCycleFor(spotId: number, frameIdx: number, ageMs: number): number {
        return this.cache.smoothingCycle(
            spotId,
            frameIdx,
            graphicFrameCycle(this.frameOffsets(spotId), Math.floor(ageMs), frameIdx),
        );
    }
}
