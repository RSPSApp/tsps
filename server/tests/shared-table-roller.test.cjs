// Run after `yarn build`: node --test tests/shared-table-roller.test.cjs
//
// Shared drop tables (rare -> gem -> mega-rare, herbs ...) are rolled by rollSharedTable: one roll of the table's
// pool, a walk over the per-item n/outOf slots, a roll past the last slot is a miss, a nested table is followed up to
// depth 4 and no further, and a ring of wealth removes the empty slots from rareDrop/gem/megaRare. These tests drive it
// with a seeded or scripted Math.random over small synthetic tables put in the loader's own sharedTables map (real
// tables are restored afterwards), so the weights and the cap are checked without depending on the Wiki data.
// Out of scope here: the categorised tables (seed, chosen by combat level), covered by npc-drops-seed-categories and
// npc-drops-seed-integration.
const assert = require("node:assert/strict");
const { test, before, afterEach } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const Drops = require("../plugins/npcs/NpcDrops.plugin");

const { sharedTables, rollSharedTable } = Drops._test;

before(() => {
  CachePipeline.initialize();
  const core = PluginManager.getCoreApi();
  // Legends' Quest complete, so the gem table's last slot reaches the real mega-rare table instead of the talisman.
  const api = new Proxy({
    core,
    emitCustomEvent: (name, event) => { if (name === "quest:is-complete" && event.key === "legends_quest") event.complete = true; },
    getPluginConfig: (_key, fallback) => fallback,
  }, { get: (target, key) => (key in target ? target[key] : () => {}) });
  Drops.register(api);
  Drops._test.loadDrops();
});

/** Tables this file added or replaced, put back after each test. */
const touched = new Map();
function put(name, entries) {
  if (!touched.has(name)) touched.set(name, sharedTables.has(name) ? sharedTables.get(name) : undefined);
  sharedTables.set(name, entries);
}
afterEach((t) => {
  t.mock.restoreAll();
  for (const [name, original] of touched) {
    if (original === undefined) sharedTables.delete(name); else sharedTables.set(name, original);
  }
  touched.clear();
});

const item = (itemId, weight, outOf, quantity = [1, 1], noted = false) => ({ itemId, quantity, noted, weight, outOf });
const ref = (name, weight, outOf) => ({ ref: name, weight, outOf });
const nothing = (weight, outOf) => ({ nothing: true, weight, outOf });

const plain = { getEquipment: () => ({ get: () => null }) };
const wealthy = { getEquipment: () => ({ get: () => ({ getId: () => 11980 }) }) };

/** Rolls `name` with Math.random fixed to the middle of slot `slot` of `outOf`. */
function atSlot(t, name, slot, outOf, player = plain) {
  t.mock.method(Math, "random", () => (slot + 0.5) / outOf);
  try { return rollSharedTable(name, player); } finally { t.mock.restoreAll(); }
}

const seeded = (seed) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

test("a roll walks the cumulative weights: each slot range gives its item, a roll past the last slot is a miss", (t) => {
  // 10 slots: item 11 takes 0-2, item 22 takes 3-4, an empty row takes 5, slots 6-9 are past the last weighted row.
  put("t_weights", [item(11, 3, 10), item(22, 2, 10), nothing(1, 10)]);
  const expected = [11, 11, 11, 22, 22, null, null, null, null, null];
  for (let slot = 0; slot < 10; slot++) {
    const drops = atSlot(t, "t_weights", slot, 10);
    if (expected[slot] === null) assert.deepEqual(drops, [], `slot ${slot} is a miss`);
    else assert.deepEqual(drops, [{ itemId: expected[slot], amount: 1, noted: false }], `slot ${slot}`);
  }
});

test("a seeded run lands each item at weight/outOf and misses at the rest", (t) => {
  put("t_freq", [item(11, 3, 10), item(22, 2, 10), nothing(1, 10)]);
  t.mock.method(Math, "random", seeded(31));
  const counts = { 11: 0, 22: 0, none: 0 };
  const rolls = 100000;
  for (let i = 0; i < rolls; i++) {
    const [drop] = rollSharedTable("t_freq", plain);
    counts[drop ? drop.itemId : "none"]++;
  }
  assert.ok(Math.abs(counts[11] / rolls - 0.3) < 0.01, `item 11 ${counts[11] / rolls}`);
  assert.ok(Math.abs(counts[22] / rolls - 0.2) < 0.01, `item 22 ${counts[22] / rolls}`);
  assert.ok(Math.abs(counts.none / rolls - 0.5) < 0.01, `miss ${counts.none / rolls}`);
});

