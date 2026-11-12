// Run after `yarn build`: node --test tests/npc-drops-herb-roll-counts.test.cjs
// A shared-table access row with `roll_count_weights` rolls its table that many times once the access hits (the
// weights are relative; the access chance is not multiplied again). Through the real NpcDrops loader and roller:
// the aberrant spectre's 78/128 herb access gives 1, 2 or 3 herbs (11/26, 11/26, 4/26), the deviant spectre's
// 46/128 access gives 2 or 3 (29/17). Expected means come from the entry data.
// repugnant_spectre and bloodthirsty_repugnant_spectre are NOT covered: the Wiki gives every one of their rows rolls=3 but the
// export carries no `rolls` for them, so they are expected to stay near 0.85 herbs per kill until the producer exports it;
// do not change that number to make a test pass.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Location } = require("../dist/game/model/Location");
const Drops = require("../plugins/npcs/NpcDrops.plugin");
const dump = require("../data/definitions/npc-drops.json");
const subtables = require("../data/definitions/npc-drop-subtables.json");

before(() => {
  CachePipeline.initialize();
  const core = PluginManager.getCoreApi();
  const api = new Proxy({ core, emitCustomEvent: () => {}, getPluginConfig: (_key, fallback) => fallback },
    { get: (target, key) => (key in target ? target[key] : () => {}) });
  Drops.register(api);
  Drops.__internals.loadDrops();
});

const HERBS = new Set(subtables.herb.entries.filter((entry) => Number.isInteger(entry.item_id)).map((entry) => entry.item_id));
const player = { getEquipment: () => ({ get: () => null, getItems: () => [] }), getAttribute: () => undefined };
const npcFor = (id) => ({
  getId: () => id,
  getLocation: () => new Location(3400, 3550, 2),
  getCurrentDefinition: () => ({ getName: () => "Spectre", getCombatLevel: () => 96 }),
});
// Seeded so the statistics do not flake.
const seeded = (seed) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** Herb items dropped per kill over `kills` kills of the table. */
function herbsPerKill(t, id, kills) {
  t.mock.method(Math, "random", seeded(12345));
  const npcId = Number(Object.entries(dump.npcs).find(([, npc]) => npc.tables.includes(id))[0]);
  const table = Drops.__internals.tablesByNpc.get(npcId).find((candidate) => candidate.table_id === id);
  const counts = [];
  for (let kill = 0; kill < kills; kill++) {
    counts.push(Drops.__internals.rollTable(table, player, npcFor(npcId)).filter((drop) => HERBS.has(drop.itemId)).reduce((sum, drop) => sum + drop.amount, 0));
  }
  return counts;
}

const herbRow = (id) => dump.tables[id].entries.find((entry) => entry.shared_table === "herb");
const expectedMean = (id) => {
  const row = herbRow(id), total = row.roll_count_weights.reduce((sum, w) => sum + w.weight, 0);
  return row.weight / row.out_of * row.roll_count_weights.reduce((sum, w) => sum + w.rolls * w.weight, 0) / total;
};

test("the aberrant spectre's herb access gives 1 to 3 herbs, the data-derived mean per kill (about 1.0547)", (t) => {
  const counts = herbsPerKill(t, "aberrant_spectre", 20000);
  const mean = counts.reduce((sum, n) => sum + n, 0) / counts.length;
  assert.ok(Math.abs(expectedMean("aberrant_spectre") - 1.0547) < 1e-3);
  assert.ok(Math.abs(mean - expectedMean("aberrant_spectre")) < 0.05, `mean ${mean}`);
  const largest = Math.max(...herbRow("aberrant_spectre").roll_count_weights.map((w) => w.rolls));
  assert.equal(Math.max(...counts), largest, "three herbs happen, never more");
  assert.ok(counts.filter((n) => n === 2).length / counts.length > 0.1, "kills with exactly two herbs");
});

test("the deviant spectre's herb access gives at least two herbs when it hits (about 0.8516 per kill)", (t) => {
  const counts = herbsPerKill(t, "deviant_spectre", 20000);
  const mean = counts.reduce((sum, n) => sum + n, 0) / counts.length;
  assert.ok(Math.abs(expectedMean("deviant_spectre") - 0.8516) < 1e-3);
  assert.ok(Math.abs(mean - expectedMean("deviant_spectre")) < 0.05, `mean ${mean}`);
  assert.ok(!counts.includes(1), "a hit is never a single herb");
  assert.ok(counts.includes(2) && counts.includes(3));
});

test("a row with an unresolved roll count and no weights (eagle ray) still rolls the herb table once", (t) => {
  // Not the hydras: they also carry separate flat Grimy avantoe and ranarr rows, so a kill can legitimately give two herbs.
  const row = herbRow("eagle_ray");
  assert.equal(row.unresolved_roll_count, true);
  assert.equal(row.roll_count_weights, undefined);
  const counts = herbsPerKill(t, "eagle_ray", 5000);
  assert.ok(Math.max(...counts) <= 1, "never more than one herb");
  assert.ok(counts.includes(1));
});
