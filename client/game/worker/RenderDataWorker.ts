import JSZip from "jszip";
import { loadFromPayload } from "../../common/gamemode/GamemodeContentStore";
import { TransferDescriptor } from "threads";
import { registerSerializer } from "threads";
import { Transfer, expose } from "threads/worker";

import { CacheSystem } from "../../rs/cache/CacheSystem";
import { ConfigType } from "../../rs/cache/ConfigType";
import { IndexType } from "../../rs/cache/IndexType";
import { isGroupMissingError } from "../../rs/cache/js5/GroupMissingError";
import { Js5RangeClient } from "../../rs/cache/js5/Js5RangeClient";
import { WorkerJs5Coordinator } from "../../rs/cache/js5/Js5Coordinator";
import { PresenceBitset } from "../../rs/cache/js5/PresenceBitset";
import { SparseMemoryStore } from "../../rs/cache/store/SparseMemoryStore";
import {
    CacheLoaderFactory,
    getCacheLoaderFactory,
} from "../../rs/cache/loader/CacheLoaderFactory";
import { Bzip2 } from "../../rs/compression/Bzip2";
import { Gzip } from "../../rs/compression/Gzip";
import { BasTypeLoader } from "../../rs/config/bastype/BasTypeLoader";
import { IdkTypeLoader } from "../../rs/config/idktype/IdkTypeLoader";
import { LocModelLoader } from "../../rs/config/loctype/LocModelLoader";
import { LocTypeLoader } from "../../rs/config/loctype/LocTypeLoader";
import { NpcModelLoader } from "../../rs/config/npctype/NpcModelLoader";
import { NpcTypeLoader } from "../../rs/config/npctype/NpcTypeLoader";
import { ObjTypeLoader } from "../../rs/config/objtype/ObjTypeLoader";
import { PlayerModelLoader } from "../../rs/config/player/PlayerModelLoader";
import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { VarManager } from "../../rs/config/vartype/VarManager";
import { MinimapImageRenderer } from "../../rs/map/MinimapImageRenderer";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { SkeletalSeqLoader } from "../../rs/model/skeletal/SkeletalSeqLoader";
import { SceneBuilder } from "../../rs/scene/SceneBuilder";
import { IndexedSprite } from "../../rs/sprite/IndexedSprite";
import { SpriteLoader } from "../../rs/sprite/SpriteLoader";
import { TextureLoader } from "../../rs/texture/TextureLoader";
import { Hasher } from "../../common/utils/Hasher";
import { LoadedCache } from "../Caches";
import { NpcGeometryData } from "../../render/loader/NpcGeometryData";
import { SdMapDataLoader } from "../../render/loader/SdMapDataLoader";
import type { NpcInstance } from "../../render/npc/NpcRenderTemplate";
import { RenderDataLoader, renderDataLoaderSerializer } from "./RenderDataLoader";

registerSerializer(renderDataLoaderSerializer);

const compressionPromise = Promise.all([Bzip2.initWasm(), Gzip.initWasm()]);
const hasherPromise = Hasher.init();
const npcGeometryLoader = new SdMapDataLoader();

export type WorkerState = {
    cache: LoadedCache;
    cacheSystem: CacheSystem;
    cacheLoaderFactory: CacheLoaderFactory;
    /** Set when the cache is sparse: fetches missing groups on demand. */
    js5?: Pick<Js5RangeClient, "store" | "requestGroup" | "settled">;

    locTypeLoader: LocTypeLoader;
    objTypeLoader: ObjTypeLoader;
    npcTypeLoader: NpcTypeLoader;
    idkTypeLoader: IdkTypeLoader;

    seqTypeLoader: SeqTypeLoader;
    basTypeLoader: BasTypeLoader;

    textureLoader: TextureLoader;
    seqFrameLoader: SeqFrameLoader;
    skeletalSeqLoader: SkeletalSeqLoader | undefined;

    locModelLoader: LocModelLoader;
    npcModelLoader: NpcModelLoader;
    playerModelLoader: PlayerModelLoader;

    sceneBuilder: SceneBuilder;

    varManager: VarManager;

    minimapImageRenderer: MinimapImageRenderer;

    npcInstances: NpcInstance[];
};

