// Run after `yarn build`: node --test tests/alchemical-hydra-drops.test.cjs
// The Alchemical Hydra's loot rolls (Wiki, Alchemical_Hydra#Drops): besides the hydra bones, two
// rolls on its table per kill. The first can hit the unique pre-roll; the second is always on the
// standard table, so a kill never gives two uniques.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const NpcDrops = require("../plugins/npcs/NpcDrops.plugin");
const { __internals } = NpcDrops;

const HYDRA = 8615;
const DRAGON_BONES = 536;

before(() => {
  CachePipeline.initialize();
  NpcDrops.register({
    core: { CacheDefinitions, ItemIdentifiers },
    getPluginConfig: (key, fallback) => fallback,
    getItemOnGroundManager() {},
    onCustomEvent() {},
    emitCustomEvent() {},
    onNpcDeath() {},
    registerCommand() {},
    log() {},
  });
  __internals.loadDrops();
});

const table = () => __internals.tablesByNpc.get(HYDRA)[0];
const player = () => ({ getAttribute: () => undefined, getInventory: () => ({ getAmount: () => 0 }), getBanks: () => [] });
const uniqueIds = () => new Set(table().entries.filter((entry) => entry.pre_roll).map((entry) => entry.item_id));

/** Items of the main table's own rows (not the pre-roll, the herb rolls or the shared tables). */
const mainTableIds = () => new Set(table().entries
  .filter((entry) => !entry.always && !entry.pre_roll && !entry.separate_roll && entry.item_id)
  .map((entry) => entry.item_id));

function withRandom(random, action) {
  const original = Math.random;
  Math.random = random;
  try {
    return action();
  } finally {
    Math.random = original;
  }
}

/** A small seeded generator, so the simulation gives the same counts every run. */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("two rolls on the Hydra's table per kill", () => {
  assert.equal(table().rolls, 2);
});

test("other multi-roll tables still try their pre-roll on every roll (Marble gargoyle: 3 rolls)", () => {
  const gargoyle = [...__internals.tablesByNpc.values()].flat().find((t) => t.table_id === "marble_gargoyle");
  assert.equal(gargoyle.rolls, 3);
  const drops = withRandom(() => 0, () => __internals.rollTable(gargoyle, player(), null));
  const granite = gargoyle.entries.find((entry) => entry.pre_roll).item_id;
  assert.equal(drops.filter((drop) => drop.itemId === granite).length, 3, JSON.stringify(drops));
});

test("a pre-roll hit on the first roll is followed by a standard drop, never a second unique", () => {
  // Every random draw at 0 hits the first pre-roll row the moment it is tried.
  const drops = withRandom(() => 0, () => __internals.rollTable(table(), player(), null));
  const uniques = drops.filter((drop) => uniqueIds().has(drop.itemId));
  const main = drops.filter((drop) => mainTableIds().has(drop.itemId));
  assert.equal(uniques.length, 1, JSON.stringify(drops));
  assert.equal(main.length, 1, `the second roll goes to the main table: ${JSON.stringify(drops)}`);
});

test("over many kills: one unique at most, the pre-roll once, standard rows twice", () => {
  const kills = 200000;
  const entries = table().entries;
  const preRolls = entries.filter((entry) => entry.pre_roll);
  const preRollChance = 1 - preRolls.reduce((miss, entry) => miss * (1 - entry.weight / entry.out_of), 1);
  const dragonBones = entries.find((entry) => entry.item_id === DRAGON_BONES && !entry.pre_roll);
  const dragonBonesChance = dragonBones.weight / table().main_max_roll;

  const unique = uniqueIds();
  let killsWithUnique = 0;
  let dragonBoneDrops = 0;
  withRandom(seeded(0x4879), () => {
    for (let kill = 0; kill < kills; kill++) {
      const drops = __internals.rollTable(table(), player(), null);
      const uniques = drops.filter((drop) => unique.has(drop.itemId)).length;
      assert.ok(uniques <= 1, `kill ${kill} gave ${uniques} uniques`);
      if (uniques) killsWithUnique++;
      dragonBoneDrops += drops.filter((drop) => drop.itemId === DRAGON_BONES).length;
    }
  });

  // The pre-roll is tried once per kill, not once per roll.
  const uniqueRate = killsWithUnique / kills;
  assert.ok(Math.abs(uniqueRate - preRollChance) < 0.1 * preRollChance,
    `unique per kill ${uniqueRate} vs ${preRollChance}`);
  // A standard row is rolled twice, less the first rolls the pre-roll took.
  const expected = dragonBonesChance * (2 - preRollChance);
  const boneRate = dragonBoneDrops / kills;
  assert.ok(Math.abs(boneRate - expected) < 0.05 * expected, `dragon bones per kill ${boneRate} vs ${expected}`);
});
