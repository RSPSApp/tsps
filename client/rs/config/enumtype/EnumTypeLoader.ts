import { Archive } from "../../cache/Archive";
import { CacheIndex } from "../../cache/CacheIndex";
import { CacheInfo } from "../../cache/CacheInfo";
import { ArchiveTypeLoader, IndexTypeLoader, TypeLoader } from "../TypeLoader";
import { EnumType } from "./EnumType";

export type EnumTypeLoader = TypeLoader<EnumType>;

export class ArchiveEnumTypeLoader extends ArchiveTypeLoader<EnumType> implements EnumTypeLoader {
    constructor(cacheInfo: CacheInfo, archive: Archive) {
        super(EnumType, cacheInfo, archive);
    }
}

/** Defers an archive read until a script actually needs an enum. */
export class DeferredArchiveEnumTypeLoader implements EnumTypeLoader {
    private loader?: ArchiveEnumTypeLoader;

    constructor(
        private readonly cacheInfo: CacheInfo,
        private readonly getArchive: () => Archive,
    ) {}

    private getLoader(): ArchiveEnumTypeLoader {
        return (this.loader ??= new ArchiveEnumTypeLoader(this.cacheInfo, this.getArchive()));
    }

    load(id: number): EnumType {
        return this.getLoader().load(id);
    }

    getCount(): number {
        return this.getLoader().getCount();
    }

    clearCache(): void {
        this.loader?.clearCache();
    }
}

export class IndexEnumTypeLoader extends IndexTypeLoader<EnumType> implements EnumTypeLoader {
    constructor(cacheInfo: CacheInfo, index: CacheIndex, fileIdBits: number = 8) {
        super(EnumType, cacheInfo, index, fileIdBits);
    }
}
