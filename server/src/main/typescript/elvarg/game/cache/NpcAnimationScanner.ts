import { CachePipeline } from "./CachePipeline";
import { CacheIndexDat2 } from "./codec/rs/cache/CacheIndex";
import { ConfigType } from "./codec/rs/cache/ConfigType";
import { IndexType } from "./codec/rs/cache/IndexType";
import { ByteBuffer } from "./codec/rs/io/ByteBuffer";

function skipSequenceOpcode(buffer: ByteBuffer, opcode: number, revision: number): boolean {
    const skip = (length: number) => {
        if (buffer.remaining < length) return false;
        buffer.offset += length;
        return true;
    };
    if (opcode === 2 || opcode === 6 || opcode === 7) return skip(2);
    if (opcode === 4) return true;
    if ([5, 8, 9, 10, 11, 16].includes(opcode)) return skip(1);
    if (opcode === 3 || opcode === 17) {
        if (buffer.remaining < 1) return false;
        return skip(buffer.readUnsignedByte());
    }
    if (opcode === 12) {
        if (buffer.remaining < 1) return false;
        return skip(buffer.readUnsignedByte() * 4);
    }
    if (opcode === 13) {
        if (revision >= 226) return skip(4);
        if (buffer.remaining < 1) return false;
        return skip(buffer.readUnsignedByte() * 3);
    }
    if (opcode === 14) {
        if (revision < 226) return skip(4);
        if (buffer.remaining < 2) return false;
        return skip(buffer.readUnsignedShort() * 8);
    }
    if (opcode === 15) return revision >= 226 ? skip(4) : false;
    if (opcode === 18) {
        while (buffer.remaining > 0 && buffer.readUnsignedByte() !== 0) {
            // Skip the null-terminated string.
        }
        return true;
    }
    if (opcode === 100) {
        if (buffer.remaining < 1) return false;
        return skip(buffer.readUnsignedByte() * 4);
    }
    return false;
}

export function getSequenceFrameIds(data: Int8Array, revision = 237): number[] {
    const buffer = new ByteBuffer(data);
    while (buffer.remaining > 0) {
        const opcode = buffer.readUnsignedByte();
        if (opcode === 0) return [];
        if (opcode !== 1) {
            if (!skipSequenceOpcode(buffer, opcode, revision)) return [];
            continue;
        }
        if (buffer.remaining < 2) return [];
        const count = buffer.readUnsignedShort();
        if (buffer.remaining < count * 6) return [];
        buffer.offset += count * 2; // frame lengths
        const frameIds = Array.from({ length: count }, () => buffer.readUnsignedShort());
        return frameIds.map((frameId) => frameId | (buffer.readUnsignedShort() << 16));
    }
    return [];
}

/**
 * The seq fields core needs from the client's own `SeqType`
 * (client/rs/config/seqtype/SeqType.ts): how long the animation stays on screen, its interrupt
 * priority and its standing priority.
 */
export type SequenceDefinition = {
    /** SeqType.priority (opcode 10); -1 when the cache doesn't set it. */
    priority: number;
    /** SeqType.forcedPriority (opcode 5); -1 when unset. */
    forcedPriority: number;
    /** Client cycles one pass of the animation takes; 0 when the sequence has no frames. */
    clientCycles: number;
};

const sequenceDefinitions = new Map<number, SequenceDefinition>();

/** The decoded sequence archive: decompressing it took ~100 ms, once per animation looked up. */
let sequenceArchive: ReturnType<CacheIndexDat2["getArchive"]> | null = null;

function sequences(): ReturnType<CacheIndexDat2["getArchive"]> {
    if (!sequenceArchive) {
        const configs = CacheIndexDat2.fromStore(IndexType.DAT2.configs, CachePipeline.getStore());
        sequenceArchive = configs.getArchive(ConfigType.DAT2.seqs);
    }
    return sequenceArchive;
}

/** Decodes the sequence archive at startup, so no animation's first lookup does it mid-tick. */
export function preloadSequences(): void {
    try {
        sequences();
    } catch {
        // No cache (tests, tools): looked up lazily instead.
    }
}

/** One game tick is 30 client cycles, as scripts/dump-seq.ts counts them. */
const CLIENT_CYCLES_PER_TICK = 30;

/**
 * Reads the seq config once per id. An unknown opcode ends the walk: the fields after it are
 * then left at their defaults, which is what the previous priority-only decoder did.
 */
