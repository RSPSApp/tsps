import { getCustomDefinitions } from "../../custom/definitions/CustomDefinitionStore";
import { ModuleThread, Pool, spawn } from "threads";
import { QueuedTask } from "threads/dist/master/pool";
import { WorkerDescriptor } from "threads/dist/master/pool-types";
import { ObservablePromise } from "threads/dist/observable-promise";

import { canUseSharedArrayBuffer, LoadedCache } from "../Caches";
import { CustomItemRegistry } from "../../custom/items/CustomItemRegistry";
import { CustomModelRegistry } from "../../custom/items/CustomModelRegistry";
import { getDefinitionArchives } from "../../custom/archives/ArchivedDefinitionStore";
import { NpcGeometryData } from "../../render/loader/NpcGeometryData";
import type { NpcInstance } from "../../render/npc/NpcRenderTemplate";
import { RenderDataLoader } from "./RenderDataLoader";
import type { RenderDataWorker } from "./RenderDataWorker";
import type { SdMapLoaderInput } from "../../render/loader/SdMapLoaderInput";
import type { MinimapData } from "./MinimapData";
import type { WorldMapTileInput, WorldMapTileReply } from "./WorldMapTileJob";
import type { NpcPoseInput, NpcPoseResult } from "./NpcPoseJob";

type RenderDataWorkerThread = ModuleThread<RenderDataWorker>;
type PoseReservation = { worker: WorkerDescriptor<RenderDataWorkerThread>; task: Promise<void>; finish: () => void };

function spawnWorker(): Promise<RenderDataWorkerThread> {
    // Keep this exact `new Worker(new URL(...))` shape so webpack emits a real
    // worker chunk. Do not wrap Safari in an importScripts/blob bootstrap:
    // production skips COEP on Safari, and blob workers break webpack's
    // relative importScripts for lazy chunks ("string did not match pattern").
    const worker = new Worker(new URL("./RenderDataWorker.ts", import.meta.url));
    return spawn<RenderDataWorker>(worker);
}

export class RenderDataWorkerPool {
    private worldMapEpoch = 0;
    private nextMapBuildId = 0;
    private readonly worldMapRequests = new Set<() => void>();
    private disposed = false;
    npcPoseGeneration = 0;
    private npcPoseModelsRevision = -1;
    private npcPoseContentReady: Promise<void> = Promise.resolve();
    private readonly npcPoseRequests = new Set<() => void>();
    private readonly npcPoseWorkers = new Map<WorkerDescriptor<RenderDataWorkerThread>, PoseReservation>();

    get npcPoseConcurrency(): number { return Math.max(1, Math.min(2, this.size)); }

    private releasePoseWorker(reservation: PoseReservation, wake = true): void {
        if (this.npcPoseWorkers.get(reservation.worker) !== reservation) return;
        this.npcPoseWorkers.delete(reservation.worker);
        reservation.worker.runningTasks = reservation.worker.runningTasks.filter(task => task !== reservation.task);
        reservation.finish();
        if (wake && !this.disposed) (this.pool as any).scheduleWork?.();
    }

    get pendingWorldMapTiles(): number { return this.worldMapRequests.size; }
    static create(size: number): RenderDataWorkerPool {
        // ponytail: serial map builds without sharing; shared buffers avoid ~200 MB per worker.
        size = canUseSharedArrayBuffer() ? size : 1;
        const pool = Pool(() => spawnWorker(), size);
        const workers = pool["workers"] as WorkerDescriptor<RenderDataWorkerThread>[];
        return new RenderDataWorkerPool(pool, workers, size);
    }

    constructor(
        readonly pool: Pool<RenderDataWorkerThread>,
        readonly workers: WorkerDescriptor<RenderDataWorkerThread>[],
        readonly size: number,
    ) {}

