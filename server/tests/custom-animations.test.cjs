// Run after `yarn build`, from server/: node --test tests/custom-animations.test.cjs
//
// Stores the Zamorak godsword special (server/data/models/zamorak-godsword-special, as the Blender
// add-ons exported it from this cache) as cache editor assets in a temporary server root, and loads
// them against the real cache.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { CacheIndexDat2 } = require("../dist/game/cache/codec/rs/cache/CacheIndex");
const { IndexType } = require("../dist/game/cache/codec/rs/cache/IndexType");
const { GameConstants } = require("../dist/game/GameConstants");
const { encodeContentData } = require("../dist/net/protocol/ClientProtocol");
const CustomAnimations = require("../plugins/world/CustomAnimations.plugin");
const Assets = require("../plugins/tools/cache-editor/Assets.CacheEditor.cjs");

const { loadCustomAnimations, FIRST_FRAME_GROUP } = CustomAnimations._test;
const core = { CacheDefinitions, CachePipeline, CacheIndexDat2, GameConstants, encodeContentData };
const SERVER = path.resolve(__dirname, "..");
const ZGS = path.join(SERVER, "data", "models", "zamorak-godsword-special");
/** The temporary server root holding the assets. */
let root;
let loaded;
/** The special as an animation asset, and its trail as a graphic asset (with its own animation and model). */
let special;
let trail;

before(async () => {
  process.chdir(SERVER);
  await CachePipeline.initialize(SERVER);
  root = fs.mkdtempSync(path.join(os.tmpdir(), "custom-animations-"));
  fs.cpSync(path.join(ZGS, "player-anim"), path.join(root, "data", "models", "zgs-player"), { recursive: true });
  fs.cpSync(path.join(ZGS, "graphic"), path.join(root, "data", "models", "zgs-trail"), { recursive: true });
  special = Assets.addAsset(root, { kind: "animation", library: "zgs-player", name: "zgs_special_keep_weapon" }, core).asset;
  trail = Assets.addAsset(root, { kind: "graphic", library: "zgs-trail", name: "zgs_special_trail" }, core);
  loaded = loadCustomAnimations(core, root);
});

test("custom animations get their own frame group, with the cache's frames", () => {
  assert.equal(special.id, 50000);
  const seq = CacheDefinitions.getSeq(50000);
  const original = CacheDefinitions.getSeq(7638);
  assert.deepEqual(seq.frameLengths, original.frameLengths, "same timing as the cache's ZGS special");
  assert.ok(seq.frameIds.every((id) => id >> 16 === FIRST_FRAME_GROUP), "frames in group 30000");
  assert.equal(seq.rightHandItem, -1, "the extracted copy keeps the player's weapon");
  assert.equal(seq.leftHandItem, -1, "and shield");
  assert.equal(original.rightHandItem, 12320, "unlike the cache's");

  // The stored frames are the cache's own frames for 7638, renumbered.
  const row = loaded.rows.find((r) => r.kind === "seq" && r.id === 50000);
  const anims = CacheIndexDat2.fromStore(IndexType.DAT2.animations, CachePipeline.getStore());
  original.frameIds.forEach((frameId, k) => {
    const file = seq.frameIds[k] & 0xffff;
    const cached = Buffer.from(Uint8Array.from(anims.getFile(Math.floor(frameId / 65536), frameId & 0xffff).data, (b) => b & 0xff));
    assert.equal(row.frames[file], cached.toString("base64"), `frame ${k}`);
  });
  assert.equal(Object.keys(row.frames).length, new Set(original.frameIds).size, "one file per distinct frame");
  // Each animation's frames are in group 30000 + its position among the animation assets, by id.
  assert.ok(CacheDefinitions.getSeq(trail.asset.animation).frameIds.every((id) => id >> 16 === FIRST_FRAME_GROUP + 1));
});

