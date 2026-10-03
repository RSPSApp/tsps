import { isSafari } from "../common/utils/DeviceUtil";
import { getCacheBaseUrl } from "../config/clientEnv";
import { CacheFiles, ProgressListener } from "../rs/cache/CacheFiles";
import { CacheInfo, getLatestCache } from "../rs/cache/CacheInfo";
import { CacheType, detectCacheType } from "../rs/cache/CacheType";
import { IndexType } from "../rs/cache/IndexType";
import { validatePartialContentResponse } from "../rs/cache/js5/HttpRange";
import { Js5Persistence } from "../rs/cache/js5/Js5Persistence";
import { PresenceBitset } from "../rs/cache/js5/PresenceBitset";
import { Sector } from "../rs/cache/store/Sector";
import { SectorCluster } from "../rs/cache/store/SectorCluster";
import { SparseMemoryStore, computeIndexRegion } from "../rs/cache/store/SparseMemoryStore";

const CACHE_PATH = getCacheBaseUrl();

function shouldSkipDat2MainCacheWrite(): boolean {
    return isSafari;
}

export function canUseSharedArrayBuffer(): boolean {
    // Safari/WebKit throws "Unable to convert chunk to Uint8Array" when assembling
    // large downloads into SharedArrayBuffer-backed views. Use plain ArrayBuffers.
    if (isSafari) return false;
    return typeof SharedArrayBuffer !== "undefined" && globalThis.crossOriginIsolated === true;
}

/** Maps DAT2 index IDs to human-readable names for loading display */
const INDEX_NAMES: Record<number, string> = {
    [IndexType.DAT2.animations]: "animations",
    [IndexType.DAT2.skeletons]: "skeletons",
    [IndexType.DAT2.configs]: "config",
    [IndexType.DAT2.interfaces]: "interfaces",
    [IndexType.DAT2.soundEffects]: "sound effects",
    [IndexType.DAT2.maps]: "maps",
    [IndexType.DAT2.musicTracks]: "music tracks",
    [IndexType.DAT2.models]: "models",
    [IndexType.DAT2.sprites]: "sprites",
    [IndexType.DAT2.textures]: "textures",
    [IndexType.DAT2.binary]: "binary",
    [IndexType.DAT2.musicJingles]: "music jingles",
    [IndexType.DAT2.clientScript]: "scripts",
    [IndexType.DAT2.fonts]: "fonts",
    [IndexType.DAT2.musicSamples]: "music samples",
    [IndexType.DAT2.musicPatches]: "music patches",
    [IndexType.OSRS.animKeyFrames]: "animation keyframes",
    [IndexType.OSRS.worldMapGeography]: "world map geography",
    [IndexType.OSRS.worldMap]: "world map",
    [IndexType.OSRS.worldMapGround]: "world map ground",
};

/** Get display name for an index ID */
export function getIndexName(indexId: number): string {
    const name = INDEX_NAMES[indexId];
    return name !== undefined ? name : `index ${indexId}`;
}

export async function fetchCacheInfos(): Promise<CacheInfo[]> {
    const resp = await fetch(CACHE_PATH + "caches.json");
    return resp.json();
}

export type CacheList = {
    caches: CacheInfo[];
    latest: CacheInfo;
};

export async function fetchCacheList(): Promise<CacheList | undefined> {
    const caches = await fetchCacheInfos();
    const latest = getLatestCache(caches);
    if (!latest) {
        return undefined;
    }
    return {
        caches,
        latest,
    };
}

/**
 * Structured-clone friendly state describing a sparsely-downloaded dat2
 * (survives postMessage to workers; the presence bits are SAB-backed when
 * crossOriginIsolated so all contexts observe fetches).
 */
export type SparseCacheState = {
    presenceBits: Uint8Array;
    dat2Url: string;
    /** Per-client channel used to centralise worker group misses in the main thread. */
    fetchChannel?: string;
};

export type LoadedCache = {
    info: CacheInfo;
    type: CacheType;
    files: CacheFiles;
    xteas: XteaMap;
    /** Present when the cache was loaded sparsely (on-demand js5-style loading). */
    sparse?: SparseCacheState;
};

/** Main-thread-only companions of a sparse LoadedCache (not clonable to workers). */
const sparsePersistenceByCache = new WeakMap<LoadedCache, Js5Persistence>();
const sparsePrefetchByCache = new WeakMap<LoadedCache, () => void>();

export function getSparsePersistence(cache: LoadedCache): Js5Persistence | undefined {
    return sparsePersistenceByCache.get(cache);
}

