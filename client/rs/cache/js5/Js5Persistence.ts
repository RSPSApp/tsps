import { CacheLike, openCache } from "../CacheFiles";
import { Sector } from "../store/Sector";
import type { SparseDat2 } from "../store/SparseDat2";
import { PresenceBitset } from "./PresenceBitset";

const RANGE_SEGMENT = "/range/";
const MANIFEST_SEGMENT = "/range/manifest";
const RANGE_START_HEADER = "Range-Start";
const RANGE_KEY_HEADER = "Range-Key";
const FLUSH_DELAY_MS = 1500;

type SectorRun = { start: number; end: number };
type StoredRange = { start: number; end: number; key: string };

/**
 * Persists on-demand fetched dat2 ranges to the existing CacheStorage/IDB
 * layer so they are never re-downloaded. Entries mirror the resumable
 * downloader's part scheme: one entry per contiguous sector run, keyed
 * `{dat2Path}/range/?s={startSector}&n={count}` with the byte offset in a
 * `Range-Start` header (response URLs are not reliably preserved).
 */
export class Js5Persistence {
    private readonly cachePromise: Promise<CacheLike>;
    private readonly persistedSectors: Uint8Array;
    private pendingRuns: SectorRun[] = [];
    private flushTimer: ReturnType<typeof setTimeout> | undefined;
    private flushChain: Promise<void> = Promise.resolve();
    private storedRanges?: Promise<StoredRange[]>;

    static async readManifest(
        cacheName: string,
        dat2Path: string,
    ): Promise<{ total: number; version: string } | undefined> {
        try {
            const cache = await openCache(cacheName);
            const resp = await cache.match(dat2Path + MANIFEST_SEGMENT);
            if (!resp) {
                return undefined;
            }
            const manifest = (await resp.json()) as { total?: number; version?: string };
            if (typeof manifest.total === "number" && manifest.total > 0) {
                return { total: manifest.total, version: manifest.version ?? "" };
            }
        } catch {}
        return undefined;
    }

    /** Whether a prior session persisted the complete dat2 file. */
    static async hasFullDat2(cacheName: string, dat2Path: string): Promise<boolean> {
        try {
            const cache = await openCache(cacheName);
            return !!(await cache.match(dat2Path));
        } catch {
            return false;
        }
    }

    constructor(
        private readonly cacheName: string,
        private readonly dat2Path: string,
        private readonly buffer: Pick<SparseDat2, "byteLength" | "read">,
    ) {
        this.cachePromise = openCache(cacheName);
        const sectorCount = Math.ceil(buffer.byteLength / Sector.SIZE);
        this.persistedSectors = new Uint8Array((sectorCount + 7) >> 3);
    }

