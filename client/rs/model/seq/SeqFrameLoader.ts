import { CustomAnimationRegistry } from "../../../custom/animations/CustomAnimationRegistry";
import { Archive } from "../../cache/Archive";
import { CacheIndex } from "../../cache/CacheIndex";
import { CacheInfo } from "../../cache/CacheInfo";
import { isGroupMissingError } from "../../cache/js5/GroupMissingError";
import { SeqBaseLoader } from "./SeqBaseLoader";
import { Dat2SeqFrame, DatSeqFrame, LegacySeqFrame, SeqFrame } from "./SeqFrame";
import { SeqFrameMap } from "./SeqFrameMap";

export interface SeqFrameLoader {
    load(id: number): SeqFrame | undefined;

    clearCache(): void;
}

export class LegacySeqFrameLoader implements SeqFrameLoader {
    static load(modelArchive: Archive): LegacySeqFrameLoader {
        return new LegacySeqFrameLoader(LegacySeqFrame.load(modelArchive));
    }

    constructor(readonly frames: SeqFrame[]) {}

    load(id: number): SeqFrame | undefined {
        return this.frames[id];
    }

    clearCache(): void {}
}

export class DatSeqFrameLoader implements SeqFrameLoader {
    static load(frameMapIndex: CacheIndex): DatSeqFrameLoader {
        const frames: Map<number, SeqFrame> = new Map();

        for (let i = 0; i < frameMapIndex.getArchiveCount(); i++) {
            try {
                const file = frameMapIndex.getFile(i, 0);
                if (!file) {
                    continue;
                }
                DatSeqFrame.load(frames, file.data);
            } catch (e) {
                console.error("Failed loading frame map " + i, e);
            }
        }

        return new DatSeqFrameLoader(frames);
    }

    constructor(readonly frames: Map<number, SeqFrame>) {}

    load(id: number): SeqFrame | undefined {
        return this.frames.get(id);
    }

    clearCache(): void {}
}

export class Dat2SeqFrameLoader implements SeqFrameLoader {
    frameMaps: Map<number, SeqFrameMap> = new Map();

    constructor(
        readonly cacheInfo: CacheInfo,
        readonly animIndex: CacheIndex,
        readonly baseLoader: SeqBaseLoader,
    ) {}

    // changed 610
    load(id: number): SeqFrame | undefined {
        const frameMapId = id >> 16;
        const frameId = id & 0xffff;

        let frameMap = this.frameMaps.get(frameMapId);
        const custom = frameMap ? undefined : CustomAnimationRegistry.frameGroup(frameMapId);
        if (custom) {
            // A custom animation's frames: its own group, on the cache's frame maps.
            const frames: SeqFrame[] = [];
            try {
                for (const [file, data] of custom) {
                    frames[file] = Dat2SeqFrame.load(this.cacheInfo, this.baseLoader, data);
                }
            } catch (e) {
                if (!isGroupMissingError(e)) throw e;
                return undefined;
            }
            frameMap = new SeqFrameMap(frames);
            this.frameMaps.set(frameMapId, frameMap);
        }
        if (!frameMap) {
            let archive: Archive;
            try {
                archive = this.animIndex.getArchive(frameMapId);
            } catch (e) {
                // Group not downloaded yet (fetch already queued); the
                // animation renders a static pose until it arrives.
                if (!isGroupMissingError(e)) {
                    throw e;
                }
                return undefined;
            }

            const frames: SeqFrame[] = new Array(archive.lastFileId);
            let missingBase = false;

            for (const file of archive.files) {
                try {
                    frames[file.id] = Dat2SeqFrame.load(this.cacheInfo, this.baseLoader, file.data);
                } catch (e) {
                    if (!isGroupMissingError(e)) throw e;
                    missingBase = true;
                }
            }
            if (missingBase) return undefined;

            frameMap = new SeqFrameMap(frames);
            this.frameMaps.set(frameMapId, frameMap);
        }

        return frameMap.frames[frameId];
    }

    clearCache(): void {
        this.frameMaps.clear();
        this.baseLoader.clearCache();
    }
}