/** Start deferred bulk warming only after the first playable scene is visible. */
export function startSparsePrefetch(cache: LoadedCache | undefined): void {
    if (!cache) return;
    const start = sparsePrefetchByCache.get(cache);
    if (!start) return;
    sparsePrefetchByCache.delete(cache);
    start();
}

export async function loadCacheFiles(
    info: CacheInfo,
    signal?: AbortSignal,
    progressListener?: ProgressListener,
    extraIndexIds?: number[],
): Promise<LoadedCache> {
    const cachePath = CACHE_PATH + info.name + "/";

    const xteasPromise = fetchXteas(cachePath + "keys.json", signal);

    const cacheType = detectCacheType(info);
    // Use SharedArrayBuffer only when it's truly available and the context is isolated.
    const useSharedArrayBuffer = canUseSharedArrayBuffer();
    let files: CacheFiles;
    if (cacheType === "dat2") {
        // Safari/WebKit can crash tab processes when writing huge dat2 blobs to CacheStorage.
        // Keep downloading dat2, but skip persisting that one file on Safari for stability.
        const skipDat2MainCacheWrite = shouldSkipDat2MainCacheWrite();
        if (skipDat2MainCacheWrite) {
            console.log(
                "[storage] Safari/WebKit detected: skipping final dat2 cache write to avoid tab crashes; keeping resumable part cache",
            );
        }
        const indicesToLoad = getRequiredIndexIds(info);
        if (extraIndexIds && extraIndexIds.length) {
            for (const id of extraIndexIds) if (!indicesToLoad.includes(id)) indicesToLoad.push(id);
        }
        files = await CacheFiles.fetchDat2(
            cachePath,
            info.name,
            indicesToLoad,
            useSharedArrayBuffer,
            signal,
            progressListener,
            undefined,
            skipDat2MainCacheWrite,
        );
    } else if (cacheType === "dat") {
        files = await CacheFiles.fetchDat(
            cachePath,
            info.name,
            useSharedArrayBuffer,
            signal,
            progressListener,
        );
    } else {
        files = await CacheFiles.fetchLegacy(
            cachePath,
            info.name,
            useSharedArrayBuffer,
            signal,
            progressListener,
        );
    }

    const xteas = await xteasPromise;

    return {
        info,
        type: cacheType,
        files,
        xteas,
    };
}

