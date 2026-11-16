import { BIT_MASKS } from "../MathConstants";
import { Archive } from "../cache/Archive";
import { CacheIndex } from "../cache/CacheIndex";
import { CacheInfo } from "../cache/CacheInfo";
import { ByteBuffer } from "../io/ByteBuffer";
import { Type } from "./Type";

export interface TypeLoader<T> {
    load(id: number): T;

    getCount(): number;

    clearCache(): void;
}

export type TypeConstructor<T extends Type> = new (id: number, cacheInfo: CacheInfo) => T;

export class DummyTypeLoader<T extends Type> implements TypeLoader<T> {
    constructor(
        readonly cacheInfo: CacheInfo,
        readonly typeConstructor: TypeConstructor<T>,
    ) {}

    load(id: number): T {
        return new this.typeConstructor(id, this.cacheInfo);
    }

    getCount(): number {
        return 0;
    }

    clearCache(): void {}
}

export abstract class BaseTypeLoader<T extends Type> implements TypeLoader<T> {
    // LRU-bounded cache to avoid unbounded memory growth
    cache: Map<number, T> = new Map();
    // Large enough for the types a busy world keeps using (varbits, items and NPCs are read per
    // tick by packets and plugins); at 4096, hundreds of players kept evicting and re-decoding.
    protected maxCacheSize: number = 16384;
    private readonly lastUse: Map<number, number> = new Map();
    private useClock = 0;

    constructor(
        readonly typeConstructor: TypeConstructor<T>,
        readonly cacheInfo: CacheInfo,
    ) {}

    abstract getDataBuffer(id: number): ByteBuffer | undefined;

    load(id: number): T {
        const cached = this.cache.get(id);
        if (cached) {
            // Recency is a counter per entry, not the map's order: deleting and re-inserting on
            // every hit (a varbit per packet, items per preset) churned the map and cost more
            // than the lookup itself.
            this.lastUse.set(id, ++this.useClock);
            return cached;
        }
        const type = new this.typeConstructor(id, this.cacheInfo);
        try {
            const buffer = this.getDataBuffer(id);
            if (buffer) {
                type.decode(buffer);
                type.post();
            }
        } catch (e) {
            console.error("Failed loading type " + id, e);
        }
        this.cache.set(id, type);
        this.lastUse.set(id, ++this.useClock);
        this.evictIfNeeded();
        return type;
    }

    abstract getCount(): number;

    clearCache(): void {
        this.cache.clear();
        this.lastUse.clear();
    }

    /** When full, drops the least recently used quarter in one pass (not one entry per load). */
    protected evictIfNeeded(): void {
        if (this.cache.size <= this.maxCacheSize) return;
        const keep = this.maxCacheSize - Math.max(1, this.maxCacheSize >> 2);
        const byAge = [...this.lastUse].sort((a, b) => a[1] - b[1]);
        for (let i = 0; i < byAge.length - keep; i++) {
            this.cache.delete(byAge[i][0]);
            this.lastUse.delete(byAge[i][0]);
        }
    }
}

export class ArchiveTypeLoader<T extends Type> extends BaseTypeLoader<T> {
    constructor(
        readonly typeConstructor: TypeConstructor<T>,
        readonly cacheInfo: CacheInfo,
        readonly archive: Archive,
    ) {
        super(typeConstructor, cacheInfo);
    }

    override getDataBuffer(id: number): ByteBuffer | undefined {
        return this.archive.getFile(id)?.getDataAsBuffer();
    }

    /**
     * One past the highest id, as the game sizes its type lists. The archive's file count is
     * smaller when ids have gaps (items do), which hid the last ids from loops over 0..count.
     */
    override getCount(): number {
        return this.archive.lastFileId + 1;
    }
}

export class IndexTypeLoader<T extends Type> extends BaseTypeLoader<T> {
    count: number;

    archives: Map<number, Archive> = new Map();
    // LRU bound for archives cache (decompressed archive data can be large)
    protected maxArchiveCacheSize: number = 256;