function decodeSequence(id: number): SequenceDefinition {
    const cached = sequenceDefinitions.get(id);
    if (cached !== undefined) return cached;
    const definition: SequenceDefinition = {
        priority: -1,
        forcedPriority: -1,
        clientCycles: 0,
    };
    try {
        const data = sequences().getFile(id)?.data;
        const revision = CachePipeline.getActive().revision;
        const rev226 = revision >= 226;
        const rev220 = revision >= 220;
        const buffer = new ByteBuffer(data ?? new Int8Array());
        while (buffer.remaining > 0) {
            const opcode = buffer.readUnsignedByte();
            if (opcode === 0) break;
            if (opcode === 1) {
                const count = buffer.readUnsignedShort();
                if (buffer.remaining < count * 6) break;
                for (let frame = 0; frame < count; frame++) {
                    definition.clientCycles += buffer.readUnsignedShort();
                }
                buffer.offset += count * 4;
                continue;
            }
            if (opcode === 3 || opcode === 17) {
                const count = buffer.readUnsignedByte();
                if (buffer.remaining < count) break;
                buffer.offset += count;
                continue;
            }
            if (opcode === 5 || opcode === 9 || opcode === 10) {
                const value = buffer.readUnsignedByte();
                if (opcode === 5) definition.forcedPriority = value;
                else if (opcode === 10) definition.priority = value;
                continue;
            }
            // cachedModelId: the animation renders from a skeleton, so its length is the
            // frame range below rather than a per-frame list.
            if (opcode === (rev226 ? 13 : 14) && buffer.remaining >= 4) {
                buffer.offset += 4;
                definition.clientCycles = -1;
                continue;
            }
            // skeletalStart, skeletalEnd.
            if (opcode === (rev226 ? 15 : 16) && definition.clientCycles === -1 &&
                buffer.remaining >= 4) {
                const start = buffer.readUnsignedShort();
                definition.clientCycles = buffer.readUnsignedShort() - start;
                continue;
            }
            if (opcode === 14 && rev226) {
                const entries = buffer.readUnsignedShort();
                const stride = rev220 ? 8 : 4;
                if (buffer.remaining < entries * stride) break;
                buffer.offset += entries * stride;
                continue;
            }
            if (opcode === 16 && rev226) {
                buffer.offset += 1;
                continue;
            }
            if (!skipSequenceOpcode(buffer, opcode, revision)) break;
        }
        if (definition.clientCycles < 0) definition.clientCycles = 0;
    } catch {
        // No cache (tests, tools): treat as unset.
    }
    sequenceDefinitions.set(id, definition);
    return definition;
}

/**
 * SeqType.priority (opcode 10; -1 when unset): 1 means the client drops the seq
 * when the actor takes a step, as skilling loops do.
 */
export function getSequencePriority(id: number): number {
    return decodeSequence(id).priority;
}

/**
 * SeqType.forcedPriority (opcode 5; 5 when unset): a sequence can't replace one with a higher
 * value (attacks are 6, blocks 5, so a block never cuts a swing short).
 */
export function getSequenceForcedPriority(id: number): number {
    const forced = decodeSequence(id).forcedPriority;
    return forced === -1 ? 5 : forced;
}

/**
 * How many ticks the client keeps an animation on screen (its frame lengths / 30). Core uses
 * this to stop a click cutting a swing away before the client has finished it.
 *
 * This is the *partial* half of the Wiki's Animation stall: the client may withhold the actor's
 * steps while it plays, but the server keeps walking the true tile, so the animation plays over
 * a tile that has already moved and the client catches up when it ends. A full stall (no
 * movement or actions at all) is content, not seq config, and is never derived here:
 * AnimationStalls.plugin.js can promote a verified row to it. Wiki: Animation stall.
 */
export function getSequenceStall(id: number): { ticks: number } {
    return { ticks: Math.ceil(decodeSequence(id).clientCycles / CLIENT_CYCLES_PER_TICK) };
}

export function getLastSequenceId(): number {
    return sequences().lastFileId;
}

export async function findNpcRigAnimations(baseSequenceIds: number[], minimumId: number, maximumId: number): Promise<number[]> {
    const store = CachePipeline.getStore();
    const configs = CacheIndexDat2.fromStore(IndexType.DAT2.configs, store);
    const sequences = configs.getArchive(ConfigType.DAT2.seqs);
    const frames = CacheIndexDat2.fromStore(IndexType.DAT2.animations, store);
    const skeletonForSequence = (sequenceId: number) => {
        const frameId = getSequenceFrameIds(
            sequences.getFile(sequenceId)?.data ?? new Int8Array(),
            CachePipeline.getActive().revision,
        )[0];
        if (frameId === undefined) return null;
        const frame = frames.getFile(frameId >>> 16, frameId & 0xffff)?.getDataAsBuffer();
        return frame?.readUnsignedShort() ?? null;
    };

    const skeletons = new Set(baseSequenceIds.map(skeletonForSequence).filter(Number.isInteger));
    if (skeletons.size === 0) return [];

    const known = new Set(baseSequenceIds);
    const matches: number[] = [];
    for (let id = minimumId; id <= Math.min(maximumId, sequences.lastFileId); id++) {
        if (!known.has(id) && skeletons.has(skeletonForSequence(id))) matches.push(id);
        if ((id - minimumId) % 128 === 127) {
            await new Promise<void>((resolve) => setImmediate(resolve));
        }
    }
    return matches;
}