test("the exported special hands the older skeleton's body, legs and cape to walk and run animations too", () => {
  // As the Ancient godsword special (9171) does itself; 819/824 and 14252/14254 move only those slots.
  const older = [1, 2, 9, 11, 13, 15, 17, 19, 37, 39, 41, 43, 45];
  const masks = CacheDefinitions.getSeq(50000).masks;
  const original = CacheDefinitions.getSeq(7638).masks;
  assert.deepEqual(masks.filter((slot) => !older.includes(slot)), original, "the cache's list is kept");
  assert.ok(older.every((slot) => masks.includes(slot)), "hands over the older slots");
  assert.deepEqual([...masks].sort((a, b) => a - b), masks, "in slot order, as the client walks it");
});

test("combat sees a custom animation's length and priorities, not an empty cache entry", () => {
  const { getSequenceStall, getSequenceForcedPriority, getSequencePriority } = require("../dist/game/cache/NpcAnimationScanner");
  assert.deepEqual(getSequenceStall(50000), getSequenceStall(7638), "as long as 7638");
  assert.ok(getSequenceStall(50000).ticks > 0, "lasts at least a tick");
  assert.equal(getSequenceForcedPriority(50000), getSequenceForcedPriority(7638), "same interrupt priority");
  assert.equal(getSequencePriority(50000), getSequencePriority(7638), "same standing priority");
  assert.equal(getSequenceForcedPriority(50000), 6, "a block (5) can't cut the swing short");
});

test("custom graphics point at their model and animation, and names resolve", () => {
  const { asset, parts } = trail;
  const model = parts.find((part) => part.kind === "model");
  assert.equal(asset.id, 50000, "graphics are numbered apart from animations");
  assert.ok(Number.isInteger(model.id) && model.id >= 1000000, "its model is a model asset");
  const gfx = CacheDefinitions.getSpotanim(asset.id);
  assert.equal(gfx.modelId, model.id, "its model");
  assert.equal(gfx.animationId, asset.animation, "its animation");
  assert.equal(CacheDefinitions.getCustomSpotanimId("zgs_special_trail"), asset.id);
  assert.equal(CacheDefinitions.hasDefinition("spotanim", asset.id), true);
  assert.equal(CacheDefinitions.getSeqId("zgs_special_keep_weapon"), 50000);
  assert.equal(CacheDefinitions.getSeqId("zgs_special_player"), 7638, "the cache's own name still finds the cache's");
  assert.equal(CacheDefinitions.getSeqName(asset.animation), "zgs_special_trail_anim");
  assert.equal(CacheDefinitions.hasDefinition("seq", 50000), true);
  assert.equal(CacheDefinitions.getSeqId("zgs_special_keep_weapon_nope"), null);
  const row = loaded.rows.find((r) => r.kind === "spotanim");
  assert.equal(row.model, undefined, "the model ships with the editor's custom models, not in the graphic");
  assert.ok(Assets.customModels(root).some((entry) => entry.id === model.id), "and is one of them");
  // Cache definitions are untouched.
  assert.equal(CacheDefinitions.getSpotanim(1210).modelId, 28085);
  assert.equal(CacheDefinitions.getSeq(7638).frameIds.length, 25);
});

test("every custom animation and graphic fits one content packet", () => {
  for (const row of loaded.rows) {
    assert.ok(encodeContentData("server", [{ key: "customAnimations", rows: [row] }]).length <= 0xffff, `${row.kind} ${row.id}`);
  }
});

