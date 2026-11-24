import { SampledAnimationRegistry } from "./SampledAnimationRegistry";
import type { CacheInfo } from "../../rs/cache/CacheInfo";
import type { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";

export class CustomSeqTypeLoader implements SeqTypeLoader {
    constructor(
        readonly base: SeqTypeLoader,
        readonly info: CacheInfo,
        private readonly hasBaseSequence: (id: number) => boolean = (id) => id < base.getCount(),
    ) {}

    load(id: number) {
        if (SampledAnimationRegistry.get(id) && !this.hasBaseSequence(id)) {
            return SampledAnimationRegistry.sequence(id, this.info)!;
        }
        return this.base.load(id);
    }

    getCount(): number {
        let count = this.base.getCount();
        for (const id of SampledAnimationRegistry.ids()) {
            if (id >= count && !this.hasBaseSequence(id)) count = id + 1;
        }
        return count;
    }

    clearCache(): void { this.base.clearCache(); }
}