    async writeManifest(version: string): Promise<void> {
        const cache = await this.cachePromise;
        await cache.put(
            this.dat2Path + MANIFEST_SEGMENT,
            new Response(JSON.stringify({ total: this.buffer.byteLength, version }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );
    }

    /** Drop every persisted range (the server's dat2 changed identity). */
    async clearAllRanges(): Promise<void> {
        const cache = await this.cachePromise;
        if (!cache.matchAll) {
            return;
        }
        try {
            const responses = await cache.matchAll(this.dat2Path + RANGE_SEGMENT, {
                ignoreSearch: true,
            });
            for (const resp of responses) {
                const key = resp.headers.get(RANGE_KEY_HEADER);
                if (key) {
                    await cache.delete(key);
                }
            }
        } catch (e) {
            console.warn("[js5] Failed clearing persisted ranges:", e);
        }
    }

    /** Load all persisted ranges, applying each; returns total bytes restored. */
    async restore(apply: (byteOffset: number, bytes: Uint8Array) => void): Promise<number> {
        const cache = await this.cachePromise;
        if (!cache.matchAll) {
            return 0;
        }
        let restored = 0;
        try {
            const responses = await cache.matchAll(this.dat2Path + RANGE_SEGMENT, {
                ignoreSearch: true,
            });
            for (const resp of responses) {
                const startHeader = resp.headers.get(RANGE_START_HEADER);
                if (startHeader === null) {
                    continue;
                }
                const byteOffset = Number(startHeader);
                if (!Number.isInteger(byteOffset) || byteOffset < 0) {
                    continue;
                }
                const bytes = new Uint8Array(await resp.arrayBuffer());
                apply(byteOffset, bytes);
                this.markPersisted(byteOffset, bytes.byteLength);
                restored += bytes.byteLength;
            }
        } catch (e) {
            console.warn("[js5] Failed restoring persisted ranges:", e);
        }
        return restored;
    }

    /**
     * The bytes at [offset, offset + length) from ranges an earlier session stored, or undefined
     * when they do not cover the request. A device that skips restore() (a phone's or a tablet's
     * tab cannot hold everything ever fetched) reads them back from disk, not the network.
     */
    async read(offset: number, length: number): Promise<Uint8Array | undefined> {
        try {
            const parts: Blob[] = [];
            let cursor = offset;
            for (const range of await this.stored()) {
                if (range.end <= cursor) continue;
                if (range.start > cursor) return undefined;
                const resp = await (await this.cachePromise).match(range.key);
                if (!resp) return undefined;
                // Read only the needed slices; a batch can span several earlier flushes.
                const end = Math.min(offset + length, range.end);
                const part = (await resp.blob()).slice(cursor - range.start, end - range.start);
                if (part.size !== end - cursor) return undefined;
                parts.push(part);
                cursor = end;
                if (cursor === offset + length) {
                    return new Uint8Array(await (parts.length === 1 ? parts[0] : new Blob(parts)).arrayBuffer());
                }
            }
            return undefined;
        } catch {
            return undefined;
        }
    }

    /**
     * Every stored range, without reading its bytes; also marks their sectors persisted, so a
     * session that skipped restore() does not store them again.
     */
    private stored(): Promise<StoredRange[]> {
        this.storedRanges ??= (async () => {
            const cache = await this.cachePromise;
            if (!cache.matchAll) return [];
            const ranges: StoredRange[] = [];
            try {
                for (const resp of await cache.matchAll(this.dat2Path + RANGE_SEGMENT, { ignoreSearch: true })) {
                    const start = Number(resp.headers.get(RANGE_START_HEADER));
                    const length = Number(resp.headers.get("Content-Length"));
                    const key = resp.headers.get(RANGE_KEY_HEADER);
                    void resp.body?.cancel();
                    if (!key || !Number.isInteger(start) || start < 0 || !(length > 0)) continue;
                    ranges.push({ start, end: start + length, key });
                    this.markPersisted(start, length);
                }
            } catch (e) {
                console.warn("[js5] Failed listing persisted ranges:", e);
            }
            return ranges.sort((a, b) => a.start - b.start || b.end - a.end);
        })();
        return this.storedRanges;
    }

    /** Queue a fetched byte range for persistence (write-behind, coalesced). */
    queue(byteOffset: number, byteLength: number): void {
        const start = Math.floor(byteOffset / Sector.SIZE);
        const endByte = Math.min(byteOffset + byteLength, this.buffer.byteLength);
        const end =
            endByte >= this.buffer.byteLength
                ? Math.ceil(endByte / Sector.SIZE)
                : Math.floor(endByte / Sector.SIZE);
        if (end <= start || this.isRunPersisted(start, end)) {
            return;
        }
        this.pendingRuns.push({ start, end });
        this.scheduleFlush();
    }

    /**
     * Queue every present-but-unpersisted sector. In crossOriginIsolated
     * contexts worker fetches land in the shared buffer without notifying the
     * main thread; a periodic sweep picks those up for persistence.
     */
    sweep(presence: PresenceBitset): void {
        const sectorCount = Math.ceil(this.buffer.byteLength / Sector.SIZE);
        const presentBits = presence.bits;
        const byteCount = Math.min(presentBits.length, this.persistedSectors.length);
        let runStart = -1;
        let queued = false;
        for (let i = 0; i < byteCount; i++) {
            // Byte-wise fast path: skip the (usual) case of nothing new.
            const diff = presentBits[i] & ~this.persistedSectors[i];
            if (diff === 0) {
                if (runStart >= 0) {
                    this.pendingRuns.push({ start: runStart, end: i * 8 });
                    runStart = -1;
                    queued = true;
                }
                continue;
            }
            for (let b = 0; b < 8; b++) {
                const s = i * 8 + b;
                if (s >= sectorCount) {
                    break;
                }
                if ((diff >> b) & 1) {
                    if (runStart < 0) {
                        runStart = s;
                    }
                } else if (runStart >= 0) {
                    this.pendingRuns.push({ start: runStart, end: s });
                    runStart = -1;
                    queued = true;
                }
            }
        }
        if (runStart >= 0) {
            this.pendingRuns.push({ start: runStart, end: sectorCount });
            queued = true;
        }
        if (queued) {
            this.scheduleFlush();
        }
    }

    private scheduleFlush(): void {
        if (this.flushTimer === undefined) {
            this.flushTimer = setTimeout(() => {
                this.flushTimer = undefined;
                this.flush();
            }, FLUSH_DELAY_MS);
        }
    }

    flush(): Promise<void> {
        const runs = this.mergePendingRuns();
        this.pendingRuns = [];
        if (runs.length === 0) {
            return this.flushChain;
        }
        this.flushChain = this.flushChain.then(async () => {
            const cache = await this.cachePromise;
            await this.stored();
            for (const run of runs) {
                try {
                    await this.persistRun(cache, run);
                } catch (e) {
                    console.warn("[js5] Failed persisting range:", e);
                }
            }
        }).catch((e) => {
            console.warn("[js5] Failed persisting ranges:", e);
        });
        return this.flushChain;
    }

    private async persistRun(cache: CacheLike, run: SectorRun): Promise<void> {
        // Trim sectors persisted by an earlier flush or session.
        let { start, end } = run;
        while (start < end && this.isSectorPersisted(start)) {
            start++;
        }
        while (end > start && this.isSectorPersisted(end - 1)) {
            end--;
        }
        if (end <= start) {
            return;
        }
        const startByte = start * Sector.SIZE;
        const endByte = Math.min(end * Sector.SIZE, this.buffer.byteLength);
        const copy = this.buffer.read(startByte, endByte - startByte);

        const url = `${this.dat2Path}${RANGE_SEGMENT}?s=${start}&n=${end - start}`;
        const resp = new Response(copy, {
            status: 200,
            headers: {
                "Content-Type": "application/octet-stream",
                "Content-Length": copy.byteLength.toString(),
                [RANGE_START_HEADER]: startByte.toString(),
                [RANGE_KEY_HEADER]: url,
            },
        });
        try {
            Object.defineProperty(resp, "url", { value: url });
        } catch {}
        await cache.put(url, resp);
        this.markPersisted(startByte, endByte - startByte);
    }

    private mergePendingRuns(): SectorRun[] {
        if (this.pendingRuns.length === 0) {
            return [];
        }
        const sorted = [...this.pendingRuns].sort((a, b) => a.start - b.start);
        const merged: SectorRun[] = [sorted[0]];
        for (let i = 1; i < sorted.length; i++) {
            const last = merged[merged.length - 1];
            if (sorted[i].start <= last.end) {
                last.end = Math.max(last.end, sorted[i].end);
            } else {
                merged.push({ ...sorted[i] });
            }
        }
        return merged;
    }

    private markPersisted(byteOffset: number, byteLength: number): void {
        const start = Math.floor(byteOffset / Sector.SIZE);
        const endByte = Math.min(byteOffset + byteLength, this.buffer.byteLength);
        const end =
            endByte >= this.buffer.byteLength
                ? Math.ceil(endByte / Sector.SIZE)
                : Math.floor(endByte / Sector.SIZE);
        for (let s = start; s < end; s++) {
            this.persistedSectors[s >> 3] |= 1 << (s & 7);
        }
    }

    private isSectorPersisted(sector: number): boolean {
        return (this.persistedSectors[sector >> 3] & (1 << (sector & 7))) !== 0;
    }

    private isRunPersisted(start: number, end: number): boolean {
        for (let s = start; s < end; s++) {
            if (!this.isSectorPersisted(s)) {
                return false;
            }
        }
        return true;
    }
}
