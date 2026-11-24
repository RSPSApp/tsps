import { SampledAnimationRegistry } from './SampledAnimationRegistry';
import type { CacheInfo } from '../../rs/cache/CacheInfo';
import type { SeqTypeLoader } from '../../rs/config/seqtype/SeqTypeLoader';
export class CustomSeqTypeLoader implements SeqTypeLoader {
    constructor(readonly base: SeqTypeLoader, readonly info: CacheInfo) { }
    load(id: number) { return SampledAnimationRegistry.sequence(id, this.info) ?? this.base.load(id); }
    getCount() { return Math.max(this.base.getCount(), ...SampledAnimationRegistry.getAll().map(row => row.id + 1)); }
    clearCache() { this.base.clearCache(); }
}
