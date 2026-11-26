// Run after `yarn build`, from server/: node --test tests/custom-animation-parts.test.cjs
//
// A custom animation too big for one content packet is split into parts instead of refused. Needs
// no cache: the cache is a stand-in with one frame map (0), and every file is made up here, with
// hard-to-compress frame values so a modest animation passes the packet limit.
const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { encodeContentData } = require("../dist/net/protocol/ClientProtocol");
const Files = require("../plugins/world/CustomAnimationFiles.cjs");
const Assets = require("../plugins/tools/cache-editor/Assets.CacheEditor.cjs");
const CustomAnimations = require("../plugins/world/CustomAnimations.plugin");

const SLOTS = 255;
const registered = [];
const CacheDefinitions = {
  // Frame map 0: 255 slots (only its first byte, the slot count, is read).
  getFrameMapData: (id) => (id === 0 ? Uint8Array.from([SLOTS]) : undefined),
  hasDefinition: () => false,
  registerCustomAnimations: (seqs, spotanims) => registered.push({ seqs, spotanims }),
};
const core = { CacheDefinitions, encodeContentData };

/** A small deterministic generator, so the frames are the same on every run. */
function generator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state >>> 25; // 0..127: a one-byte smart
  };
}

/** `count` frames on frame map 0, every slot moving x, y and z (about 1 KiB each), and seq.dat. */
function animationFolder(count, seed = 1) {
  const next = generator(seed);
  const files = new Map();
  for (let file = 0; file < count; file++) {
    const values = Array.from({ length: SLOTS * 3 }, next);
    files.set(`frames/7-${file}.dat`, Buffer.from([0, 0, SLOTS, ...new Array(SLOTS).fill(7), ...values]));
  }
  const seq = Buffer.alloc(1 + 2 + count * 6 + 1);
  seq[0] = 1;
  seq.writeUInt16BE(count, 1);
  for (let k = 0; k < count; k++) {
    seq.writeUInt16BE(2, 3 + 2 * k); // frame length
    seq.writeUInt16BE(k, 3 + 2 * (count + k)); // file
    seq.writeUInt16BE(7, 3 + 2 * (2 * count + k)); // group
  }
  files.set("seq.dat", seq);
  return files;
}

const upload = (name, files) => Assets.addAsset(root, {
  kind: "animation", name, files: Object.fromEntries([...files].map(([file, bytes]) => [file, bytes.toString("base64")])),
}, core);

let root;
before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "custom-animation-parts-"));
});
after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test("an animation that fits one packet is one row, as before", () => {
  // A control: passes before and after splitting.
  const asset = upload("test_short", animationFolder(4)).asset;
  registered.length = 0;
  const { rows } = CustomAnimations._test.loadCustomAnimations(core, root);
  const mine = rows.filter((row) => row.id === asset.id);
  assert.deepEqual(mine.map((row) => row.kind), ["seq"]);
  assert.equal(Object.keys(mine[0].frames).length, 4);
});

test("an animation too big for one packet is stored, not refused", () => {
  const files = animationFolder(160);
  const whole = Files.animationRow(Files.animationFiles(files, "animation test", CacheDefinitions), 50001, "test_long", Files.FIRST_FRAME_GROUP + 1);
  assert.equal(Files.fitsPacket(encodeContentData, whole), false, "the test animation really is past the packet limit");
  const { asset } = upload("test_long", files);
  assert.equal(asset.id, 50001);
  assert.equal(asset.frames, 160);
});

test("it loads as a seq row and frames rows that each fit a packet and together hold every frame", () => {
  registered.length = 0;
  const { rows } = CustomAnimations._test.loadCustomAnimations(core, root);
  const mine = rows.filter((row) => row.id === 50001);
  const [first, ...rest] = mine;
  assert.equal(first.kind, "seq");
  assert.ok(first.parts >= 2, `split into ${first.parts} parts`);
  assert.equal(mine.length, first.parts);
  assert.deepEqual(rest.map((row) => [row.kind, row.part, row.group]), rest.map((_, k) => ["frames", k + 1, first.group]));
  const files = mine.flatMap((row) => Object.keys(row.frames));
  assert.equal(files.length, 160, "each frame once");
  assert.deepEqual(new Set(files), new Set(Array.from({ length: 160 }, (_, k) => String(k))));
  for (const row of mine) assert.ok(Files.fitsPacket(encodeContentData, row), `${row.kind} part ${row.part ?? 0} fits`);
  // The server knows the animation once, by its seq row.
  assert.deepEqual(registered[0].seqs.map((row) => row.id), [50000, 50001]);
  assert.equal(registered[0].seqs[1].data, first.data);
});

test("players get the parts in order, each packet within the limit, and the listing names it once", () => {
  const endpoints = {};
  let login;
  CustomAnimations.register({
    core, root, log: () => {},
    onServerStartup: () => {},
    registerContentEndpoint: (name, fn) => { endpoints[name] = fn; },
    onPlayerLogin: (fn) => { login = fn; },
  });
  const sent = [];
  login({ player: { getPacketSender: () => ({ sendContentData: (_source, datasets) => sent.push(datasets) }) } });
  assert.ok(sent.length >= 2, "more than one packet");
  for (const datasets of sent) assert.ok(encodeContentData("server", datasets).length <= 0xffff);
  const rows = sent.flatMap((datasets) => datasets[0].rows);
  assert.equal(rows[0].kind, "reset");
  const parts = rows.filter((row) => row.id === 50001).map((row) => row.part ?? 0);
  assert.deepEqual(parts, parts.map((_, k) => k), "seq row first, then parts 1, 2, ...");
  assert.deepEqual(endpoints["custom-animations"]().map((row) => `${row.kind}:${row.id}`), ["animation:50000", "animation:50001"]);
});
