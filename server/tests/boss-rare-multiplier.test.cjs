// Run after `yarn build`: node --test tests/boss-rare-multiplier.test.cjs
// world.json pluginConfig "NpcDrops:bossRareMultiplier" makes a boss's rare drops that many times
// likelier (docs/npc-drops.md).
const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const NpcDrops = require("../plugins/npcs/NpcDrops.plugin");

const config = {};
const random = Math.random;
const handlers = new Map();

function onCustomEvent(name, handler) {
  if (!handlers.has(name)) handlers.set(name, []);
  handlers.get(name).push(handler);
}

function emitCustomEvent(name, payload) {
  for (const handler of handlers.get(name) ?? []) handler(payload);
}

before(() => {
  CachePipeline.initialize();
  NpcDrops.register({
    core: { CacheDefinitions },
    getPluginConfig: (key, fallback) => (key in config ? config[key] : fallback),
    getItemOnGroundManager() {},
    onCustomEvent,
    emitCustomEvent,
    onNpcDeath() {},
    registerCommand() {},
    log() {},
  });
  NpcDrops._test.loadDrops();
});

after(() => {
  Math.random = random;
});

/** Item ids one kill of `table` drops, every roll landing at `roll` (0..1). */
function dropsAt(table, roll, multiplier) {
  config["NpcDrops:bossRareMultiplier"] = multiplier;
  Math.random = () => roll;
  try {
    return NpcDrops.__internals.rollTable(table, null, null).map((drop) => drop.itemId);
  } finally {
    Math.random = random;
  }
}

const table = (boss) => ({
  boss,
  entries: [
    { item_id: 1, separate_roll: true, weight: 1, out_of: 400 },
    { item_id: 2, separate_roll: true, weight: 1, out_of: 10 },
  ],
  tertiary: [{ item_id: 3, weight: 1, out_of: 400 }],
});

const mainTable = (boss) => ({
  boss,
  main_max_roll: 400,
  entries: [
    { item_id: 10, name: "Rare", weight: 1, out_of: 400, section: "Weapons and armour" },
    { item_id: 11, name: "Common", weight: 399, out_of: 400, section: "Weapons and armour" },
  ],
});

test("the cache's boss param marks boss tables, and only those", () => {
  const graardor = NpcDrops._test.tablesByNpc.get(2215)[0];
  assert.equal(graardor.boss, true, "General Graardor");
  const goblin = NpcDrops._test.tablesByNpc.get(3029)[0];
  assert.notEqual(goblin.boss, true, "goblin");
});

test("bosses the cache does not mark are boss tables too", () => {
  for (const [npcId, name] of [[124, "Yama"], [13668, "Araxxor"], [14860, "Shellbane gryphon"]]) {
    assert.equal(NpcDrops._test.tablesByNpc.get(npcId)[0].boss, true, name);
  }
});

test("a boss's rare separate and tertiary rolls are that many times likelier", () => {
  // 1.5/400: misses a 1/400 roll, hits a 2/400 one.
  assert.deepEqual(dropsAt(table(true), 1.5 / 400, 1), [2]);
  assert.deepEqual(dropsAt(table(true), 1.5 / 400, 2), [1, 2, 3]);
});

test("a boss's rare main roll is that many times likelier and common loot keeps its rate", () => {
  // 1.5/400 misses the 1/400 main row at x1 and hits it at x2; the 399/400 row still drops both times.
  assert.deepEqual(dropsAt(mainTable(true), 1.5 / 400, 1), [11]);
  assert.deepEqual(dropsAt(mainTable(true), 1.5 / 400, 2), [10, 11]);
  // A high multiplier does not crowd out the common row.
  assert.deepEqual(dropsAt(mainTable(true), 0.5, 1000), [10, 11]);
});

test("a unique or pre-roll row counts as rare even when it is more common than 1/100", () => {
  const unique = {
    boss: true,
    entries: [
      { item_id: 20, name: "Unique", separate_roll: true, weight: 1, out_of: 75, section: "Uniques" },
      { item_id: 21, name: "Pre-roll", pre_roll: true, weight: 1, out_of: 75, section: "Pre-roll" },
    ],
  };
  assert.deepEqual(dropsAt(unique, 1.5 / 75, 1), []);
  assert.deepEqual(dropsAt(unique, 1.5 / 75, 2), [20, 21]);
});

test("a 'unique' row that is ordinary loot is not boosted", () => {
  const essence = {
    boss: true,
    entries: [
      { item_id: 22, name: "Unique", separate_roll: true, weight: 60, out_of: 100, section: "Uniques" },
    ],
  };
  assert.deepEqual(dropsAt(essence, 0.7, 2), []);
});

test("the Dagannoth Kings' 1/128 rings are boosted on the main roll", () => {
  const rex = NpcDrops._test.tablesByNpc.get(2267)[0];
  const ring = rex.entries.find((entry) => entry.name === "Berserker ring");
  assert.equal(rex.boss, true, "Dagannoth Rex's table");
  config["NpcDrops:bossRareMultiplier"] = 1;
  assert.equal(NpcDrops.__internals.rareMultiplier(rex, ring), 1);
  config["NpcDrops:bossRareMultiplier"] = 1000;
  try {
    assert.equal(NpcDrops.__internals.rareMultiplier(rex, ring), 1000);
    Math.random = () => 0.5;
    const drops = NpcDrops.__internals.rollTable(rex, null, null);
    assert.ok(drops.some((drop) => drop.itemId === 6737), "Berserker ring drops");
  } finally {
    Math.random = random;
  }
});

test("a plugin table rolled for a boss takes the boss rare multiplier", () => {
  config["NpcDrops:bossRareMultiplier"] = 1000;
  Math.random = () => 1.5 / 400;
  try {
    const drops = [];
    emitCustomEvent("npc-drops:roll-table", { player: null, npcId: 2215, table: mainTable(false), drops });
    assert.deepEqual(drops.map((drop) => drop.itemId), [10, 11], "General Graardor's own table");
  } finally {
    Math.random = random;
  }
});

test("common drops and other monsters' drops keep their rates", () => {
  // 1.5/10 misses the 1/10 roll, and would hit it if it were doubled.
  assert.deepEqual(dropsAt(table(true), 1.5 / 10, 2), []);
  assert.deepEqual(dropsAt(table(false), 1.5 / 400, 2), [2]);
});

test("a missing or unusable setting is the OSRS rate", () => {
  for (const multiplier of [undefined, "fast", 0.5, -2]) {
    assert.deepEqual(dropsAt(table(true), 1.5 / 400, multiplier), [2], String(multiplier));
  }
});
