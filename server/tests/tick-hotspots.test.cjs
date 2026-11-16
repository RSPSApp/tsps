// Run after `yarn build`: node --test tests/tick-hotspots.test.cjs
// Hot paths measured with hundreds of players online (CPU profiles, Windows): each stays correct
// and stops paying for work it repeated on every call.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const Module = require("node:module");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { SkillManager } = require("../dist/game/content/skill/SkillManager");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { World } = require("../dist/game/World");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { ArchiveTypeLoader } = require("../dist/game/cache/codec/rs/config/TypeLoader");

function countModuleLoads(run) {
  const original = Module._load;
  let loads = 0;
  Module._load = function countedLoad(...args) { loads++; return original.apply(this, args); };
  try { run(); } finally { Module._load = original; }
  return loads;
}

test("levels past 99's experience are 99, and the table still answers below it", () => {
  assert.equal(SkillManager.getLevelForExperience(0), 1);
  assert.equal(SkillManager.getLevelForExperience(83), 2);
  assert.equal(SkillManager.getLevelForExperience(13034430), 98);
  assert.equal(SkillManager.getLevelForExperience(13034431), 99);
  for (const xp of [13034432, 13035423, 14391160, 200000000]) assert.equal(SkillManager.getLevelForExperience(xp), 99);
});

test("the level lookup answers as the old walk down the table did, everywhere", () => {
  const table = SkillManager.EXP_ARRAY;
  const old = (experience) => {
    if (experience <= SkillManager.EXPERIENCE_FOR_99) {
      for (let j = 98; j >= 0; j--) if (table[j] <= experience) return j + 1;
    }
    return 99;
  };
  const samples = [-1, -0.5, NaN, 0, 0.1, 82.9, 83, 13034430.9, 13034431, 13034431.1, Infinity, -Infinity];
  for (const xp of table) samples.push(xp - 1, xp - 0.1, xp, xp + 0.1, xp + 1);
  for (let xp = 0; xp < 200000; xp += 37) samples.push(xp);
  for (const xp of samples) assert.equal(SkillManager.getLevelForExperience(xp), old(xp), `experience ${xp}`);
});

test("the owner index finds a player's registered NPCs, follows owner changes and removal", () => {
  const owner = {}, other = {};
  const npc = (registered = true) => {
    const value = Object.create(NPC.prototype);
    value.isRegistered = () => registered;
    value.setRegistered = (state) => { registered = state; };
    return value;
  };
  const a = npc(), b = npc(), pending = npc(false);
  a.setOwner(owner); b.setOwner(owner); pending.setOwner(owner);
  assert.deepEqual(new Set(World.getNpcsOwnedBy(owner)), new Set([a, b]), "an unregistered NPC is not in the world yet");
  b.setOwner(other);
  assert.deepEqual(World.getNpcsOwnedBy(owner), [a]);
  assert.deepEqual(World.getNpcsOwnedBy(other), [b]);
  NPC.forgetOwner(a);
  assert.deepEqual(World.getNpcsOwnedBy(owner), []);
  NPC.indexOwner(a);
  assert.deepEqual(World.getNpcsOwnedBy(owner), [a], "re-added to the world, it is found again");
  assert.deepEqual(World.getNpcsOwnedBy(null), []);
});

test("refreshing an inventory resolves its lazy modules once", () => {
  const sender = new Proxy({}, { get: () => () => sender });
  const player = { getInventory: () => inventory, getInterfaceId: () => -1, getPacketSender: () => sender };
  const inventory = new Inventory(player);
  inventory.refreshItems();
  assert.equal(countModuleLoads(() => { for (let i = 0; i < 1000; i++) inventory.refreshItems(); }), 0);
});

test("a type loader answers hits without reordering its map, and evicts the least recently used", () => {
  const loader = new ArchiveTypeLoader(class { constructor(id) { this.id = id; } decode() {} post() {} }, {}, { getFile: () => undefined, lastFileId: 10 });
  loader.maxCacheSize = 4;
  const first = loader.load(1), second = loader.load(2);
  loader.load(3); loader.load(4);
  assert.equal(loader.load(1), first);
  assert.deepEqual([...loader.cache.keys()], [1, 2, 3, 4], "a hit does not delete and re-insert");
  loader.load(5);
  assert.deepEqual([...loader.cache.keys()].sort(), [1, 4, 5],
    "full: the least recently used quarter goes (2 and 3), not the oldest inserted (1)");
  assert.equal(loader.load(1), first);
  assert.equal(loader.load(2) === second, false, "an evicted type is decoded again");
  loader.clearCache();
  assert.equal(loader.cache.size, 0);
});
