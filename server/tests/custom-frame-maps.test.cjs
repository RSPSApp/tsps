// Run after `yarn build`, from server/: node --test tests/custom-frame-maps.test.cjs
//
// Custom animations on frame maps (skeletons) of their own, which the cache doesn't have. Needs no
// cache: the cache is a stand-in with one frame map (0), and every file is made up here.
const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { encodeContentData } = require("../dist/net/protocol/ClientProtocol");
const Files = require("../plugins/world/CustomAnimationFiles.cjs");
const Assets = require("../plugins/tools/cache-editor/Assets.CacheEditor.cjs");
const CustomAnimations = require("../plugins/world/CustomAnimations.plugin");

const { FIRST_CUSTOM_FRAME_MAP } = Files;
const CACHE_FRAME_MAP = Buffer.from([1, 1, 1, 0]); // frame map 0: one translate slot moving label 0
// Two slots: an origin, then a translate. Count, types, label counts, labels.
const FRAME_MAP = Buffer.from([2, 0, 1, 1, 1, 0, 1]);
const OTHER_FRAME_MAP = Buffer.from([2, 0, 1, 1, 1, 0, 2]);

/** One frame on `framemap`: slot `slots - 1` moves x by 5 (a one-byte smart, 69). */
function frameOn(framemap, slots = 2) {
  return Buffer.from([framemap >> 8, framemap & 0xff, slots, ...new Array(slots - 1).fill(0), 1, 69]);
}

/** seq.dat with one frame of 4 ticks, frame id `group << 16 | file`. */
function seqFor(group, file = 0) {
  return Buffer.from([1, 0, 1, 0, 4, file >> 8, file & 0xff, group >> 8, group & 0xff, 0]);
}

/** An animation folder as the Blender add-on writes it. */
function folder(framemap, framemapBytes, extra = {}) {
  const files = new Map([["seq.dat", seqFor(7)], ["frames/7-0.dat", frameOn(framemap)]]);
  if (framemapBytes) files.set(`framemap-${framemap}.dat`, framemapBytes);
  for (const [name, bytes] of Object.entries(extra)) files.set(name, bytes);
  return files;
}

const registered = [];
const CacheDefinitions = {
  getFrameMapData: (id) => (id === 0 ? Uint8Array.from(CACHE_FRAME_MAP) : undefined),
  hasDefinition: () => false,
  registerCustomAnimations: (seqs, spotanims) => registered.push({ seqs, spotanims }),
};
const core = { CacheDefinitions, encodeContentData };

test("a custom frame map is checked and ships with its animation", () => {
  const checked = Files.animationFiles(folder(FIRST_CUSTOM_FRAME_MAP, FRAME_MAP), "animation test", CacheDefinitions);
  assert.deepEqual(checked.framemaps, [FIRST_CUSTOM_FRAME_MAP]);
  assert.deepEqual([...checked.customFrameMaps.keys()], [FIRST_CUSTOM_FRAME_MAP]);
  const row = Files.animationRow(checked, 50000, "test_wave", Files.FIRST_FRAME_GROUP);
  assert.deepEqual(row.framemaps, { [FIRST_CUSTOM_FRAME_MAP]: FRAME_MAP.toString("base64") });
  assert.equal(row.frames[0], frameOn(FIRST_CUSTOM_FRAME_MAP).toString("base64"), "the frame is unchanged");
  assert.ok(Files.fitsPacket(encodeContentData, row));
});

test("an animation on a cache frame map ships no frame map, as before", () => {
  const files = new Map([["seq.dat", seqFor(7)], ["frames/7-0.dat", frameOn(0, 1)], ["framemap-0.dat", CACHE_FRAME_MAP]]);
  // A control: passes before and after custom frame maps.
  const checked = Files.animationFiles(files, "animation test", CacheDefinitions);
  const row = Files.animationRow(checked, 50000, "test_wave", Files.FIRST_FRAME_GROUP);
  assert.equal("framemaps" in row, false);
  assert.deepEqual(Object.keys(row.frames), ["0"]);
});

