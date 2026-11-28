import assert from "assert";

import { CustomAnimationRegistry } from "../custom/animations/CustomAnimationRegistry";
import { Model } from "../rs/model/Model";
import { IndexSeqBaseLoader } from "../rs/model/seq/SeqBaseLoader";
import { Dat2SeqFrameLoader } from "../rs/model/seq/SeqFrameLoader";
import { SeqTransformType } from "../rs/model/seq/SeqTransformType";

// A custom animation on a frame map (skeleton) of its own, which the cache doesn't have. Everything
// here is made up for the test: a two-slot frame map, one frame and a three-vertex model.
const info = { name: "test", game: "oldschool", environment: "live", revision: 242, timestamp: "", size: 0 } as any;
const base64 = (bytes: number[]) => Buffer.from(bytes).toString("base64");

const FRAME_MAP = 30000;
const GROUP = 30000;
// Two slots: an origin, then a translate; slot 0 moves label 0, slot 1 moves label 1.
// count, types, label counts, labels.
const frameMap = [2, SeqTransformType.ORIGIN, SeqTransformType.TRANSLATE, 1, 1, 0, 1];
// Frame map id (u16), slot count, a flag a slot (slot 1 moves x), then x as a smart (69 - 64 = 5).
const frame = [FRAME_MAP >> 8, FRAME_MAP & 0xff, 2, 0, 1, 69];
// Sequence opcode 1: one frame of 4 ticks, frame id GROUP << 16 | 0; then the terminator.
const seq = [1, 0, 1, 0, 4, 0, 0, GROUP >> 8, GROUP & 0xff, 0];

/** A cache index without the custom ids: reading it for them is a bug. */
const noCache = {
    getFile: () => { throw new Error("custom frame maps must not read the cache index"); },
    getArchive: () => { throw new Error("custom frames must not read the cache index"); },
} as any;

CustomAnimationRegistry.register({
    kind: "seq", id: 50000, name: "test_wave", data: base64(seq), group: GROUP,
    frames: { 0: base64(frame) }, framemaps: { [FRAME_MAP]: base64(frameMap) },
});
assert.ok(CustomAnimationRegistry.frameMap(FRAME_MAP), "the frame map is registered with its animation");

// The base loader answers the custom frame map before the cache.
const bases = new IndexSeqBaseLoader(info, noCache);
const base = bases.load(FRAME_MAP)!;
assert.strictEqual(base.id, FRAME_MAP);
assert.strictEqual(base.count, 2);
assert.deepStrictEqual(base.types, [SeqTransformType.ORIGIN, SeqTransformType.TRANSLATE]);
assert.deepStrictEqual(base.labels, [[0], [1]]);

// A cache frame map still comes from the cache index.
const cacheBytes = Int8Array.from([1, SeqTransformType.TRANSLATE, 1, 0]);
const cacheBases = new IndexSeqBaseLoader(info, { getFile: (id: number) => id === 7 ? { data: cacheBytes } : undefined } as any);
assert.strictEqual(cacheBases.load(7)!.count, 1, "cache ids are read from the cache");
assert.strictEqual(cacheBases.load(8), undefined, "a frame map nobody has is still missing");

// The custom frame decodes on the custom frame map.
const frames = new Dat2SeqFrameLoader(info, noCache, bases);
const decoded = frames.load((GROUP << 16) | 0)!;
assert.ok(decoded, "the custom frame loads");
assert.strictEqual(decoded.base, base, "on the custom frame map");
assert.strictEqual(decoded.transformCount, 1);
assert.deepStrictEqual([decoded.transformGroups[0], decoded.transformX[0]], [1, 5], "slot 1 moves x by 5");

// And it moves a model built for that skeleton: vertex 2 has label 1, the others label 0.
const model = new Model();
model.verticesCount = 3;
model.verticesX = Int32Array.from([0, 10, 20]);
model.verticesY = Int32Array.from([0, 0, 0]);
model.verticesZ = Int32Array.from([0, 0, 10]);
model.vertexLabels = [Int32Array.from([0, 1]), Int32Array.from([2])];
model.animate(decoded, undefined, false);
assert.deepStrictEqual([...model.verticesX], [0, 10, 25], "only the vertex with label 1 moves");

// The render workers get the frame maps again with the rows.
const rows = CustomAnimationRegistry.rows();
assert.deepStrictEqual(rows.map((row) => row.kind), ["reset", "seq"]);
CustomAnimationRegistry.register({ kind: "reset" });
assert.strictEqual(CustomAnimationRegistry.frameMap(FRAME_MAP), undefined, "a reset row clears the frame maps");
for (const row of rows) CustomAnimationRegistry.register(row);
assert.ok(CustomAnimationRegistry.frameMap(FRAME_MAP), "and the rows bring them back");

// Rows without frame maps (every animation before this change) still register.
CustomAnimationRegistry.register({ kind: "seq", id: 50001, name: "test_plain", data: base64(seq), group: GROUP + 1, frames: {} });
assert.ok(CustomAnimationRegistry.seq(50001));

// Bad frame maps are refused, and the registry keeps what it had.
const bad = (framemaps: any) => ({ kind: "seq", id: 50002, name: "test_bad", data: base64(seq), group: GROUP + 2, frames: {}, framemaps } as any);
assert.throws(() => CustomAnimationRegistry.register(bad({ 70000: base64(frameMap) })), /frame map/, "a frame map id is a u16");
assert.throws(() => CustomAnimationRegistry.register(bad({ x: base64(frameMap) })), /frame map/, "ids are numbers");
assert.throws(() => CustomAnimationRegistry.register(bad({ [FRAME_MAP]: 5 })), /frame map/, "bytes are base64");
assert.throws(() => CustomAnimationRegistry.register(bad(null)), /frame maps/);
assert.strictEqual(CustomAnimationRegistry.seq(50002), undefined, "a refused row isn't registered");

CustomAnimationRegistry.clear();
assert.strictEqual(CustomAnimationRegistry.frameMap(FRAME_MAP), undefined);

console.log("custom frame map tests passed");
