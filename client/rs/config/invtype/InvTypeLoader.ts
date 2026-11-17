import { Archive } from "../../cache/Archive";
import { CacheInfo } from "../../cache/CacheInfo";
import { ArchiveTypeLoader, TypeLoader } from "../TypeLoader";
import { InvType } from "./InvType";

export type InvTypeLoader = TypeLoader<InvType>;

/** Defer the archive request until INV_SIZE needs it, as with streamed enum definitions. */
export class DeferredArchiveInvTypeLoader implements InvTypeLoader {
    private loader?: ArchiveTypeLoader<InvType>;

    constructor(
        private readonly cacheInfo: CacheInfo,
        private readonly getArchive: () => Archive,
    ) {}

    private getLoader(): ArchiveTypeLoader<InvType> {
        return (this.loader ??= new ArchiveTypeLoader(InvType, this.cacheInfo, this.getArchive()));
    }

    load(id: number): InvType {
        return this.getLoader().load(id);
    }

    getCount(): number {
        return this.getLoader().getCount();
    }

    clearCache(): void {
        this.loader?.clearCache();
    }
}
