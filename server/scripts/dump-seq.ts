// Dumps animation sequences (seq configs) straight from the active OSRS cache.
// Port of xrsps-typescript's SeqType.decodeOpcode, kept minimal: enough to see the
// frame count / frame ids a weapon special needs to override its attack animation.
//
//   yarn dump:seq                # every seq: one line each
//   yarn dump:seq 1234 5678      # only the given ids
//
// Needs the cache in server/caches - run `yarn ensure-cache` first.
//
// OUTPUT
// One line per sequence:
//
//   seq 1234 frames=5 step=-1 priority=5 standing=0 movement=-1 masks=0 loops=99 frameIds=5678,5679,5680,5681,5682
//
//   frames  Number of frames in the animation. A special attack animation must exist here
//           before you can send it with an animate packet.
//   step    frameStep - how the client advances the frames (-1 = follow the frame lengths).
//   priority forcedPriority (attack animation is normally 5).
//   standing SeqType.priority (opcode 10): -1 unset, which the client derives to 0 (steps are
//           withheld while the animation plays) unless the seq carries masks - that is the
//           client half of a partial stall; the server keeps walking the true tile. 1 means it
//           drops the seq on a step, as skilling loops do. See the Wiki's Animation stall.
//   movement SeqType.precedenceAnimating (opcode 9): the same check when the actor was already
//           moving when the animation started.
//   masks    Opcode 3 / 17 entries, which flip the client's derived priority from 0 to 2.
//   loops   maxLoops (99 when the animation loops forever).
//
// A skeletal sequence (opcode 13/14) has no frames array; it renders from a model id
// instead, so frames=0 there is expected.
import path = require("path");
import { CachePipeline } from "../src/main/typescript/elvarg/game/cache/CachePipeline";
import { CacheIndexDat2 } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/CacheIndex";
import { IndexType } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/IndexType";
import { ConfigType } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/ConfigType";
import { ByteBuffer } from "../src/main/typescript/elvarg/game/cache/codec/rs/io/ByteBuffer";

type SeqType = {
    id: number;
    frameIds: number[];
    frameLengths: number[];
    frameStep: number;
    forcedPriority: number;
    standingPriority: number;
    movementPriority: number;
    masks: number;
    leftHandItem: number;
    rightHandItem: number;
    maxLoops: number;
    skeletalId: number;
    skeletalLength: number;
    sounds: string[];
};

