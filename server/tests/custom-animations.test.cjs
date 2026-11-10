// Run after `yarn build`, from server/: node --test tests/custom-animations.test.cjs
//
// Loads the real data/definitions/custom-animations.json (the Zamorak godsword special, extracted
// from this cache) against the real cache.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
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

const { loadCustomAnimations, FIRST_FRAME_GROUP } = CustomAnimations._test;
const core = { CacheDefinitions, GameConstants, encodeContentData };
let loaded;

before(async () => {
  process.chdir(path.resolve(__dirname, ".."));
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  loaded = loadCustomAnimations(core);
});

test("custom animations get their own frame group, with the cache's frames", () => {
  const seq = CacheDefinitions.getSeq(50000);
  const original = CacheDefinitions.getSeq(7638);
  assert.deepEqual(seq.frameLengths, original.frameLengths, "same timing as the cache's ZGS special");
  assert.ok(seq.frameIds.every((id) => id >> 16 === FIRST_FRAME_GROUP), "frames in group 30000");
  assert.equal(seq.rightHandItem, -1, "the extracted copy keeps the player's weapon");
  assert.equal(seq.leftHandItem, -1, "and shield");
  assert.equal(original.rightHandItem, 12320, "unlike the cache's");

  // The shipped frames are the cache's own frames for 7638, renumbered.
  const row = loaded.rows.find((r) => r.kind === "seq" && r.id === 50000);
  const anims = CacheIndexDat2.fromStore(IndexType.DAT2.animations, CachePipeline.getStore());
  original.frameIds.forEach((frameId, k) => {
    const file = seq.frameIds[k] & 0xffff;
    const cached = Buffer.from(Uint8Array.from(anims.getFile(Math.floor(frameId / 65536), frameId & 0xffff).data, (b) => b & 0xff));
    assert.equal(row.frames[file], cached.toString("base64"), `frame ${k}`);
  });
  assert.equal(Object.keys(row.frames).length, new Set(original.frameIds).size, "one file per distinct frame");
  assert.equal(CacheDefinitions.getSeq(50001).frameIds.every((id) => id >> 16 === FIRST_FRAME_GROUP + 1), true);
});

test("combat sees a custom animation's length and priorities, not an empty cache entry", () => {
  const { getSequenceStall, getSequenceForcedPriority, getSequencePriority } = require("../dist/game/cache/NpcAnimationScanner");
  const [id, cacheId] = [50000, 7638];
  assert.deepEqual(getSequenceStall(id), getSequenceStall(cacheId), `${id}: as long as ${cacheId}`);
  assert.ok(getSequenceStall(id).ticks > 0, `${id}: lasts at least a tick`);
  assert.equal(getSequenceForcedPriority(id), getSequenceForcedPriority(cacheId), `${id}: same interrupt priority`);
  assert.equal(getSequencePriority(id), getSequencePriority(cacheId), `${id}: same standing priority`);
  assert.equal(getSequenceForcedPriority(50000), 6, "a block (5) can't cut the swing short");
});

test("custom graphics point at their model and animation, and names resolve", () => {
  const gfx = CacheDefinitions.getSpotanim(50000);
  assert.equal(gfx.modelId, 1900000);
  assert.equal(gfx.animationId, 50001);
  assert.equal(CacheDefinitions.getCustomSpotanimId("zgs_special_trail"), 50000);
  assert.equal(CacheDefinitions.getSeqId("zgs_special_keep_weapon"), 50000);
  assert.equal(CacheDefinitions.getSeqId("zgs_special_player"), 7638, "the cache's own name still finds the cache's");
  assert.equal(CacheDefinitions.getSeqName(50001), "zgs_special_trail_spotanim");
  assert.equal(CacheDefinitions.hasDefinition("seq", 50000), true);
  assert.equal(CacheDefinitions.hasDefinition("spotanim", 50000), true);
  assert.equal(CacheDefinitions.getSeqId("zgs_special_keep_weapon_nope"), null);
  const row = loaded.rows.find((r) => r.kind === "spotanim");
  assert.equal(row.model.id, 1900000);
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