let workerStatePromise: Promise<WorkerState> | undefined;

function requiredIndexIds(cache: LoadedCache): number[] {
    const ids: number[] = [];
    // Always-needed core indices
    ids.push(
        IndexType.DAT2.configs,
        IndexType.DAT2.sprites,
        IndexType.DAT2.textures,
        IndexType.DAT2.models,
        IndexType.DAT2.maps,
        IndexType.DAT2.animations,
        IndexType.DAT2.skeletons,
    );
    // OSRS skeletal keyframes
    if (cache.info.game === "oldschool" && cache.info.revision >= 229) {
        ids.push(IndexType.OSRS.animKeyFrames);
    }
    // RS2 content tables used in newer RS caches
    if (cache.info.game === "runescape" && cache.info.revision >= 488) {
        ids.push(
            IndexType.RS2.locs,
            IndexType.RS2.npcs,
            IndexType.RS2.objs,
            IndexType.RS2.varbits,
            IndexType.RS2.materials,
        );
    }
    return ids;
}

async function initWorker(cache: LoadedCache, npcInstances: NpcInstance[]): Promise<WorkerState> {
    await compressionPromise;
    await hasherPromise;

    // Structured cloning strips class prototypes; rebuild the presence bitset
    // (its bits are SAB-backed when crossOriginIsolated, so fetches by any
    // context are visible here; otherwise this worker fetches independently).
    const presence = cache.sparse ? new PresenceBitset(cache.sparse.presenceBits) : undefined;
    const cacheSystem = CacheSystem.fromFiles(
        cache.info,
        cache.files,
        requiredIndexIds(cache),
        presence,
    );

    let js5: Pick<Js5RangeClient, "store" | "requestGroup" | "settled"> | undefined;
    if (cache.sparse) {
        const store = cacheSystem.getStore();
        if (store instanceof SparseMemoryStore) {
            const sharedPresence =
                typeof SharedArrayBuffer !== "undefined" &&
                cache.sparse.presenceBits.buffer instanceof SharedArrayBuffer;
            js5 = sharedPresence && cache.sparse.fetchChannel && typeof BroadcastChannel !== "undefined"
                ? new WorkerJs5Coordinator(store, cache.sparse.fetchChannel)
                : new Js5RangeClient(cache.sparse.dat2Url, store);
        }
    }

    const loaderFactory = getCacheLoaderFactory(cache.info, cacheSystem);
    const underlayTypeLoader = loaderFactory.getUnderlayTypeLoader();
    const overlayTypeLoader = loaderFactory.getOverlayTypeLoader();

    const varBitTypeLoader = loaderFactory.getVarBitTypeLoader();

    const locTypeLoader = loaderFactory.getLocTypeLoader();
    const objTypeLoader = loaderFactory.getObjTypeLoader();
    const npcTypeLoader = loaderFactory.getNpcTypeLoader();
    const idkTypeLoader = loaderFactory.getIdkTypeLoader();

    const basTypeLoader = loaderFactory.getBasTypeLoader();

    const modelLoader = loaderFactory.getModelLoader();
    const textureLoader = loaderFactory.getTextureLoader();

    const seqTypeLoader = loaderFactory.getSeqTypeLoader();
    const seqFrameLoader = loaderFactory.getSeqFrameLoader();
    const skeletalSeqLoader = loaderFactory.getSkeletalSeqLoader();

    const mapFileLoader = loaderFactory.getMapFileLoader();

    const varManager = new VarManager(varBitTypeLoader);

    const locModelLoader = new LocModelLoader(
        locTypeLoader,
        modelLoader,
        textureLoader,
        seqTypeLoader,
        seqFrameLoader,
        skeletalSeqLoader,
    );

    const npcModelLoader = new NpcModelLoader(
        npcTypeLoader,
        modelLoader,
        textureLoader,
        seqTypeLoader,
        seqFrameLoader,
        skeletalSeqLoader,
        varManager,
    );
    const playerModelLoader = new PlayerModelLoader(
        idkTypeLoader,
        loaderFactory.getObjTypeLoader(),
        modelLoader,
        textureLoader,
    );

    const sceneBuilder = new SceneBuilder(
        cache.info,
        mapFileLoader,
        underlayTypeLoader,
        overlayTypeLoader,
        locTypeLoader,
        locModelLoader,
        cache.xteas,
    );

    const minimapImageRenderer = new MinimapImageRenderer(
        locTypeLoader,
        loaderFactory.getMapScenes(),
    );

    return {
        cache,
        cacheSystem,
        cacheLoaderFactory: loaderFactory,
        js5,

        locTypeLoader,
        objTypeLoader,
        npcTypeLoader,
        idkTypeLoader,

        seqTypeLoader,
        basTypeLoader,

        textureLoader,
        seqFrameLoader,
        skeletalSeqLoader,

        locModelLoader,
        npcModelLoader,
        playerModelLoader,

        sceneBuilder,

        varManager,

        minimapImageRenderer,

        npcInstances,
    };
}