function decodeSeq(id: number, data: Int8Array, revision: number): SeqType {
    const rev226 = revision >= 226;
    const rev220 = revision >= 220;
    const buf = new ByteBuffer(data);
    const seq: SeqType = {
        id,
        frameIds: [],
        frameLengths: [],
        frameStep: -1,
        forcedPriority: 5,
        standingPriority: -1,
        movementPriority: -1,
        masks: 0,
        leftHandItem: -1,
        rightHandItem: -1,
        maxLoops: 99,
        skeletalId: -1,
        skeletalLength: 0,
        sounds: [],
    };
    for (;;) {
        if (buf.offset >= buf.length) break;
        const opcode = buf.readUnsignedByte();
        if (opcode === 0) break;
        if (opcode === 1) {
            const count = buf.readUnsignedShort();
            seq.frameLengths = new Array(count);
            seq.frameIds = new Array(count);
            for (let i = 0; i < count; i++) seq.frameLengths[i] = buf.readUnsignedShort();
            for (let i = 0; i < count; i++) seq.frameIds[i] = buf.readUnsignedShort();
            for (let i = 0; i < count; i++) seq.frameIds[i] += buf.readUnsignedShort() << 16;
        } else if (opcode === 2) {
            seq.frameStep = buf.readUnsignedShort();
        } else if (opcode === 3) {
            const count = buf.readUnsignedByte();
            seq.masks += count;
            for (let i = 0; i < count; i++) buf.readUnsignedByte();
        } else if (opcode === 4) {
            // stretches
        } else if (opcode === 5) {
            seq.forcedPriority = buf.readUnsignedByte();
        } else if (opcode === 6) {
            seq.leftHandItem = buf.readUnsignedShort();
        } else if (opcode === 7) {
            seq.rightHandItem = buf.readUnsignedShort();
        } else if (opcode === 8) {
            seq.maxLoops = buf.readUnsignedByte();
        } else if (opcode === 9) {
            seq.movementPriority = buf.readUnsignedByte();
        } else if (opcode === 10) {
            seq.standingPriority = buf.readUnsignedByte();
        } else if (opcode === 11) {
            buf.readUnsignedByte();
        } else if (opcode === 12) {
            const count = buf.readUnsignedByte();
            for (let i = 0; i < count * 4; i++) buf.readUnsignedByte();
        } else if (opcode === 13 && !rev226) {
            const count = buf.readUnsignedByte();
            for (let i = 0; i < count; i++) {
                const sound = buf.readUnsignedMedium();
                if (sound) seq.sounds.push(`${i}:${sound >> 8}`);
            }
        } else if (opcode === (rev226 ? 13 : 14)) {
            seq.skeletalId = buf.readInt();
        } else if (opcode === (rev226 ? 14 : 15)) {
            const entries = buf.readUnsignedShort();
            for (let i = 0; i < entries; i++) {
                const frame = buf.readUnsignedShort();
                const sound = rev220 ? buf.readUnsignedShort() : buf.readUnsignedMedium() >> 8;
                if (rev220) {
                    if (rev226) buf.readUnsignedByte();
                    buf.readUnsignedByte();
                    buf.readUnsignedByte();
                    buf.readUnsignedByte();
                }
                seq.sounds.push(`${frame}:${sound}`);
            }
        } else if (opcode === (rev226 ? 15 : 16)) {
            const start = buf.readUnsignedShort();
            seq.skeletalLength = buf.readUnsignedShort() - start;
        } else if (opcode === 16) {
            buf.readByte();
        } else if (opcode === 17) {
            const count = buf.readUnsignedByte();
            seq.masks += count;
            for (let i = 0; i < count; i++) buf.readUnsignedByte();
        } else if (opcode === 18) {
            buf.readString();
        } else if (opcode === 100) {
            const count = buf.readUnsignedByte();
            for (let i = 0; i < count; i++) {
                buf.readUnsignedShort();
                buf.readUnsignedShort();
            }
        } else {
            break;
        }
    }
    return seq;
}

function format(seq: SeqType): string {
    const bits = [
        `seq ${seq.id}`,
        `frames=${seq.frameIds.length}`,
        `step=${seq.frameStep}`,
        `priority=${seq.forcedPriority}`,
        `standing=${seq.standingPriority}`,
        `movement=${seq.movementPriority}`,
        `masks=${seq.masks}`,
        `loops=${seq.maxLoops}`,
    ];
    // Client cycles (20 ms) the frames last; a game tick is 30 cycles.
    const cycles = seq.frameLengths.length
        ? seq.frameLengths.reduce((sum, length) => sum + length, 0)
        : seq.skeletalLength;
    if (cycles) bits.push(`length=${cycles}`, `ticks=${Math.ceil(cycles / 30)}`);
    if (seq.skeletalId >= 0) bits.push(`skeletal=${seq.skeletalId}`);
    else bits.push(`frameIds=${seq.frameIds.join(",")}`);
    bits.push(`sounds=${seq.sounds.join(",") || "none"}`);
    return bits.join(" ");
}

async function main() {
    await CachePipeline.initialize(path.resolve(__dirname, ".."));
    const revision = CachePipeline.getActive().revision;
    const index = CacheIndexDat2.fromStore(IndexType.DAT2.configs, CachePipeline.getStore());
    const archive = index.getArchive(ConfigType.DAT2.seqs);
    console.log(`; cache revision ${revision}; sounds are frame:synthId`);
    const filter = new Set(process.argv.slice(2).flatMap(arg => arg.split(",")).map(Number));
    for (const file of archive.files) {
        if (filter.size > 0 && !filter.has(file.id)) continue;
        try {
            console.log(format(decodeSeq(file.id, new Int8Array(file.data), revision)));
        } catch (e) {
            console.log(`seq ${file.id} DECODE ERROR ${(e as Error).message}`);
        }
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
