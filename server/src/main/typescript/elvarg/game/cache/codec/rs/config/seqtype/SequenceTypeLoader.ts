import { Archive } from "../../cache/Archive";
import { CacheInfo } from "../../cache/CacheInfo";
import { ArchiveTypeLoader, TypeLoader } from "../TypeLoader";
import { SequenceType } from "./SequenceType";

export type SequenceTypeLoader = TypeLoader<SequenceType>;

export class ArchiveSequenceTypeLoader
    extends ArchiveTypeLoader<SequenceType>
    implements SequenceTypeLoader
{
    constructor(cacheInfo: CacheInfo, archive: Archive) {
        super(SequenceType, cacheInfo, archive);
    }
}