test("a cache frame map can't be replaced, and other ids are refused", () => {
  const edited = new Map([["seq.dat", seqFor(7)], ["frames/7-0.dat", frameOn(0, 1)], ["framemap-0.dat", Buffer.from([1, 1, 1, 1])]]);
  assert.throws(() => Files.animationFiles(edited, "animation test", CacheDefinitions), /differs from the cache's; give an edited frame map its own id, from 30000/);
  assert.throws(() => Files.animationFiles(folder(5, FRAME_MAP), "animation test", CacheDefinitions), /frame map 5, which the cache doesn't have \(custom frame maps are 30000\.\.65535\)/);
  assert.throws(() => Files.animationFiles(folder(FIRST_CUSTOM_FRAME_MAP, null), "animation test", CacheDefinitions), /has no framemap-30000\.dat/);
});

test("a custom frame map decodes as the client decodes it", () => {
  const check = (bytes) => Files.checkFrameMapData(Buffer.from(bytes), "framemap");
  assert.equal(check([2, 0, 1, 1, 1, 0, 1]), 2);
  assert.equal(check([2, 0, 1, 1, 1, 0, 1, 0, 0]), 2, "a bone count of 0, as cache frame maps end");
  assert.throws(() => check([]), /no slots/);
  assert.throws(() => check([0]), /no slots/);
  assert.throws(() => check([2, 0, 1]), /truncated/, "label counts missing");
  assert.throws(() => check([2, 0, 1, 1, 3, 0, 1]), /truncated/, "labels missing");
  assert.throws(() => check([2, 0, 1, 1, 1, 0, 1, 9]), /1 byte\(s\) after its labels/);
  assert.throws(() => check([2, 0, 1, 1, 1, 0, 1, 0, 1]), /skeletal frame map/);
  // A frame with more slots than its custom frame map has is refused like any other.
  const files = folder(FIRST_CUSTOM_FRAME_MAP, FRAME_MAP);
  files.set("frames/7-0.dat", frameOn(FIRST_CUSTOM_FRAME_MAP, 3));
  assert.throws(() => Files.animationFiles(files, "animation test", CacheDefinitions), /3 slots; its frame map has 2/);
});

test("animations sharing a custom frame map id must agree on it", () => {
  const row = (id, bytes) => ({ id, framemaps: { [FIRST_CUSTOM_FRAME_MAP]: bytes.toString("base64") } });
  Files.checkSharedFrameMaps([row(50000, FRAME_MAP), row(50001, FRAME_MAP), { id: 50002 }]);
  assert.throws(() => Files.checkSharedFrameMaps([row(50000, FRAME_MAP), row(50001, OTHER_FRAME_MAP)]),
    /animations 50000 and 50001 use different frame maps under id 30000/);
});

/** A temporary server root, as the asset store and the plugin read it. */
let root;
const upload = (name, files) => Assets.addAsset(root, {
  kind: "animation", name, files: Object.fromEntries([...files].map(([file, bytes]) => [file, bytes.toString("base64")])),
}, core);

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "custom-frame-maps-"));
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test("the asset store keeps a custom frame map and refuses a clashing one", () => {
  const first = upload("test_wave", folder(FIRST_CUSTOM_FRAME_MAP, FRAME_MAP)).asset;
  assert.deepEqual(first.framemaps, [FIRST_CUSTOM_FRAME_MAP]);
  assert.ok(Assets.readAsset(root, first).get(`framemap-${FIRST_CUSTOM_FRAME_MAP}.dat`).equals(FRAME_MAP), "stored with the frames");
  // A second animation on the same skeleton: same bytes, accepted.
  const second = upload("test_wave_again", folder(FIRST_CUSTOM_FRAME_MAP, FRAME_MAP, { "info.json": Buffer.from("{}") })).asset;
  assert.notEqual(second.id, first.id);
  // Other bytes under the same id would make the set refuse to load: refused at upload.
  assert.throws(() => upload("test_clash", folder(FIRST_CUSTOM_FRAME_MAP, OTHER_FRAME_MAP)),
    (error) => error.status === 409 && /Frame map 30000 differs from the one animation 50000 \(test_wave\) uses/.test(error.message));
  // Replacing the only animation on a frame map may change it.
  const only = upload("test_own", folder(FIRST_CUSTOM_FRAME_MAP + 1, FRAME_MAP)).asset;
  const replaced = Assets.addAsset(root, {
    kind: "animation", replace: only.id,
    files: Object.fromEntries([...folder(FIRST_CUSTOM_FRAME_MAP + 1, OTHER_FRAME_MAP)].map(([file, bytes]) => [file, bytes.toString("base64")])),
  }, core);
  assert.equal(replaced.asset.id, only.id);
});

test("the stored animations load with their frame maps, and players get them", () => {
  registered.length = 0;
  const loaded = CustomAnimations._test.loadCustomAnimations(core, root);
  const seqRows = loaded.rows.filter((row) => row.kind === "seq");
  assert.equal(seqRows.length, 3);
  assert.deepEqual(seqRows.map((row) => Object.keys(row.framemaps)), [["30000"], ["30000"], ["30001"]]);
  assert.equal(seqRows[2].framemaps[30001], OTHER_FRAME_MAP.toString("base64"), "the replaced frame map");
  assert.equal(registered.length, 1, "registered with the server's definitions");
  for (const row of seqRows) assert.ok(Files.fitsPacket(encodeContentData, row), `animation ${row.id} fits a packet`);
});