/**
 * Run a worker task with sparse-cache miss handling. A thrown miss (e.g. a
 * map group) waits for that fetch and reruns. Non-throwing misses (models,
 * anim frames render as gaps and only bump the store's miss counter) are
 * detected by comparing the counter across the run: one pass touches every
 * needed group, queueing all fetches, so waiting for the queue to settle and
 * rerunning converges in a few passes.
 */
async function runWithSparseRetry<T>(workerState: WorkerState, task: () => Promise<T>, profileLabel?: string): Promise<T> {
    const js5 = workerState.js5;
    if (!js5) {
        return task();
    }
    const store = js5.store;
    const maxAttempts = 8;
    for (let attempt = 0; attempt < maxAttempts - 1; attempt++) {
        const missesBefore = store.missCount;
        const passStarted = performance.now();
        try {
            const result = await task();
            if (profileLabel) console.info(`[map-profile] ${profileLabel} pass=${attempt + 1} build=${Math.round(performance.now() - passStarted)}ms misses=${store.missCount - missesBefore}`);
            if (store.missCount === missesBefore) {
                return result;
            }
            // Groups were missing; their fetches are queued. Wait and rerun.
            const waitStarted = performance.now();
            await js5.settled();
            if (profileLabel) console.info(`[map-profile] ${profileLabel} pass=${attempt + 1} cacheWait=${Math.round(performance.now() - waitStarted)}ms`);
        } catch (e) {
            if (!isGroupMissingError(e)) {
                throw e;
            }
            try {
                const waitStarted = performance.now();
                await js5.requestGroup(e.indexId, e.archiveId, true);
                if (profileLabel) console.info(`[map-profile] ${profileLabel} pass=${attempt + 1} blockingGroup=${e.indexId}:${e.archiveId} cacheWait=${Math.round(performance.now() - waitStarted)}ms`);
            } catch (fetchError) {
                // Transient fetch failure; back off and let the next attempt
                // re-queue it rather than failing the whole task.
                console.warn("[js5] Group fetch failed, retrying task:", fetchError);
                await new Promise((resolve) => setTimeout(resolve, 250));
            }
        }
    }
    // Final attempt: whatever is still missing renders as gaps.
    return task();
}

function clearCache(workerState: WorkerState): void {
    workerState.locModelLoader.clearCache();
    workerState.npcModelLoader.clearCache();
    workerState.seqFrameLoader.clearCache();
    workerState.skeletalSeqLoader?.clearCache();
    // Also drop decoded type caches to prevent long-lived growth
    workerState.locTypeLoader.clearCache();
    workerState.objTypeLoader.clearCache();
    workerState.npcTypeLoader.clearCache();
    workerState.idkTypeLoader.clearCache();
}