    initCache(cache: LoadedCache, npcInstances: NpcInstance[]): void {
        this.npcPoseGeneration++;
        this.npcPoseModelsRevision = -1;
        for (const cancel of this.npcPoseRequests) cancel();
        for (const reservation of this.npcPoseWorkers.values()) this.releasePoseWorker(reservation, false);
        for (const worker of this.workers) {
            worker.init.then((w) => {
                w.initCache(cache, npcInstances, getDefinitionArchives());
                return w.setCustomContent({ gamemodeId: "custom-items", datasets: [
                    { key: "customItems", rows: Array.from(CustomItemRegistry.getAll(), (item) => item.definition) },
                    { key: "customModels", rows: CustomModelRegistry.getAll() },
                    { key: "customDefinitions", rows: getCustomDefinitions() },
                ] });
            });
        }
        this.cancelWorldMapTiles(true);
        queueMicrotask(() => { if (!this.disposed) (this.pool as any).scheduleWork?.(); });
    }

    /** A dat2 chunk the main thread created after initCache (sparse caches). */
    addCacheChunk(index: number, chunk: ArrayBuffer): void {
        for (const worker of this.workers) void worker.init.then((w) => w.addCacheChunk(index, chunk));
    }

    setNpcInstances(instances: NpcInstance[]): Promise<void> {
        const copy = Array.isArray(instances) ? instances.slice() : [];
        return this.runAll((w) => w.setNpcInstances(copy));
    }

    async runAll(task: (w: RenderDataWorkerThread) => any): Promise<void> {
        await Promise.all(this.workers.map((desc) => desc.init.then(task)));
    }

    initLoader(loader: RenderDataLoader<any, any>): Promise<void> {
        return this.runAll((w) => w.initDataLoader(loader));
    }

    resetLoader(loader: RenderDataLoader<any, any>): Promise<void> {
        return this.runAll((w) => w.resetDataLoader(loader));
    }

    queueLoad<I, D, Loader extends RenderDataLoader<I, D>>(
        loader: Loader,
        input: I,
        signal?: AbortSignal,
    ): QueuedTask<RenderDataWorkerThread, D> {
        const id = ++this.nextMapBuildId;
        return this.pool.queue(async (worker) => {
            signal?.throwIfAborted();
            const cancel = () => { void worker.cancelLoad(id).catch(() => {}); };
            signal?.addEventListener("abort", cancel, { once: true });
            try { return await worker.load(loader, input, id) as D; }
            finally { signal?.removeEventListener("abort", cancel); }
        });
    }

    queueNpcGeometry(
        mapX: number,
        mapY: number,
        maxLevel: number,
        loadedTextureIds: number[],
        renderBaseTile?: { x: number; y: number },
    ): QueuedTask<RenderDataWorkerThread, NpcGeometryData> {
        return this.pool.queue(
            (w) =>
                w.loadNpcGeometry(
                    mapX,
                    mapY,
                    maxLevel,
                    loadedTextureIds,
                    renderBaseTile,
                ) as ObservablePromise<NpcGeometryData>,
        );
    }

    queueMinimap(input: SdMapLoaderInput, level: number): QueuedTask<RenderDataWorkerThread, MinimapData | undefined> {
        return this.pool.queue((worker) => worker.loadMinimap(input, level));
    }

    loadWorldMapTile(input: Omit<WorldMapTileInput, "epoch">): Promise<WorldMapTileReply> {
        if (this.disposed) return Promise.reject(new Error("Worker pool disposed"));
        const epoch = this.worldMapEpoch;
        // Concurrent reads preserve geography/ground overlap on single-worker Android.
        // Keep one decoded world-map cache, on an existing worker, rather than one per slot.
        return new Promise((resolve, reject) => {
            const cancel = () => resolve({ supported: true });
            this.worldMapRequests.add(cancel);
            void this.workers[0].init.then(worker => worker.loadWorldMapTile({ ...input, epoch }))
                .then(reply => resolve(epoch === this.worldMapEpoch ? reply : { supported: true }), reject)
                .finally(() => this.worldMapRequests.delete(cancel));
        });
    }

