import assert from "assert";

import { loadFromPayload } from "../common/gamemode/GamemodeContentStore";
import { CustomAnimationRegistry } from "../custom/animations/CustomAnimationRegistry";

// A custom animation too big for one content packet arrives as a seq row with `parts`, then
// "frames" rows with the rest of its frames. It is installed only once every part is here. The
// rows are made up for the test; frame bytes are never decoded here.
const base64 = (bytes: number[]) => Buffer.from(bytes).toString("base64");
const GROUP = 30000;
const frame = (n: number) => base64([0, 0, 1, 1, 64 + n]);
// Sequence opcode 1: three frames of 4 ticks, files 0..2 of GROUP; then the terminator.
const seq = base64([1, 0, 3, 0, 4, 0, 4, 0, 4, 0, 0, 0, 1, 0, 2, GROUP >> 8, GROUP & 0xff, GROUP >> 8, GROUP & 0xff, GROUP >> 8, GROUP & 0xff, 0]);
const head = { kind: "seq", id: 50000, name: "test_long", data: seq, group: GROUP, frames: { 0: frame(0) }, parts: 3 } as const;
const part = (n: number, extra: object = {}) => ({ kind: "frames", id: 50000, group: GROUP, part: n, frames: { [n]: frame(n) }, ...extra } as any);

/** The datasets of one content packet, as the server sends them at login. */
const packet = (rows: unknown[]) => loadFromPayload({ gamemodeId: "server", datasets: [{ key: "customAnimations", rows }] });

// The first packet: a reset, and the start of the animation.
packet([{ kind: "reset" }, head]);
const revision = CustomAnimationRegistry.revision;
assert.strictEqual(CustomAnimationRegistry.seq(50000), undefined, "not installed before its last part");
assert.strictEqual(CustomAnimationRegistry.frameGroup(GROUP), undefined, "nor are its frames");
// Parts may come in any order; the second packet brings the last two.
packet([part(2)]);
assert.strictEqual(CustomAnimationRegistry.seq(50000), undefined, "still waiting for part 1");
assert.strictEqual(CustomAnimationRegistry.revision, revision, "nothing to invalidate yet");
packet([part(1)]);
assert.strictEqual(CustomAnimationRegistry.seq(50000), seq, "installed with its last part");
assert.deepStrictEqual([...CustomAnimationRegistry.frameGroup(GROUP)!.keys()].sort(), [0, 1, 2], "with every frame");
assert.deepStrictEqual([...CustomAnimationRegistry.frameGroup(GROUP)!.get(2)!], [0, 0, 1, 1, 66]);
assert.strictEqual(CustomAnimationRegistry.revision, revision + 1, "one revision for the whole animation");

// The render workers get it as one whole row: no packet limit between threads.
const rows = CustomAnimationRegistry.rows();
assert.deepStrictEqual(rows.map((row) => row.kind), ["reset", "seq"]);
const whole = rows[1] as any;
assert.strictEqual(whole.parts, undefined);
assert.deepStrictEqual(Object.keys(whole.frames).sort(), ["0", "1", "2"]);
CustomAnimationRegistry.clear();
for (const row of rows) CustomAnimationRegistry.register(row);
assert.strictEqual(CustomAnimationRegistry.frameGroup(GROUP)!.size, 3, "and the rows bring it back");

// An animation that fits one packet is installed at once, as before.
CustomAnimationRegistry.register({ kind: "seq", id: 50001, name: "test_short", data: seq, group: GROUP + 1, frames: { 0: frame(0) } });
assert.ok(CustomAnimationRegistry.seq(50001));
CustomAnimationRegistry.register({ kind: "seq", id: 50002, name: "test_one_part", data: seq, group: GROUP + 2, frames: { 0: frame(0) }, parts: 1 });
assert.ok(CustomAnimationRegistry.seq(50002), "parts: 1 is a whole animation");

// Parts that don't belong are refused, and leave the animation waiting.
CustomAnimationRegistry.register({ ...head, id: 50003, group: GROUP + 3 });
const refused = (row: any, why: string) => assert.throws(() => CustomAnimationRegistry.register(row), /part/, why);
refused(part(1, { id: 50004 }), "no seq row for that id");
refused(part(1, { id: 50003 }), "another group");
refused(part(0, { id: 50003, group: GROUP + 3 }), "part 0 is the seq row");
refused(part(3, { id: 50003, group: GROUP + 3 }), "past its parts");
refused(part(1, { id: 50003, group: GROUP + 3, frames: { 1: 7 } }), "frames are base64 strings");
CustomAnimationRegistry.register(part(1, { id: 50003, group: GROUP + 3 }));
refused(part(1, { id: 50003, group: GROUP + 3 }), "a part twice");
assert.strictEqual(CustomAnimationRegistry.seq(50003), undefined, "still waiting for part 2");
assert.throws(() => CustomAnimationRegistry.register({ ...head, id: 50005, parts: 65 }), /parts/, "at most 64 parts");
assert.throws(() => CustomAnimationRegistry.register({ ...head, id: 50005, parts: 0 }), /parts/);

// A reset (a new login, a new world) drops an animation still arriving.
CustomAnimationRegistry.register({ kind: "reset" });
refused(part(2, { id: 50003, group: GROUP + 3 }), "its seq row went with the reset");
assert.strictEqual(CustomAnimationRegistry.seq(50003), undefined);

CustomAnimationRegistry.clear();
console.log("custom animation parts tests passed");
