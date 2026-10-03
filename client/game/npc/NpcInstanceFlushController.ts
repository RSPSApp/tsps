import type { BasTypeLoader } from "../../rs/config/bastype/BasTypeLoader";
import type { NpcTypeLoader } from "../../rs/config/npctype/NpcTypeLoader";
import type { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import type { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import type { MapManager } from "../MapManager";
import type { RenderDataWorkerPool } from "../worker/RenderDataWorkerPool";
import type { NpcInstance } from "../../render/npc/NpcRenderTemplate";

export type NpcInstanceFlushControllerDeps = {
    getRenderer: () => any;
    workerPool: RenderDataWorkerPool;
    getSeqTypeLoader: () => SeqTypeLoader;
    getSeqFrameLoader: () => SeqFrameLoader;
    getNpcTypeLoader: () => NpcTypeLoader;
    getBasTypeLoader: () => BasTypeLoader;
};

/**
 * Server-driven NPC instance map sync and deferred map geometry refresh.
 */
export class NpcInstanceFlushController {
    readonly instanceMap: Map<string, NpcInstance> = new Map();
    readonly mapsPendingReload: Set<number> = new Set();

    private flushScheduled = false;
    private flushInProgress = false;
    private flushRequested = false;
    private lifecycleGeneration = 0;
    private flushFallbackTimer?: ReturnType<typeof setTimeout>;
    private flushFallbackAttempt = 0;

    constructor(private readonly deps: NpcInstanceFlushControllerDeps) {}

    markMapPendingReload(mapId: number): void {
        this.mapsPendingReload.add(mapId | 0);
    }

    notifyRendererReady(): void {
        if (this.mapsPendingReload.size > 0) {
            this.scheduleFlush();
        }
    }

    scheduleFlush(): void {
        this.flushRequested = true;
        if (this.flushScheduled || this.flushInProgress) return;
        this.flushScheduled = true;
        Promise.resolve().then(() => {
            this.flushScheduled = false;
            void this.drainFlushQueue();
        });
    }

    clearLocal(): void {
        this.lifecycleGeneration++;
        this.instanceMap.clear();
        this.mapsPendingReload.clear();
        this.flushScheduled = false;
        this.flushRequested = false;
        this.resetFlushFallback();
    }

    applyNameOverrides(): void {
        const npcTypeLoader = this.deps.getNpcTypeLoader();
        if (!npcTypeLoader) return;
        try {
            for (const instance of this.instanceMap.values()) {
                if (!instance.name) continue;
                try {
                    const npcType = npcTypeLoader.load(instance.typeId);
                    npcType.name = instance.name;
                } catch (err) {
                    console.warn("Failed to apply NPC name override", instance.typeId, err);
                }
            }
        } catch (err) {
            console.warn("Failed to apply NPC instance name overrides", err);
        }
    }

    private scheduleFlushFallback(): void {
        if (this.flushFallbackTimer) return;
        if (this.mapsPendingReload.size === 0) {
            this.flushFallbackAttempt = 0;
            return;
        }
        const attempt = this.flushFallbackAttempt | 0;
        if (attempt >= 8) return;
        const delayMs = Math.min(2000, 50 * (1 << attempt));
        this.flushFallbackAttempt = (attempt + 1) | 0;
        this.flushFallbackTimer = setTimeout(() => {
            this.flushFallbackTimer = undefined;
            this.scheduleFlush();
        }, delayMs);
    }

    private resetFlushFallback(): void {
        this.flushFallbackAttempt = 0;
        if (!this.flushFallbackTimer) return;
        try {
            clearTimeout(this.flushFallbackTimer);
        } catch {}
        this.flushFallbackTimer = undefined;
    }

    private async drainFlushQueue(): Promise<void> {
        if (this.flushInProgress) return;
        this.flushInProgress = true;
        try {
            // Serialize worker-state changes and geometry builds. Concurrent
            // flushes can otherwise finish out of order and briefly restore an
            // older NPC appearance, or clear a newer pending map refresh.
            while (this.flushRequested) {
                this.flushRequested = false;
                const generation = this.lifecycleGeneration;
                try {
                    await this.flushInstances(generation);
                } catch (err) {
                    console.warn("[OsrsClient] failed to flush NPC instances", err);
                    if (
                        generation === this.lifecycleGeneration &&
                        this.mapsPendingReload.size > 0
                    ) {
                        this.scheduleFlushFallback();
                    }
                }
            }
        } finally {
            this.flushInProgress = false;
            if (this.flushRequested) {
                this.scheduleFlush();
            }
        }
    }

    private async flushInstances(generation: number): Promise<void> {
        // Clone each mutable entry so this worker update represents one
        // coherent appearance snapshot even if sync mutates instanceMap while
        // the worker RPC is in flight.
        const instances = Array.from(this.instanceMap.values(), (instance) => ({ ...instance }));
        const pending = Array.from(this.mapsPendingReload);
        for (const mapId of pending) {
            this.mapsPendingReload.delete(mapId);
        }

        try {
            await this.deps.workerPool.setNpcInstances(instances);
        } catch (err) {
            if (generation === this.lifecycleGeneration) {
                for (const mapId of pending) this.mapsPendingReload.add(mapId);
            }
            throw err;
        }

        if (generation !== this.lifecycleGeneration) return;

        this.applyNameOverrides();

        if (pending.length === 0) {
            if (this.mapsPendingReload.size === 0) this.resetFlushFallback();
            return;
        }

        const renderer: any = this.deps.getRenderer();
        const rendererReady =
            !!renderer &&
            !!renderer.app &&
            !!renderer.npcProgram &&
            !!renderer.textureArray &&
            !!renderer.textureMaterials &&
            !!renderer.waterTextures &&
            !!renderer.sceneUniformBuffer;
        const mapManager = renderer?.mapManager as MapManager<any> | undefined;
        // An instance scene isn't streamed, so the map manager's current map stays unset.
        const mapManagerReady =
            !!mapManager &&
            (((mapManager.currentMapX | 0) >= 0 && (mapManager.currentMapY | 0) >= 0) ||
                (!!renderer?.instanceActive && !!renderer?.instanceSceneMap));

        if (!rendererReady || !mapManagerReady) {
            for (const mapId of pending) this.mapsPendingReload.add(mapId);
            this.scheduleFlushFallback();
            return;
        }

        this.resetFlushFallback();

        const remaining = new Set<number>();
        const geometryPromises: Array<
            Promise<{ mapId: number; status: "applied" | "retry" | "stale" }>
        > = [];
        const seqTypeLoader = this.deps.getSeqTypeLoader();
        const seqFrameLoader = this.deps.getSeqFrameLoader();
        const npcTypeLoader = this.deps.getNpcTypeLoader();
        const basTypeLoader = this.deps.getBasTypeLoader();

        for (const mapId of pending) {
            const mapX = (mapId >> 8) & 0xff;
            const mapY = mapId & 0xff;

            const isWorldEntityOverlay = mapManager.worldEntityMapIds.has(mapId);
            // An instance scene is one map that isn't streamed, so it is never in the grid.
            const scene = renderer.instanceActive ? renderer.instanceSceneMap : null;
            const isInstanceScene = !!scene && (((scene.mapX << 8) | scene.mapY) === mapId);
            if (!isWorldEntityOverlay && !isInstanceScene && !mapManager.isMapInCurrentGrid(mapX, mapY)) {
                remaining.add(mapId);
                continue;
            }

            const map = mapManager.getMap(mapX, mapY);
            if (!map) {
                mapManager.loadMap(mapX, mapY);
                remaining.add(mapId);
                continue;
            }

            geometryPromises.push(
                (async () => {
                    try {
                        const npcGeometry = await this.deps.workerPool.queueNpcGeometry(
                            mapX,
                            mapY,
                            renderer.maxLevel ?? 3,
                            Array.from(renderer.loadedTextureIds ?? []),
                            // NPC tiles are relative to where the map is drawn (an instance
                            // scene's base, not its square's corner).
                            typeof map.getRenderBaseTileX === "function"
                                ? { x: map.getRenderBaseTileX(), y: map.getRenderBaseTileY() }
                                : undefined,
                        );
                        if (!npcGeometry) return { mapId, status: "retry" as const };

                        // A new request for this map means this result was built
                        // from an older instance snapshot. Do not swap it into
                        // the live map, since that is the one-frame appearance
                        // rollback perceived as flicker.
                        if (
                            generation !== this.lifecycleGeneration ||
                            this.mapsPendingReload.has(mapId) ||
                            mapManager.getMap(mapX, mapY) !== map
                        ) {
                            if (generation === this.lifecycleGeneration) {
                                this.mapsPendingReload.add(mapId);
                            }
                            return { mapId, status: "stale" as const };
                        }

                        const refreshNpcGeometry = (map as any).refreshNpcGeometry;
                        if (typeof refreshNpcGeometry !== "function") {
                            return { mapId, status: "retry" as const };
                        }
                        renderer.updateTextureArray?.(npcGeometry.loadedTextures);
                        refreshNpcGeometry.call(
                            map,
                            renderer.app,
                            renderer.npcProgram,
                            renderer.textureArray,
                            renderer.textureMaterials,
                            renderer.waterTextures,
                            renderer.sceneUniformBuffer,
                            seqTypeLoader,
                            seqFrameLoader,
                            npcTypeLoader,
                            basTypeLoader,
                            npcGeometry,
                        );
                        return { mapId, status: "applied" as const };
                    } catch (err) {
                        console.warn(
                            "[OsrsClient] failed to refresh NPC geometry",
                            mapX,
                            mapY,
                            err,
                        );
                        return { mapId, status: "retry" as const };
                    }
                })(),
            );
        }

        const results = await Promise.all(geometryPromises);
        for (const res of results) {
            if (res.status === "retry") remaining.add(res.mapId | 0);
        }

        if (generation === this.lifecycleGeneration) {
            for (const mapId of remaining) {
                this.mapsPendingReload.add(mapId);
            }
        }
    }
}