    cancelWorldMapTiles(clearCache = false): void {
        const epoch = ++this.worldMapEpoch;
        for (const cancel of this.worldMapRequests) cancel();
        this.worldMapRequests.clear();
        if (!this.disposed) void this.workers[0].init.then(worker => worker.cancelWorldMapTiles(epoch, clearCache)).catch(() => {});
    }

    loadNpcPose(input: NpcPoseInput, signal?: AbortSignal): Promise<NpcPoseResult | undefined> {
        if (this.disposed || signal?.aborted) return Promise.resolve(undefined);
        if (this.npcPoseWorkers.size >= this.npcPoseConcurrency) return Promise.resolve({ busy: true });
        const available = this.workers.filter(worker => !this.npcPoseWorkers.has(worker));
        const descriptor = available.find(worker => !worker.runningTasks?.length) ?? available[0];
        if (!descriptor) return Promise.resolve({ busy: true });
        let finishReservation!: () => void;
        const reservation = { worker: descriptor, task: new Promise<void>(resolve => { finishReservation = resolve; }), finish: () => finishReservation() };
        this.npcPoseWorkers.set(descriptor, reservation);
        (descriptor.runningTasks ??= []).push(reservation.task);
        const generation = this.npcPoseGeneration;
        if (this.npcPoseModelsRevision !== CustomModelRegistry.revision) {
            this.npcPoseModelsRevision = CustomModelRegistry.revision;
            const payload = { gamemodeId: "custom-items", datasets: [
                { key: "customItems", rows: Array.from(CustomItemRegistry.getAll(), item => item.definition) },
                { key: "customModels", rows: CustomModelRegistry.getAll() },
                    { key: "customDefinitions", rows: getCustomDefinitions() },
            ] };
            this.npcPoseContentReady = this.runAll(worker => worker.setCustomContent(payload))
                .catch(error => { this.npcPoseModelsRevision = -1; throw error; });
        }
        return new Promise((resolve, reject) => {
            let settled = false, dispatched = false;
            const finish = (geometry?: NpcPoseResult) => { if (settled) return; settled = true; cleanup(); resolve(geometry); };
            const cancel = () => finish();
            const timeout = setTimeout(() => finish(), 3000);
            const cleanup = () => { clearTimeout(timeout); signal?.removeEventListener("abort", cancel); this.npcPoseRequests.delete(cancel);
                if (!dispatched) this.releasePoseWorker(reservation); };
            this.npcPoseRequests.add(cancel);
            signal?.addEventListener("abort", cancel, { once: true });
            void this.npcPoseContentReady.then(() => descriptor.init).then(async worker => {
                if (settled || this.disposed || signal?.aborted || generation !== this.npcPoseGeneration) return undefined;
                dispatched = true;
                try { return await worker.loadNpcPose(input); }
                finally { this.releasePoseWorker(reservation); }
            }).then(geometry => finish(generation === this.npcPoseGeneration && !signal?.aborted ? geometry : undefined),
                error => { if (!settled) { settled = true; cleanup(); reject(error); } });
        });
    }

    queueLoadTexture(
        id: number,
        size: number,
        flipH: boolean,
        brightness: number,
    ): QueuedTask<RenderDataWorkerThread, Int32Array> {
        return this.pool.queue(
            (w) => w.loadTexture(id, size, flipH, brightness) as ObservablePromise<Int32Array>,
        );
    }

    setVars(vars: Int32Array): Promise<void> {
        return this.runAll((w) => w.setVars(vars));
    }

    exportSprites(): QueuedTask<RenderDataWorkerThread, Blob> {
        return this.pool.queue((w) => w.exportSpritesToZip());
    }

    exportTextures(): QueuedTask<RenderDataWorkerThread, Blob> {
        return this.pool.queue((w) => w.exportTexturesToZip());
    }

    terminate(): Promise<void> {
        this.disposed = true;
        this.npcPoseGeneration++;
        for (const cancel of this.npcPoseRequests) cancel();
        this.cancelWorldMapTiles(true);
        for (const reservation of this.npcPoseWorkers.values()) this.releasePoseWorker(reservation, false);
        return this.pool.terminate();
    }
}
