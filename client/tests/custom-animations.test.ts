import assert from "assert";
import fs from "fs";
import path from "path";

import { CustomAnimationRegistry, withCustomTypes } from "../custom/animations/CustomAnimationRegistry";
import { SeqType } from "../rs/config/seqtype/SeqType";
import { SpotAnimType } from "../rs/config/spotanimtype/SpotAnimType";
import { Dat2SeqBase } from "../rs/model/seq/SeqBase";
import { Dat2SeqFrameLoader } from "../rs/model/seq/SeqFrameLoader";

// The Zamorak godsword special as the Blender add-ons exported it (server/data/models).
const root = path.resolve(__dirname, "../../server/data/models/zamorak-godsword-special");
const info = { name: "test", game: "oldschool", environment: "live", revision: 241, timestamp: "", size: 0 } as any;
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts));
const base64 = (data: Buffer) => data.toString("base64");

const seqBytes = read("player-anim", "seq.dat");
const frameFiles = fs.readdirSync(path.join(root, "player-anim", "frames"));
const GROUP = 30000;
const frames: Record<string, string> = {};
frameFiles.forEach((name, k) => { frames[k] = base64(read("player-anim", "frames", name)); });

CustomAnimationRegistry.register({ kind: "seq", id: 50000, name: "zgs_special_keep_weapon", data: base64(seqBytes), group: GROUP, frames });
CustomAnimationRegistry.register({
    kind: "spotanim", id: 50000, name: "zgs_special_trail", data: base64(read("graphic", "spotanim.dat")),
    model: { id: 1900000, data: base64(read("graphic", "model.dat")) },
});

// Sequences and graphics: custom ids from the registry, everything else from the cache loader.
const cacheSeq = new SeqType(7, info);
const seqs = withCustomTypes({ load: () => cacheSeq, getCount: () => 1, clearCache: () => {} }, SeqType, info,
    (id) => CustomAnimationRegistry.seq(id));
const seq = seqs.load(50000);
assert.strictEqual(seq.frameLengths.length, 25);
assert.strictEqual(seq.rightHandItem, -1, "the extracted copy keeps the player's weapon");
assert.strictEqual(seqs.load(50000), seq, "decoded once");
assert.strictEqual(seqs.load(7638), cacheSeq, "cache ids still come from the cache");

const spots = withCustomTypes({ load: () => new SpotAnimType(1, info), getCount: () => 1, clearCache: () => {} }, SpotAnimType, info,
    (id) => CustomAnimationRegistry.spotanim(id));
assert.strictEqual(spots.load(50000).modelId, 28085, "the extracted definition (the server points it at the custom model)");
assert.ok(CustomAnimationRegistry.model(1900000)!.length > 18, "the graphic's model is registered");

// Frames: a custom group is read from the registry, on the cache's frame map, never the cache index.
const framemap = Dat2SeqBase.load(info, 0, new Int8Array(read("player-anim", "framemap-0.dat")));
const loader = new Dat2SeqFrameLoader(info,
    { getArchive: () => { throw new Error("custom frames must not read the cache index"); } } as any,
    { load: () => framemap, clearCache: () => {} });
for (let k = 0; k < frameFiles.length; k++) {
    const frame = loader.load((GROUP << 16) | k);
    assert.ok(frame && frame.transformCount > 0, `custom frame ${k}`);
}

CustomAnimationRegistry.clear();
assert.strictEqual(CustomAnimationRegistry.seq(50000), undefined);
assert.strictEqual(CustomAnimationRegistry.model(1900000), undefined);
assert.throws(() => CustomAnimationRegistry.register({ kind: "seq", id: 50000, name: "x", data: "", group: 40000, frames: {} }),
    /frames/, "frame groups past 32767 would overflow a frame id");

console.log("custom animations tests passed");
