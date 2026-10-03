// Dumps spot animations (spotanim/gfx configs) straight from the active OSRS cache.
// Port of xrsps-typescript's SpotAnimType.decodeOpcode, kept minimal: enough to see the
// model and the sequence a graphic plays, so a special attack can spawn the right gfx.
//
//   yarn dump:spotanim            # every spotanim: one line each
//   yarn dump:spotanim 1234 5678  # only the given ids
//
// Needs the cache in server/caches - run `yarn ensure-cache` first.
//
// OUTPUT
// One line per spotanim:
//
//   spotanim 1234 model=5678 seq=910
//
//   model  Model id drawn by the gfx. A spotanim id is what the sendGraphic / spotanim
//          packet takes; the model id is only useful for cross-referencing dumps.
//   seq    Animation sequence id the gfx plays (see `yarn dump:seq`). -1 = static model.
import path = require("path");
import { CachePipeline } from "../src/main/typescript/elvarg/game/cache/CachePipeline";
import { CacheIndexDat2 } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/CacheIndex";
import { IndexType } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/IndexType";
import { ConfigType } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/ConfigType";
import { ByteBuffer } from "../src/main/typescript/elvarg/game/cache/codec/rs/io/ByteBuffer";

type SpotAnimType = {
    id: number;
    modelId: number;
    sequenceId: number;
};

function decodeSpotAnim(id: number, data: Int8Array): SpotAnimType {
    const buf = new ByteBuffer(data);
    const spot: SpotAnimType = { id, modelId: -1, sequenceId: -1 };
    for (;;) {
        if (buf.offset >= buf.length) break;
        const opcode = buf.readUnsignedByte();
        if (opcode === 0) break;
        if (opcode === 1) spot.modelId = buf.readUnsignedShort();
        else if (opcode === 2) spot.sequenceId = buf.readUnsignedShort();
        else if (opcode === 3) spot.modelId = buf.readInt();
        else if (opcode === 4) buf.readUnsignedShort();
        else if (opcode === 5) buf.readUnsignedShort();
        else if (opcode === 6) buf.readUnsignedShort();
        else if (opcode === 7) buf.readUnsignedByte();
        else if (opcode === 8) buf.readUnsignedByte();
        else if (opcode === 40 || opcode === 41) {
            const count = buf.readUnsignedByte();
            for (let i = 0; i < count; i++) {
                buf.readUnsignedShort();
                buf.readUnsignedShort();
            }
        } else break;
    }
    return spot;
}

function format(spot: SpotAnimType): string {
    return `spotanim ${spot.id} model=${spot.modelId} seq=${spot.sequenceId}`;
}

async function main() {
    await CachePipeline.initialize(path.resolve(__dirname, ".."));
    const index = CacheIndexDat2.fromStore(IndexType.DAT2.configs, CachePipeline.getStore());
    const archive = index.getArchive(ConfigType.DAT2.spotAnims);
    const filter = new Set(process.argv.slice(2).map(Number));
    for (const file of archive.files) {
        if (filter.size > 0 && !filter.has(file.id)) continue;
        try {
            console.log(format(decodeSpotAnim(file.id, new Int8Array(file.data))));
        } catch (e) {
            console.log(`spotanim ${file.id} DECODE ERROR ${(e as Error).message}`);
        }
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