    constructor(
        readonly typeConstructor: new (id: number, cacheInfo: CacheInfo) => T,
        readonly cacheInfo: CacheInfo,
        readonly index: CacheIndex,
        readonly fileIdBits: number = 8,
    ) {
        super(typeConstructor, cacheInfo);
        const filesPerArchive = 1 << fileIdBits;
        this.count =
            Math.max((index.getArchiveCount() - 1) * filesPerArchive, 0) +
            index.getFileCount(index.getLastArchiveId());
    }

    override getDataBuffer(id: number): ByteBuffer | undefined {
        const archiveId = id >> this.fileIdBits;
        const fileId = id & BIT_MASKS[this.fileIdBits - 1];

        let archive = this.archives.get(archiveId);
        if (archive) {
            // Touch for LRU semantics
            this.archives.delete(archiveId);
            this.archives.set(archiveId, archive);
        } else {
            archive = this.index.getArchive(archiveId);
            this.archives.set(archiveId, archive);
            this.evictArchivesIfNeeded();
        }
        return archive.getFile(fileId)?.getDataAsBuffer();
    }

    protected evictArchivesIfNeeded(): void {
        while (this.archives.size > this.maxArchiveCacheSize) {
            const k = this.archives.keys().next();
            if (k.done) break;
            this.archives.delete(k.value);
        }
    }

    override getCount(): number {
        return this.count;
    }

    override clearCache(): void {
        super.clearCache();
        this.archives.clear();
    }
}

export class DatTypeLoader<T extends Type> implements TypeLoader<T> {
    static load<T extends Type>(
        typeConstructor: TypeConstructor<T>,
        cacheInfo: CacheInfo,
        configArchive: Archive,
        name: string,
    ): DatTypeLoader<T> {
        const file = configArchive.getFileNamed(name + ".dat");
        if (!file) {
            throw new Error(name + ".dat not found");
        }
        const buffer = file.getDataAsBuffer();

        const count = buffer.readUnsignedShort();
        const types = new Array<T>(count);
        for (let i = 0; i < count; i++) {
            const type = (types[i] = new typeConstructor(i, cacheInfo));
            type.decode(buffer);
            type.post();
        }

        return new DatTypeLoader(types);
    }

    constructor(readonly types: T[]) {}

    load(id: number): T {
        return this.types[id];
    }

    getCount(): number {
        return this.types.length;
    }

    clearCache(): void {}
}

export class IndexedDatTypeLoader<T extends Type> extends BaseTypeLoader<T> {
    static load<T extends Type>(
        typeConstructor: TypeConstructor<T>,
        cacheInfo: CacheInfo,
        configArchive: Archive,
        name: string,
    ): IndexedDatTypeLoader<T> {
        const dataFile = configArchive.getFileNamed(name + ".dat");
        const indexFile = configArchive.getFileNamed(name + ".idx");
        if (!dataFile) {
            throw new Error(name + ".dat not found");
        }
        if (!indexFile) {
            throw new Error(name + ".idx not found");
        }
        const indexBuffer = indexFile.getDataAsBuffer();
        const count = indexBuffer.readUnsignedShort();

        const dataOffsets = new Int32Array(count);

        let offset = indexBuffer.offset;
        for (let i = 0; i < count; i++) {
            dataOffsets[i] = offset;
            offset += indexBuffer.readUnsignedShort();
        }

        return new IndexedDatTypeLoader(
            typeConstructor,
            cacheInfo,
            count,
            dataFile.getDataAsBuffer(),
            dataOffsets,
        );
    }

    constructor(
        typeConstructor: TypeConstructor<T>,
        cacheInfo: CacheInfo,
        readonly count: number,
        readonly dataBuffer: ByteBuffer,
        readonly dataOffsets: Int32Array,
    ) {
        super(typeConstructor, cacheInfo);
    }

    override getDataBuffer(id: number): ByteBuffer | undefined {
        if (id < 0 || id >= this.count) {
            return undefined;
        }
        this.dataBuffer.offset = this.dataOffsets[id];
        return this.dataBuffer;
    }

    getCount(): number {
        return this.count;
    }

    clearCache(): void {}
}