test("a row's quantity range is rolled uniformly between its bounds and a noted row stays noted", (t) => {
  put("t_quantity", [item(33, 1, 1, [2, 4], true)]);
  t.mock.method(Math, "random", seeded(5));
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const [drop] = rollSharedTable("t_quantity", plain);
    assert.equal(drop.noted, true);
    seen.add(drop.amount);
  }
  assert.deepEqual([...seen].sort(), [2, 3, 4]);
});

test("an unknown or empty table rolls nothing", () => {
  assert.deepEqual(rollSharedTable("t_missing", plain), []);
  put("t_empty", []);
  assert.deepEqual(rollSharedTable("t_empty", plain), []);
});

test("a ring of wealth removes the empty slots of the rare, gem and mega-rare tables only", (t) => {
  for (const name of ["rareDrop", "gem", "megaRare"]) {
    put(name, [item(44, 1, 4), nothing(3, 4)]);
    // Without the ring only slot 0 gives the item; with it the pool is the item alone, so every roll does.
    assert.deepEqual(atSlot(t, name, 3, 4, plain), [], `${name} without the ring`);
    assert.deepEqual(atSlot(t, name, 3, 4, wealthy), [{ itemId: 44, amount: 1, noted: false }], `${name} with the ring`);
  }
  put("t_other", [item(44, 1, 4), nothing(3, 4)]);
  assert.deepEqual(atSlot(t, "t_other", 3, 4, wealthy), [], "any other table keeps its empty slots");
});

/** A chain c0 -> c1 -> ... where every table's only row always follows the next, the last always gives an item. */
function chain(length) {
  for (let i = 0; i < length; i++) put(`c${i}`, [i === length - 1 ? item(55, 1, 1) : ref(`c${i + 1}`, 1, 1)]);
}

test("a chain of nested tables resolves down to depth 4", () => {
  chain(5); // c0 .. c4: the item sits at depth 4
  assert.deepEqual(rollSharedTable("c0", plain), [{ itemId: 55, amount: 1, noted: false }]);
});

test("a nested table past depth 4 is cut off and rolls nothing", () => {
  chain(6); // the item would sit at depth 5
  assert.deepEqual(rollSharedTable("c0", plain), []);
  // The cap counts from where the roll starts: from c1 the same item is at depth 4 again.
  assert.deepEqual(rollSharedTable("c1", plain), [{ itemId: 55, amount: 1, noted: false }]);
});

test("a table that nests itself, or two that nest each other, end the roll instead of hanging it", () => {
  put("loop_self", [ref("loop_self", 1, 1)]);
  assert.deepEqual(rollSharedTable("loop_self", plain), []);
  put("loop_a", [ref("loop_b", 1, 1)]);
  put("loop_b", [ref("loop_a", 1, 1)]);
  assert.deepEqual(rollSharedTable("loop_a", plain), []);
});

test("the real gem table's last slot reaches the real mega-rare table (Legends' Quest done), one item deep", (t) => {
  const megaIds = new Set(sharedTables.get("megaRare").filter((entry) => entry.itemId).map((entry) => entry.itemId));
  assert.ok(megaIds.size > 0);
  t.mock.method(Math, "random", () => 0.999999);
  const drops = rollSharedTable("gem", plain);
  assert.equal(drops.length, 1);
  assert.ok(megaIds.has(drops[0].itemId), `item ${drops[0].itemId} is not a mega-rare row`);
});

test("the real rare drop table gives at most one valid item per roll", (t) => {
  t.mock.method(Math, "random", seeded(77));
  for (let i = 0; i < 20000; i++) {
    const drops = rollSharedTable("rareDrop", plain);
    assert.ok(drops.length <= 1, `roll ${i} gave ${drops.length} items`);
    for (const drop of drops) assert.ok(Number.isInteger(drop.itemId) && drop.amount > 0);
  }
});
