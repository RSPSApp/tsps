import { CacheIndex } from "../cache/CacheIndex";
import { CacheInfo } from "../cache/CacheInfo";
import { CacheSystem } from "../cache/CacheSystem";
import { detectCacheType } from "../cache/CacheType";
import { IndexType } from "../cache/IndexType";
import { isGroupMissingError } from "../cache/js5/GroupMissingError";
import { retryOnMissingGroup } from "../cache/js5/retryOnMissingGroup";
import { RawSoundData, SoundEffect } from "./legacy/SoundEffect";
import { decodeWithOwnSetup } from "./vorbis/VorbisSample";

export class SoundEffectLoader {
    private readonly index?: CacheIndex;

    constructor(cacheInfo: CacheInfo, cacheSystem: CacheSystem) {
        const type = detectCacheType(cacheInfo);

        let indexId: number | undefined;
        if (type === "dat") {
            if (cacheSystem.indexExists(IndexType.DAT.sounds)) {
                indexId = IndexType.DAT.sounds;
            }
        } else if (type === "dat2") {
            const soundEffectsIdx = IndexType.DAT2.soundEffects;

            if (cacheSystem.indexExists(soundEffectsIdx)) {
                indexId = soundEffectsIdx;
            } else if (cacheSystem.indexExists(4)) {
                // Try index 4 directly
                indexId = 4;
            }
        }
        if (indexId !== undefined) {
            this.index = cacheSystem.getIndex(indexId);
        }
    }

    available(): boolean {
        return !!this.index;
    }

    private tryDecode(id: number, trimOnset = true): RawSoundData | undefined {
        if (!this.index) return undefined;
        // Newer sound effects (from 11988 in rev 241) are sampled: file 1 of their archive holds
        // their own Vorbis setup and a Vorbis sample, where the older synths are file 0.
        const fileIds = this.index.getFileIds?.(id);
        if (fileIds && fileIds.length > 0 && fileIds[0] === 1) return this.decodeSampled(id);
        const file = this.index.getFileSmart(id);
        if (!file) return undefined;
        const buffer = file.getDataAsBuffer();
        const effect = SoundEffect.decode(buffer);
        const delayCycles = trimOnset ? effect.calculateDelay() : 0;
        const raw = effect.toRawSound();
        if (!raw || !raw.samples || raw.samples.length <= 0) return undefined;
        raw.delayCycles = delayCycles;
        return raw;
    }

    /** A sampled sound effect: [int setup length][Vorbis setup][Vorbis sample]. */
    private decodeSampled(id: number): RawSoundData | undefined {
        const file = this.index!.getFile(id, 1) as any;
        if (!file) return undefined;
        const data: Uint8Array = file.data;
        const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        const setupLength = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
        if (setupLength <= 0 || 4 + setupLength >= bytes.length) return undefined;
        const raw = decodeWithOwnSetup(bytes.subarray(4, 4 + setupLength), bytes.subarray(4 + setupLength));
        if (!raw.samples || raw.samples.length === 0) return undefined;
        // Loop points only matter for a looping sample; a one-shot plays whole.
        return {
            sampleRate: raw.sampleRate,
            samples: raw.samples,
            start: raw.looped ? raw.start : 0,
            end: raw.looped ? raw.end : 0,
            delayCycles: 0,
        };
    }

    load(soundId: number, trimOnset = true): RawSoundData | undefined {
        if (!this.index) return undefined;
        try {
            return this.tryDecode(soundId, trimOnset);
        } catch (err) {
            // Missing groups are queued for on-demand fetch; the caller falls
            // back to loadWithRetry to pick the sound up once it lands.
            if (!isGroupMissingError(err)) {
                console.log("[SoundEffectLoader] failed to load sound", soundId, err);
            }
            return undefined;
        }
    }

    /** Like load(), but waits out an on-demand fetch instead of skipping it. */
    async loadWithRetry(soundId: number, trimOnset = true): Promise<RawSoundData | undefined> {
        if (!this.index) return undefined;
        try {
            return await retryOnMissingGroup(() => this.tryDecode(soundId, trimOnset));
        } catch (err) {
            console.log("[SoundEffectLoader] failed to load sound", soundId, err);
            return undefined;
        }
    }
}