/** Get the list of required index IDs for a cache */
function getRequiredIndexIds(info: CacheInfo): number[] {
    const ids: number[] = [];
    // Core indices used by renderer and minimap generation
    ids.push(
        IndexType.DAT2.configs,
        IndexType.DAT2.sprites,
        IndexType.DAT2.textures,
        IndexType.DAT2.models,
        IndexType.DAT2.maps,
        IndexType.DAT2.animations,
        IndexType.DAT2.skeletons,
        // public chat uses the Huffman table stored in the binary index (idx10).
        IndexType.DAT2.binary,
        IndexType.DAT2.soundEffects, // For audio playback
        IndexType.DAT2.musicTracks, // Required for MusicSystem + RealtimeMidiSynth
        IndexType.DAT2.musicSamples, // Needed for music patch playback
        IndexType.DAT2.musicPatches, // Needed for music patch playback
        IndexType.DAT2.musicJingles, // Short fanfares; harmless to load
    );
    // OSRS skeletal keyframes (>=229)
    if (info.game === "oldschool" && info.revision >= 229) {
        ids.push(IndexType.OSRS.animKeyFrames);
    }
    if (info.game === "oldschool") {
        ids.push(
            IndexType.OSRS.worldMapGeography,
            IndexType.OSRS.worldMap,
            IndexType.OSRS.worldMapGround,
        );
    }
    // RS newer indices for content types
    if (info.game === "runescape" && info.revision >= 488) {
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

/**
 * Indices whose group payloads are fetched on demand during gameplay instead
 * of downloaded upfront. Their reference tables (idx255 meta region) are still
 * loaded eagerly, so ids/names/CRCs resolve immediately — only payloads
 * stream in when first used. Together these are ~170MB of the ~204MB cache.
 *
 * idx5 (maps) is deliberately NOT here: it is only ~11MB and packed
 * contiguously, so bulk-loading it costs ~3s once, while deferring it cost two
 * blocking round trips *and* a full scene rebuild per map square.
 */
function getDeferredIndexIds(info: CacheInfo): number[] {
    if (info.game !== "oldschool") {
        return [];
    }
    return [
        IndexType.DAT2.animations,
        IndexType.DAT2.soundEffects,
        IndexType.DAT2.musicTracks,
        IndexType.DAT2.models,
        IndexType.DAT2.musicSamples,
        // idx19 (worldMap structure, 0.6MB) stays eager: WorldMapState.load
        // reads it synchronously during startup. Geography/ground pixels defer.
        IndexType.OSRS.worldMapGeography,
        IndexType.OSRS.worldMapGround,
        IndexType.OSRS.animKeyFrames,
    ];
}

/**
 * Deferred indices worth bulk-downloading in the background once the login
 * screen is up. Their groups are tiny and scattered (idx7 averages ~1KB across
 * 60k groups spread over 77MB), so fetching them on demand costs one full
 * round trip each — hundreds per map square, which is what makes a cold login
 * spend ~30s in a black world. Streaming them at bulk throughput instead
 * removes those round trips entirely, and Js5Persistence keeps them.
 */
function getPrefetchIndexIds(info: CacheInfo): number[] {
    return info.game === "oldschool"
        ? [IndexType.DAT2.models, IndexType.DAT2.animations]
        : [];
}

/** `?noPrefetch=1` disables the background bulk prefetch (on-demand only). */
function isPrefetchDisabled(): boolean {
    try {
        const loc = (globalThis as { location?: Location }).location;
        return !!loc && new URLSearchParams(loc.search).get("noPrefetch") === "1";
    } catch {
        return false;
    }
}

/** `?fullCache=1` forces the legacy full-download path. */
export function isFullCacheForced(): boolean {
    try {
        const loc = (globalThis as { location?: Location }).location;
        if (!loc) {
            return false;
        }
        return new URLSearchParams(loc.search).get("fullCache") === "1";
    } catch {
        return false;
    }
}

/**
 * Load the cache sparsely when possible (OSRS dat2 over a Range-supporting
 * server), falling back to the legacy full download otherwise.
 */
export async function loadCacheFilesAuto(
    info: CacheInfo,
    signal?: AbortSignal,
    progressListener?: ProgressListener,
    extraIndexIds?: number[],
): Promise<LoadedCache> {
    const cacheType = detectCacheType(info);
    if (!isFullCacheForced() && cacheType === "dat2" && info.game === "oldschool") {
        try {
            const sparse = await loadCacheFilesSparse(info, signal, progressListener);
            if (sparse) {
                return sparse;
            }
        } catch (e) {
            if (signal?.aborted) {
                throw e;
            }
            console.warn("[js5] Sparse cache load failed, falling back to full download:", e);
        }
    }
    return loadCacheFiles(info, signal, progressListener, extraIndexIds);
}

type SectorRun = { start: number; end: number };

function mergeSectorRuns(runs: SectorRun[], gapTolerance: number = 16): SectorRun[] {
    if (runs.length === 0) {
        return [];
    }
    const sorted = [...runs].sort((a, b) => a.start - b.start);
    const merged: SectorRun[] = [{ ...sorted[0] }];
    for (let i = 1; i < sorted.length; i++) {
        const last = merged[merged.length - 1];
        if (sorted[i].start <= last.end + gapTolerance) {
            last.end = Math.max(last.end, sorted[i].end);
        } else {
            merged.push({ ...sorted[i] });
        }
    }
    return merged;
}

/** Split runs into the subruns whose sectors are not yet present. */
function subtractPresentSectors(runs: SectorRun[], presence: PresenceBitset): SectorRun[] {
    const missing: SectorRun[] = [];
    for (const run of runs) {
        let subStart = -1;
        for (let s = run.start; s <= run.end; s++) {
            const absent = s < run.end && !presence.hasSectors(s, 1);
            if (absent && subStart < 0) {
                subStart = s;
            } else if (!absent && subStart >= 0) {
                missing.push({ start: subStart, end: s });
                subStart = -1;
            }
        }
    }
    return missing;
}

/** Returns the number of bytes actually delivered (may be short on truncation). */
async function fetchRangeStreaming(
    url: string,
    startByte: number,
    endByte: number,
    buffer: ArrayBuffer,
    signal: AbortSignal | undefined,
    onChunk: (byteLength: number) => void,
): Promise<number> {
    const resp = await fetch(url, {
        headers: { Range: `bytes=${startByte}-${endByte - 1}` },
        signal,
    });
    if (resp.status !== 206) {
        try {
            resp.body?.cancel();
        } catch {}
        throw new Error(`Range fetch failed (${resp.status}) for ${url}`);
    }
    validatePartialContentResponse(resp, startByte, endByte, url);
    const target = new Uint8Array(buffer);
    let offset = startByte;
    if (!resp.body) {
        const data = new Uint8Array(await resp.arrayBuffer());
        const chunk = data.subarray(0, endByte - offset);
        target.set(chunk, offset);
        onChunk(chunk.byteLength);
        return chunk.byteLength;
    }
    const reader = resp.body.getReader();
    for (let res = await reader.read(); !res.done && res.value; res = await reader.read()) {
        const chunk = res.value.subarray(0, Math.max(0, endByte - offset));
        target.set(chunk, offset);
        offset += chunk.byteLength;
        onChunk(chunk.byteLength);
    }
    return offset - startByte;
}

/**
 * Keep background chunks short: foreground map/model misses must get a chance
 * to use the connection between them.
 */
const PREFETCH_CHUNK_SECTORS = Math.ceil((512 * 1024) / Sector.SIZE);
// Don't compete with the first scene's foreground JS5 reads.
/**
 * Stream whole deferred index regions into the sparse buffer in the background.
 * Writes land in the shared buffer and presence bitset, so render workers pick
 * them up with no message passing and simply stop missing.
 *
 * Best-effort: on any failure the on-demand Js5RangeClient still services reads.
 */
export async function prefetchIndexRegions(
    dat2Path: string,
    buffer: ArrayBuffer,
    totalSize: number,
    presence: PresenceBitset,
    persistence: Pick<Js5Persistence, "queue">,
    idxDatas: Map<number, ArrayBuffer>,
    indexIds: number[],
    signal?: AbortSignal,
): Promise<void> {
    const totalSectors = Math.ceil(totalSize / Sector.SIZE);
    const regions: SectorRun[] = [];
    for (const id of indexIds) {
        const data = idxDatas.get(id);
        if (!data) {
            continue;
        }
        const region = computeIndexRegion(data);
        if (!region || region.endSector > totalSectors) {
            continue;
        }
        regions.push({ start: region.startSector, end: region.endSector });
    }

    const started = performance.now();
    let fetchedBytes = 0;
    for (const run of mergeSectorRuns(regions)) {
        for (let start = run.start; start < run.end; start += PREFETCH_CHUNK_SECTORS) {
            if (signal?.aborted) {
                return;
            }
            const end = Math.min(start + PREFETCH_CHUNK_SECTORS, run.end);
            // Already covered by a previous session or an on-demand fetch.
            if (presence.hasSectors(start, end - start)) {
                continue;
            }
            const startByte = start * Sector.SIZE;
            const endByte = Math.min(end * Sector.SIZE, totalSize);
            const delivered = await fetchRangeStreaming(
                dat2Path,
                startByte,
                endByte,
                buffer,
                signal,
                () => {},
            );
            // Mark only whole sectors actually delivered, as the eager path does.
            const deliveredSectors =
                startByte + delivered >= totalSize
                    ? Math.ceil(delivered / Sector.SIZE)
                    : Math.floor(delivered / Sector.SIZE);
            presence.markSectors(start, deliveredSectors);
            persistence.queue(startByte, deliveredSectors * Sector.SIZE);
            fetchedBytes += delivered;
        }
    }
    const seconds = (performance.now() - started) / 1000;
    console.log(
        `[js5] Background prefetch done: ${(fetchedBytes / 1048576).toFixed(1)}MB ` +
            `in ${seconds.toFixed(1)}s (indices ${indexIds.join(",")})`,
    );
}

/**
 * Sparse startup: download only the idx files, the reference tables and the
 * eager index regions (~33MB, maps included) via Range requests into a
 * full-size sparse dat2 buffer. Deferred groups (models, animations, audio,
 * worldmap) are fetched on demand by the Js5RangeClient and persisted so they
 * are only ever downloaded once; the biggest of those are also pulled in bulk
 * in the background by prefetchIndexRegions.
 */
async function loadCacheFilesSparse(
    info: CacheInfo,
    signal?: AbortSignal,
    progressListener?: ProgressListener,
): Promise<LoadedCache | undefined> {
    const cachePath = CACHE_PATH + info.name + "/";
    const dat2Path = cachePath + CacheFiles.DAT2_FILE_NAME;

    // A prior session already stored the complete dat2; the regular path
    // restores it from storage without any network traffic.
    if (await Js5Persistence.hasFullDat2(info.name, dat2Path)) {
        return undefined;
    }

    const xteasPromise = fetchXteas(cachePath + "keys.json", signal);
    const useSharedArrayBuffer = canUseSharedArrayBuffer();

    const report = (current: number, total: number, label: string) => {
        progressListener?.({ total, current, part: new Uint8Array(0), label });
    };

    // Index files (all small): meta first to learn the index count.
    report(0, 1, "Loading index");
    const metaData = await CacheFiles.fetchSingleIndex(
        cachePath,
        info.name,
        255,
        useSharedArrayBuffer,
        signal,
    );
    if (!metaData) {
        return undefined;
    }
    const indexCount = Math.floor(metaData.byteLength / SectorCluster.SIZE);
    // Only fetch idx files for indices whose reference table exists in the
    // meta file — requesting a missing file gets the SPA's index.html back
    // with status 200, which would then be parsed as garbage idx entries.
    const metaBytes = new Uint8Array(metaData);
    const indexIds: number[] = [];
    for (let id = 0; id < indexCount; id++) {
        const off = id * SectorCluster.SIZE;
        const size = (metaBytes[off] << 16) | (metaBytes[off + 1] << 8) | metaBytes[off + 2];
        const sector = (metaBytes[off + 3] << 16) | (metaBytes[off + 4] << 8) | metaBytes[off + 5];
        if (size > 0 && sector > 0) {
            indexIds.push(id);
        }
    }
    const idxDatas = new Map<number, ArrayBuffer>();
    await Promise.all(
        indexIds.map(async (id) => {
            const data = await CacheFiles.fetchSingleIndex(
                cachePath,
                info.name,
                id,
                useSharedArrayBuffer,
                signal,
            );
            if (data) {
                idxDatas.set(id, data);
            }
        }),
    );
    if (idxDatas.size !== indexIds.length) {
        // A missing idx file would silently produce a cache without that
        // index; fall back to the full download path instead.
        console.warn(
            `[js5] Only ${idxDatas.size}/${indexIds.length} idx files loaded; using full download`,
        );
        return undefined;
    }

    // dat2 size and identity — doubles as the Range-support probe.
    const probe = await fetch(dat2Path, { headers: { Range: "bytes=0-0" }, signal });
    if (probe.status !== 206) {
        try {
            probe.body?.cancel();
        } catch {}
        console.warn(
            `[js5] Server does not support Range requests (status ${probe.status}); using full download`,
        );
        return undefined;
    }
    let probeRange;
    try {
        probeRange = validatePartialContentResponse(probe, 0, 1, dat2Path);
    } finally {
        try {
            probe.body?.cancel();
        } catch {}
    }
    const totalSize = probeRange.total ?? 0;
    if (!Number.isFinite(totalSize) || totalSize <= 0) {
        return undefined;
    }
    const dat2Version =
        probe.headers.get("ETag") ?? probe.headers.get("Last-Modified") ?? String(totalSize);

    const buffer = (
        useSharedArrayBuffer ? new SharedArrayBuffer(totalSize) : new ArrayBuffer(totalSize)
    ) as ArrayBuffer;
    const presence = PresenceBitset.forSectorCount(
        Math.ceil(totalSize / Sector.SIZE),
        useSharedArrayBuffer,
    );
    const totalSectors = Math.ceil(totalSize / Sector.SIZE);
    const files = new Map<string, ArrayBuffer>();
    files.set(CacheFiles.DAT2_FILE_NAME, buffer);
    files.set(CacheFiles.META_FILE_NAME, metaData);
    for (const [id, data] of idxDatas) {
        files.set(CacheFiles.INDEX_FILE_PREFIX + id, data);
    }
    const cacheFiles = new CacheFiles(files);
    const store = SparseMemoryStore.fromSparseFiles(cacheFiles, presence);
    const persistence = new Js5Persistence(info.name, dat2Path, buffer);

    // Persisted ranges only apply to the exact dat2 they were fetched from; a
    // repacked/updated file relocates groups, so stale ranges must be dropped.
    const manifest = await Js5Persistence.readManifest(info.name, dat2Path);
    if (manifest && (manifest.total !== totalSize || manifest.version !== dat2Version)) {
        console.warn("[js5] Server dat2 changed; clearing persisted ranges");
        await persistence.clearAllRanges();
    }
    await persistence.writeManifest(dat2Version);

    // Restore ranges fetched in previous sessions.
    const restored = await persistence.restore((offset, bytes) => store.applyRange(offset, bytes));

    // Eager regions: reference tables (idx255 meta region) + every
    // non-deferred index. Deferred indices only need their reference tables.
    const deferred = new Set(getDeferredIndexIds(info));
    const regions: SectorRun[] = [];
    const metaRegion = computeIndexRegion(metaData);
    if (metaRegion) {
        regions.push({ start: metaRegion.startSector, end: metaRegion.endSector });
    }
    for (const [id, data] of idxDatas) {
        if (deferred.has(id)) {
            continue;
        }
        const region = computeIndexRegion(data);
        if (!region) {
            continue;
        }
        if (region.endSector > totalSectors) {
            // Corrupt idx data (e.g. an HTML error page); ignore it.
            console.warn(`[js5] Index ${id} region exceeds dat2 size; skipping eager load`);
            continue;
        }
        regions.push({ start: region.startSector, end: region.endSector });
    }

    const missing = subtractPresentSectors(mergeSectorRuns(regions), presence);
    let toFetch = 0;
    for (const run of missing) {
        toFetch += Math.min(run.end * Sector.SIZE, totalSize) - run.start * Sector.SIZE;
    }
    let fetchedBytes = 0;
    const onEagerChunk = (byteLength: number) => {
        fetchedBytes += byteLength;
        report(fetchedBytes, toFetch, "Loading assets");
    };
    report(0, Math.max(toFetch, 1), "Loading assets");
    for (const run of missing) {
        const startByte = run.start * Sector.SIZE;
        const endByte = Math.min(run.end * Sector.SIZE, totalSize);
        const delivered = await fetchRangeStreaming(
            dat2Path,
            startByte,
            endByte,
            buffer,
            signal,
            onEagerChunk,
        );
        // Mark/persist only complete sectors actually delivered — a truncated
        // response must not poison the presence map or the persisted ranges.
        const deliveredSectors =
            startByte + delivered >= totalSize
                ? Math.ceil(delivered / Sector.SIZE)
                : Math.floor(delivered / Sector.SIZE);
        presence.markSectors(run.start, deliveredSectors);
        persistence.queue(startByte, deliveredSectors * Sector.SIZE);
        if (delivered < endByte - startByte) {
            throw new Error(
                `Truncated range response for ${dat2Path}: got ${delivered} of ${endByte - startByte} bytes`,
            );
        }
    }
    persistence.flush();

    const loaded: LoadedCache = {
        info,
        type: "dat2",
        files: cacheFiles,
        xteas: await xteasPromise,
        sparse: {
            presenceBits: presence.bits,
            dat2Url: dat2Path,
            fetchChannel: `rsps-js5-${Math.random().toString(36).slice(2)}`,
        },
    };
    sparsePersistenceByCache.set(loaded, persistence);

    // Warm deferred groups only after the first scene is visible. A timer is
    // wrong here: users can remain at the login screen long enough for it to
    // compete with their initial map requests.
    // ponytail: only helps the current session when the buffer is SAB-backed
    // (crossOriginIsolated); without it workers hold private copies and only
    // benefit from session 2 via Js5Persistence. Fix by routing worker misses
    // through the main thread's Js5RangeClient if Safari startup matters.
    const prefetchIds = isPrefetchDisabled() ? [] : getPrefetchIndexIds(info);
    if (prefetchIds.length > 0) {
        const startPrefetch = () => {
            if (signal?.aborted) return;
            void prefetchIndexRegions(
                dat2Path,
                buffer,
                totalSize,
                presence,
                persistence,
                idxDatas,
                prefetchIds,
                signal,
            ).catch((e) => {
                if (!signal?.aborted) {
                    console.warn("[js5] Background prefetch failed:", e);
                }
            });
        };
        sparsePrefetchByCache.set(loaded, startPrefetch);
    }

    console.log(
        `[js5] Sparse cache ready: downloaded ${(fetchedBytes / 1048576).toFixed(1)}MB eager, ` +
            `restored ${(restored / 1048576).toFixed(1)}MB persisted, ` +
            `deferring ${Array.from(deferred).join(",")} (${(totalSize / 1048576).toFixed(0)}MB total)`,
    );
    return loaded;
}

export type XteaMap = Map<number, number[]>;

export async function fetchXteas(url: RequestInfo, signal?: AbortSignal): Promise<XteaMap> {
    const resp = await fetch(url, {
        signal,
    });
    const data: Record<string, number[]> = await resp.json();
    return new Map(Object.keys(data).map((key) => [parseInt(key), data[key]]));
}
