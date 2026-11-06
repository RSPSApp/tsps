import { strict as assert } from "node:assert";
import { SnapshotReuse, digest } from "../game/plugins/questhelper/QuestHelperReuse";
import { encodeBase64 } from "../common/network/ChunkedPluginMessages";

// The digest is stable for equal values and tells changed ones apart, as JSON.stringify would.
assert.equal(digest({ a: [1, "x", null, true] }), digest({ a: [1, "x", null, true] }));
assert.notEqual(digest([{ id: 1, x: 2 }]), digest([{ id: 1, x: 3 }]));
assert.notEqual(digest([1, 2]), digest([2, 1]), "order matters");
assert.notEqual(digest({ text: "ab" }), digest({ text: "ba" }));
assert.equal(digest({ a: 1, b: undefined }), digest({ a: 1 }), "undefined members are skipped, as in JSON");
assert.notEqual(digest(""), digest(0));
assert.match(digest([]), /^[0-9a-f]{16}$/);

const objects = [{ id: 1, x: 3200, y: 3200, plane: 0 }];
const widgets = [{ id: 1, bounds: { x: 0, y: 0, width: 1, height: 1 } }];
const base: any = { varps: {}, varbits: {}, inventory: [], equipment: [], localPlayer: { x: 1, y: 1, plane: 0 }, skills: {}, npcs: [], groundItems: [], baseX: 3150, baseY: 3150, plane: 0, tick: 1, geometry: { x: 0, y: 0, width: 765, height: 503 } };
let packed = 0;
const terrain = { digest: "abcd", pack: () => { packed++; return { loadedTilesPacked: { encoding: "bitset-lsb-base64", shape: [4, 104, 104], data: "AA==" }, tileHeightsPacked: { encoding: "int16-le-base64", shape: [4, 105, 105], multiplier: -8, data: "AA==" }, tileSettingsPacked: { encoding: "uint8-base64", shape: [4, 104, 104], data: "AA==" } } as any; } };

const reuse = new SnapshotReuse();
const first = reuse.prepare("s1", { ...base, objects, widgets, itemDefinitions: { 1: { id: 1 } } }, terrain);
assert.deepEqual(first.objects, objects, "nothing held yet: sections go in full");
assert.deepEqual(Object.keys(first.digests!).sort(), ["itemDefinitions", "objects", "terrain", "widgets"]);
assert.equal(first.reuse, undefined);
assert.equal(packed, 1);
assert.equal(first.geometry!.tileHeightsPacked!.data, "AA==", "terrain is packed into the wire geometry");
assert.equal(base.geometry.tileHeightsPacked, undefined, "the local snapshot is untouched");

// Before the server acknowledges, the sections still go in full.
const again = reuse.prepare("s1", { ...base, objects, widgets }, terrain);
assert.ok(again.objects && again.widgets && again.geometry!.tileHeightsPacked);
assert.equal(packed, 2);

reuse.accept("s1", { ...first.digests, widgets: "0000000000000000" });
const third = reuse.prepare("s1", { ...base, objects, widgets, itemDefinitions: { 1: { id: 1 } } }, terrain);
assert.equal(third.objects, undefined, "held objects are named by digest");
assert.equal(third.reuse!.objects, first.digests!.objects);
assert.equal(third.reuse!.terrain, "abcd");
assert.equal(packed, 2, "held terrain is not packed");
assert.equal(third.geometry!.tileHeightsPacked, undefined);
assert.deepEqual(third.widgets, widgets, "a section the server holds differently goes in full");
assert.equal(third.digests!.widgets, first.digests!.widgets);
assert.equal(third.reuse!.itemDefinitions, first.digests!.itemDefinitions);

const changed = reuse.prepare("s1", { ...base, objects: [{ id: 2, x: 3200, y: 3200, plane: 0 }], widgets }, terrain);
assert.ok(changed.objects, "a changed section goes in full");
assert.notEqual(changed.digests!.objects, first.digests!.objects);

const other = reuse.prepare("s2", { ...base, objects, widgets }, terrain);
assert.ok(other.objects && other.widgets && other.geometry!.tileHeightsPacked, "another session starts from nothing");
reuse.accept("s2", first.digests);
reuse.reset();
assert.ok(reuse.prepare("s2", { ...base, objects }).objects, "a reset forgets what was held");
const none = reuse.prepare("s2", { ...base });
assert.equal(none.digests, undefined); assert.equal(none.reuse, undefined);

// Block base64 matches the byte-by-byte encoding it replaces.
const bytes = new Uint8Array(70000); for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) & 0xff;
assert.equal(encodeBase64(bytes), Buffer.from(bytes).toString("base64"));
assert.equal(encodeBase64(new Uint8Array(0)), "");
console.log("quest helper snapshot section reuse passed");