test("cache ids, duplicates and bad ids are refused", () => {
  const data = loaded.rows[0].data;
  assert.throws(() => CacheDefinitions.registerCustomAnimations([{ id: 7638, name: "x", data }], []), /already a cache animation/);
  assert.throws(() => CacheDefinitions.registerCustomAnimations([{ id: 50000, name: "a", data }, { id: 50000, name: "b", data }], []), /listed twice/);
  assert.throws(() => CacheDefinitions.registerCustomAnimations([{ id: 70000, name: "x", data }], []), /0\.\.65534/);
  assert.throws(() => CacheDefinitions.registerCustomAnimations([{ id: 50000, name: "zgs_special_player", data }], []), /already a cache animation's name/);
  // A failed registration leaves the previous set in place.
  assert.equal(CacheDefinitions.getSeqId("zgs_special_keep_weapon"), 50000);
});

// Review of RSPSApp/tsps PR 4195: bounded parsers, frames checked at load, clashing models left
// out, and the set sent in one packet.
const { readSeq, readSpotanim, checkFrame } = CustomAnimations._test;

test("a string without its terminator is reported, not read forever", () => {
  assert.throws(() => readSeq(Uint8Array.from([18, 65, 66, 67]), "seq"), /truncated/);
  assert.throws(() => readSpotanim(Uint8Array.from([9, 65, 66]), "spotanim"), /truncated/);
  assert.equal(readSeq(Uint8Array.from([18, 65, 0, 0]), "seq").length, 1, "a terminated string still reads");
});

test("frames are decoded at load: too many slots, a bad flag or a short file is refused", () => {
  // Frame map 0, 2 slots: slot 0 moves x (one-byte smart 5), slot 1 nothing.
  const good = Uint8Array.from([0, 0, 2, 1, 0, 5]);
  checkFrame(good, 2, "frame");
  assert.throws(() => checkFrame(good, 1, "frame"), /2 slots; its frame map has 1/);
  assert.throws(() => checkFrame(Uint8Array.from([0, 0, 1, 8]), 2, "frame"), /unknown flag/);
  assert.throws(() => checkFrame(Uint8Array.from([0, 0, 1, 7, 5]), 2, "frame"), /truncated/, "y and z are missing");
  assert.throws(() => checkFrame(Uint8Array.from([0, 0, 1, 1, 200]), 2, "frame"), /truncated/, "a two-byte smart cut short");
});

/** Registers the plugin as the server does, returning its hooks. */
function registerPlugin() {
  const hooks = {};
  CustomAnimations.register({
    core,
    root,
    log: () => {},
    onServerStartup: (fn) => { hooks.startup = fn; },
    registerContentEndpoint: () => {},
    onPlayerLogin: (fn) => { hooks.login = fn; },
  });
  return hooks;
}

function packetsSentAtLogin(hooks) {
  const sent = [];
  hooks.login({ player: { getPacketSender: () => ({ sendContentData: (_source, datasets) => sent.push(datasets) }) } });
  return sent;
}

test("login sends the whole set in one packet, starting with a reset row", () => {
  CacheDefinitions.setCustomModels([]);
  const hooks = registerPlugin();
  hooks.startup?.();
  const sent = packetsSentAtLogin(hooks);
  assert.equal(sent.length, 1, "one packet, so the client invalidates once");
  const rows = sent[0][0].rows;
  assert.equal(sent[0][0].key, "customAnimations");
  assert.equal(rows[0].kind, "reset");
  assert.deepEqual(rows.slice(1).map((row) => `${row.kind}:${row.id}`), loaded.rows.map((row) => `${row.kind}:${row.id}`));
  assert.ok(encodeContentData("server", sent[0]).length <= 0xffff);
});

test("a graphic whose model is not a model asset is refused at load", () => {
  const assets = Assets.assetsOf(root).map((row) => row.kind === "graphic" && row.id === 50000 ? { ...row, model: 1999999 } : row);
  const Document = require("../plugins/tools/cache-editor/Document.CacheEditor.cjs");
  const read = Document.read;
  Document.read = (where) => ({ ...read(where), assets });
  try {
    assert.throws(() => loadCustomAnimations(core, root), /graphic 50000 \(zgs_special_trail\): its model 1999999 is not a model asset/);
  } finally {
    Document.read = read;
    loadCustomAnimations(core, root);
  }
});