const worker = {
    setCustomContent(payload: Parameters<typeof loadFromPayload>[0]): void {
        loadFromPayload(payload);
        void workerStatePromise?.then((state) => state.objTypeLoader.clearCache());
    },
    initCache(cache: LoadedCache, npcInstances: NpcInstance[]) {
        workerStatePromise = initWorker(cache, npcInstances);
    },
    initDataLoader<I, D>(dataLoader: RenderDataLoader<I, D>) {
        dataLoader.init();
    },
    resetDataLoader<I, D>(dataLoader: RenderDataLoader<I, D>) {
        dataLoader.reset();
    },
    async load<I, D>(
        dataLoader: RenderDataLoader<I, D>,
        input: I,
    ): Promise<TransferDescriptor<D> | undefined> {
        const workerState = await workerStatePromise;
        if (!workerState) {
            throw new Error("Worker not initialized");
        }

        const mapInput = input as { mapProfileEnabled?: boolean; mapX?: number; mapY?: number };
        const { data, transferables } = await runWithSparseRetry(workerState, () =>
            dataLoader.load(workerState, input),
            mapInput?.mapProfileEnabled ? `${mapInput.mapX},${mapInput.mapY}` : undefined,
        );

        if (dataLoader.shouldClearWorkerCacheAfterLoad?.(input) ?? true) {
            clearCache(workerState);
        }

        if (!data) {
            return undefined;
        }
        return Transfer<D>(data, transferables);
    },
    async loadNpcGeometry(
        mapX: number,
        mapY: number,
        maxLevel: number,
        loadedTextureIds: number[],
        renderBaseTile?: { x: number; y: number },
    ): Promise<TransferDescriptor<NpcGeometryData>> {
        const workerState = await workerStatePromise;
        if (!workerState) {
            throw new Error("Worker not initialized");
        }

        const { data, transferables } = await runWithSparseRetry(workerState, () =>
            npcGeometryLoader.loadNpcGeometry(workerState, {
                mapX,
                mapY,
                maxLevel,
                loadedTextureIds: new Set(loadedTextureIds),
                renderBaseTile,
            }),
        );

        clearCache(workerState);

        return Transfer<NpcGeometryData>(data, transferables);
    },
    async loadTexture(
        id: number,
        size: number,
        flipH: boolean,
        brightness: number,
    ): Promise<TransferDescriptor<Int32Array>> {
        const workerState = await workerStatePromise;
        if (!workerState) {
            throw new Error("Worker not initialized");
        }

        const pixels = workerState.textureLoader.getPixelsArgb(id, size, flipH, brightness);

        return Transfer(pixels, [pixels.buffer]);
    },
    async setNpcInstances(instances: NpcInstance[]): Promise<void> {
        const workerState = await workerStatePromise;
        if (!workerState) {
            throw new Error("Worker not initialized");
        }
        workerState.npcInstances = Array.isArray(instances) ? instances.slice() : [];
    },
    async setVars(values: Int32Array): Promise<void> {
        const workerState = await workerStatePromise;
        if (!workerState) {
            throw new Error("Worker not initialized");
        }
        workerState.varManager.set(values);
    },
    async exportSpritesToZip(): Promise<Blob> {
        const workerState = await workerStatePromise;
        if (!workerState) {
            throw new Error("Worker not initialized");
        }

        const zip = new JSZip();

        const cacheType = workerState.cache.type;

        if (cacheType === "dat2") {
            await exportSpritesToZip(workerState.cacheSystem, zip);
        } else if (cacheType === "dat") {
            await exportDatSpritesToZip(workerState.cacheSystem, zip);
        }

        return zip.generateAsync({ type: "blob" });
    },
    async exportTexturesToZip(): Promise<Blob> {
        const workerState = await workerStatePromise;
        if (!workerState) {
            throw new Error("Worker not initialized");
        }

        const zip = new JSZip();

        const textureLoader = workerState.textureLoader;

        const textureSize = 128;

        for (const id of textureLoader.getTextureIds()) {
            try {
                const pixels = textureLoader.getPixelsArgb(id, textureSize, true, 1.0);

                const canvas = new OffscreenCanvas(textureSize, textureSize);
                const contextOptions: CanvasRenderingContext2DSettings = {
                    willReadFrequently: true,
                };
                const ctx = canvas.getContext("2d", contextOptions)!;

                const imageData = ctx.createImageData(textureSize, textureSize);

                const rgbaPixels = imageData.data;
                for (let i = 0; i < pixels.length; i++) {
                    rgbaPixels[i * 4 + 0] = (pixels[i] >> 16) & 0xff; // R
                    rgbaPixels[i * 4 + 1] = (pixels[i] >> 8) & 0xff; // G
                    rgbaPixels[i * 4 + 2] = pixels[i] & 0xff; // B
                    rgbaPixels[i * 4 + 3] = (pixels[i] >> 24) & 0xff; // A
                }

                ctx.putImageData(imageData, 0, 0);

                const dataUrl = await offscreenCanvasToPng(canvas);

                const pngData = atob(dataUrl.split(",")[1]);
                zip.file(id + ".png", pngData, { binary: true });
            } catch (e) {
                console.error("Failed to export texture", id, e);
            }
        }

        return zip.generateAsync({ type: "blob" });
    },
};

