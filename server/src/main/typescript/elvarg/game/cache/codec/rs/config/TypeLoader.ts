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
    // Conservative default; can be tuned per loader if needed
    protected maxCacheSize: number = 4096;

    constructor(
        readonly typeConstructor: TypeConstructor<T>,
        readonly cacheInfo: CacheInfo,
    ) {}

    abstract getDataBuffer(id: number): ByteBuffer | undefined;

    load(id: number): T {
        const cached = this.cache.get(id);
        if (cached) {
            // Touch for LRU semantics
            this.cache.delete(id);
            this.cache.set(id, cached);
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
        this.evictIfNeeded();
        return type;
    }

    abstract getCount(): number;

    clearCache(): void {
        this.cache.clear();
    }

    protected evictIfNeeded(): void {
        while (this.cache.size > this.maxCacheSize) {
            // Evict oldest entry
            const k = this.cache.keys().next();
            if (k.done) break;
            this.cache.delete(k.value);
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
