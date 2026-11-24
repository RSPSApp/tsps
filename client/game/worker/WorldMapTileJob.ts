import { CacheFiles } from "../../rs/cache/CacheFiles";
import { ConfigType } from "../../rs/cache/ConfigType";
import { IndexType } from "../../rs/cache/IndexType";
import { retryOnMissingGroup } from "../../rs/cache/js5/retryOnMissingGroup";
import { ArchiveMapElementTypeLoader } from "../../rs/config/meltype/MapElementTypeLoader";
import { VarManager } from "../../rs/config/vartype/VarManager";
import { WorldMapArchiveRenderer, type WorldMapRenderArea, type WorldMapRenderedTile } from "../../rs/map/WorldMapArchiveRenderer";
import type { WorkerState } from "./RenderDataWorker";

export type WorldMapTileInput = { area: WorldMapRenderArea; mapX: number; mapY: number; pixelsPerTile: number; epoch: number };
export type WorldMapTileReply = { supported: boolean; tile?: WorldMapRenderedTile };

/** Shares the existing worker cache and JS5 connection; only decoded map data is retained here. */
export class WorldMapTileJob {
    private renderer?: WorldMapArchiveRenderer;
    private rendererPromise?: Promise<WorldMapArchiveRenderer | undefined>;
    private readonly vars: VarManager;
    private epoch = 0;
    private abort = new AbortController();
    private disposed = false;
    private rasterSupported?: boolean;

    constructor(private readonly state: WorkerState) {
        this.vars = new VarManager(state.cacheLoaderFactory.getVarBitTypeLoader());
        this.vars.set(state.varManager.values);
    }

    setVars(values: Int32Array): void { this.vars.set(values); }

    invalidate(): void { this.cancel(this.epoch, true); }

    cancel(epoch: number, clearCache = false): void {
        this.epoch = epoch;
        this.abort.abort();
        this.abort = new AbortController();
        if (clearCache) this.renderer?.clear();
        else this.renderer?.cancelLoads();
    }

    dispose(): void {
        this.disposed = true;
        this.abort.abort();
        this.renderer?.clear();
    }

    async load(input: WorldMapTileInput): Promise<WorldMapTileReply> {
        if (this.rasterSupported === undefined) {
            try {
                this.rasterSupported = typeof OffscreenCanvas !== "undefined" && typeof createImageBitmap === "function" &&
                    !!new OffscreenCanvas(1, 1).getContext("2d");
            } catch { this.rasterSupported = false; }
        }
        if (!this.rasterSupported) return { supported: false };
        if (this.disposed || input.epoch !== this.epoch) return { supported: true };
        const signal = this.abort.signal;
        const renderer = await this.getRenderer();
        if (!renderer || signal.aborted || this.disposed) return { supported: true };
        const tile = await renderer.loadTile(input.area, input.mapX, input.mapY, input.pixelsPerTile, signal);
        return signal.aborted || this.disposed ? { supported: true } : { supported: true, tile };
    }

    private getRenderer(): Promise<WorldMapArchiveRenderer | undefined> {
        if (this.renderer) return Promise.resolve(this.renderer);
        if (this.rendererPromise) return this.rendererPromise;
        this.rendererPromise = retryOnMissingGroup(() => {
            if (this.disposed) return undefined;
            const state = this.state;
            for (const id of [IndexType.OSRS.worldMap, IndexType.OSRS.worldMapGeography, IndexType.OSRS.worldMapGround]) {
                if (state.cacheSystem.indexExists(id)) continue;
                const bytes = state.cache.files.files.get(CacheFiles.INDEX_FILE_PREFIX + id);
                if (!bytes || !state.cacheSystem.addIndexFromData(id, bytes)) throw new Error(`World map index unavailable: ${id}`);
            }
            const config = state.cacheSystem.getIndex(IndexType.DAT2.configs);
            const mapFunctions = state.cache.info.game === "oldschool" ? ConfigType.OSRS.mapFunctions : ConfigType.RS2.mapFunctions;
            this.renderer = new WorldMapArchiveRenderer({
                cacheSystem: state.cacheSystem,
                locTypeLoader: state.locTypeLoader,
                mapElementTypeLoader: config.archiveExists(mapFunctions)
                    ? new ArchiveMapElementTypeLoader(state.cache.info, config.getArchive(mapFunctions)) : undefined,
                overlayTypeLoader: state.cacheLoaderFactory.getOverlayTypeLoader(),
                textureLoader: state.textureLoader,
                mapScenes: state.minimapImageRenderer.mapScenes,
                varManager: this.vars,
                maxRenderedRegionBytes: 0,
                // The worker streams the cache: wait on each group's fetch, not a 250ms poll.
                waitForGroup: state.js5 ? (indexId, archiveId) => state.js5!.requestGroup(indexId, archiveId, true) : undefined,
                beforeRaster: async (signal) => {
                    // Yield the worker task queue and let foreground geometry finish first.
                    do { await new Promise(resolve => setTimeout(resolve, 0)); }
                    while (state.sceneJobs > 0 && !signal?.aborted && !this.disposed);
                },
            });
            return this.renderer;
        }).finally(() => { this.rendererPromise = undefined; });
        return this.rendererPromise;
    }
}