async function offscreenCanvasToPng(canvas: OffscreenCanvas): Promise<string> {
    const blob = await canvas.convertToBlob({ type: "image/png" });

    const reader = new FileReader();

    const dataUrlPromise = new Promise<string>((resolve) => {
        reader.onload = () => {
            resolve(reader.result as string);
        };
    });

    reader.readAsDataURL(blob);

    return await dataUrlPromise;
}

async function addSpritesToZip(zip: JSZip, id: number, sprites: IndexedSprite[]) {
    if (sprites.length > 1) {
        zip = zip.folder(id.toString())!;
    }
    for (let i = 0; i < sprites.length; i++) {
        const sprite = sprites[i];
        sprite.normalize();

        const canvas = sprite.getCanvas();
        const dataUrl = await offscreenCanvasToPng(canvas);

        let fileName = id + ".png";
        if (sprites.length > 1) {
            fileName = i + ".png";
        }

        const pngData = atob(dataUrl.split(",")[1]);
        zip.file(fileName, pngData, { binary: true });
    }
}

async function exportSpritesToZip(cacheSystem: CacheSystem, zip: JSZip): Promise<void> {
    const spriteIndex = cacheSystem.getIndex(IndexType.DAT2.sprites);

    const promises: Promise<any>[] = [];

    for (const id of spriteIndex.getArchiveIds()) {
        const sprites = SpriteLoader.loadIntoIndexedSprites(spriteIndex, id);
        if (!sprites) {
            continue;
        }
        promises.push(addSpritesToZip(zip, id, sprites));
    }

    await Promise.all(promises);
}

async function exportDatSpritesToZip(cacheSystem: CacheSystem, zip: JSZip): Promise<void> {
    const configIndex = cacheSystem.getIndex(IndexType.DAT.configs);
    const mediaArchive = configIndex.getArchive(ConfigType.DAT.media);

    const indexDatId = mediaArchive.getFileId("index.dat");

    const promises: Promise<any>[] = [];

    for (let i = 0; i < mediaArchive.fileIds.length; i++) {
        const fileId = mediaArchive.fileIds[i];
        if (fileId === indexDatId) {
            continue;
        }

        const sprites: IndexedSprite[] = [];
        for (let i = 0; i < 256; i++) {
            try {
                const sprite = SpriteLoader.loadIndexedSpriteDatId(mediaArchive, fileId, i);
                sprites.push(sprite);
            } catch (e) {
                break;
            }
        }
        promises.push(addSpritesToZip(zip, fileId, sprites));
    }

    await Promise.all(promises);
}

export type RenderDataWorker = typeof worker;

expose(worker);
