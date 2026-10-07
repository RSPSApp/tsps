import { ModuleThread, Pool, spawn } from "threads";
import { QueuedTask } from "threads/dist/master/pool";
import { WorkerDescriptor } from "threads/dist/master/pool-types";
import { ObservablePromise } from "threads/dist/observable-promise";

import { canUseSharedArrayBuffer, LoadedCache } from "../Caches";
import { CustomItemRegistry } from "../../custom/items/CustomItemRegistry";
import { CustomModelRegistry } from "../../custom/items/CustomModelRegistry";
import { NpcGeometryData } from "../../render/loader/NpcGeometryData";
import type { NpcInstance } from "../../render/npc/NpcRenderTemplate";
import { RenderDataLoader } from "./RenderDataLoader";
import type { RenderDataWorker } from "./RenderDataWorker";

type RenderDataWorkerThread = ModuleThread<RenderDataWorker>;

function spawnWorker(): Promise<RenderDataWorkerThread> {
    // Keep this exact `new Worker(new URL(...))` shape so webpack emits a real
    // worker chunk. Do not wrap Safari in an importScripts/blob bootstrap:
    // production skips COEP on Safari, and blob workers break webpack's
    // relative importScripts for lazy chunks ("string did not match pattern").
    const worker = new Worker(new URL("./RenderDataWorker.ts", import.meta.url));
    return spawn<RenderDataWorker>(worker);
}

export class RenderDataWorkerPool {
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
        for (const worker of this.workers) {
            worker.init.then((w) => {
                w.initCache(cache, npcInstances);
                return w.setCustomContent({ gamemodeId: "custom-items", datasets: [
                    { key: "customItems", rows: Array.from(CustomItemRegistry.getAll(), (item) => item.definition) },
                    { key: "customModels", rows: CustomModelRegistry.getAll() },
                ] });
            });
        }
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
    ): QueuedTask<RenderDataWorkerThread, D> {
        return this.pool.queue((w) => w.load(loader, input) as ObservablePromise<D>);
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
        return this.pool.terminate();
    }
}
