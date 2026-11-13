// Run after `yarn build`: node --test tests/npc-drops-superior-rolls.test.cjs
// A superior Slayer monster's page gives every row of its main table `rolls=3`; the export carries it as the
// table's `rolls`. Through the real NpcDrops loader and roller, one kill of the repugnant spectre rolls its herb,
// gem and rare-seed accesses three times each: herbs about 0.8516 -> 2.5547 per kill, gem amounts 3 x their single-roll
// expectation, rare-seed amounts the same (amounts, so the row quantities count). Expected values come from the entry and
// subtable data.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Location } = require("../dist/game/model/Location");
const Drops = require("../plugins/npcs/NpcDrops.plugin");
const dump = require("../data/definitions/npc-drops.json");
const subtables = require("../data/definitions/npc-drop-subtables.json");

const TABLE = "repugnant_spectre";

before(() => {
  CachePipeline.initialize();
  const core = PluginManager.getCoreApi();
  const api = new Proxy({ core, emitCustomEvent: () => {}, getPluginConfig: (_key, fallback) => fallback },
    { get: (target, key) => (key in target ? target[key] : () => {}) });
  Drops.register(api);
  Drops.__internals.loadDrops();
});

const player = { getEquipment: () => ({ get: () => null, getItems: () => [] }), getAttribute: () => undefined };
const seeded = (seed) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const access = (key) => dump.tables[TABLE].entries.find((entry) => entry.shared_table === key);
const itemIds = (key) => new Set(subtables[key].entries.filter((row) => Number.isInteger(row.item_id) && !row.shared_table).map((row) => row.item_id));
/** Mean amount of a row (the loader's quantity: a number or a min-max range, rolled uniformly). */
const meanQuantity = (raw) => {
  const numbers = String(raw ?? "1").match(/\d+/g)?.map(Number) ?? [1];
  return numbers.length > 1 ? (numbers[0] + numbers[1]) / 2 : numbers[0];
};
/** Expected item amount of the table's own item rows per single roll of the access (the test sums drop.amount). */
const perRoll = (key) => {
  const row = access(key);
  let amount = 0;
  for (const entry of subtables[key].entries) {
    if (!Number.isInteger(entry.item_id) || entry.shared_table) continue;
    const [weight, outOf] = entry.rarity_raw.split("/").map(Number);
    amount += weight / outOf * meanQuantity(entry.quantity_raw);
  }
  return row.weight / row.out_of * amount;
};
const herbMean = () => {
  const row = access("herb"), total = row.roll_count_weights.reduce((sum, w) => sum + w.weight, 0);
  return row.weight / row.out_of * row.roll_count_weights.reduce((sum, w) => sum + w.rolls * w.weight, 0) / total;
};

function perKill(t, kills) {
  t.mock.method(Math, "random", seeded(2024));
  const npcId = Number(Object.entries(dump.npcs).find(([, npc]) => npc.tables.includes(TABLE))[0]);
  const table = Drops.__internals.tablesByNpc.get(npcId).find((candidate) => candidate.table_id === TABLE);
  const npc = { getId: () => npcId, getLocation: () => new Location(3400, 3550, 2), getCurrentDefinition: () => ({ getName: () => "Repugnant spectre", getCombatLevel: () => 169 }) };
  const sets = { herb: itemIds("herb"), gem: itemIds("gem"), rareSeed: itemIds("rareSeed") };
  const totals = { herb: 0, gem: 0, rareSeed: 0 };
  for (let kill = 0; kill < kills; kill++) {
    for (const drop of Drops.__internals.rollTable(table, player, npc)) {
      for (const key of Object.keys(sets)) if (sets[key].has(drop.itemId)) totals[key] += drop.amount;
    }
  }
  return Object.fromEntries(Object.entries(totals).map(([key, n]) => [key, n / kills]));
}

test("the repugnant spectre's table is rolled three times per kill", () => {
  assert.equal(dump.tables[TABLE].rolls, 3);
});

test("one kill gives three rolls of the herb, gem and rare-seed accesses, not one", (t) => {
  const mean = perKill(t, 40000);
  assert.ok(Math.abs(herbMean() * 3 - 2.5547) < 2e-3, `data-derived herbs ${herbMean() * 3}`);
  assert.ok(Math.abs(mean.herb - herbMean() * 3) < 0.08, `herbs ${mean.herb} vs ${herbMean() * 3}`);
  for (const key of ["gem", "rareSeed"]) {
    const expected = perRoll(key) * 3;
    assert.ok(Math.abs(mean[key] - expected) < Math.max(0.03, expected * 0.08), `${key} ${mean[key]} vs ${expected}`);
    assert.ok(mean[key] > perRoll(key) * 2, `${key} is more than two rolls' worth`);
  }
});

// Superiors whose page states "will always roll 3 additional items" but whose export had no `rolls` because one row (or the
// gem access) left `rolls=3` off: the producer now exports the count the page states. One kill makes three main rolls.
const STATED = ["chasm_crawler", "king_kurask", "mutated_tortoise"];

for (const key of STATED) {
  test(`${key} is rolled three times per kill`, (t) => {
    const stated = dump.tables[key];
    assert.equal(stated.rolls, 3);
    assert.ok(!stated.entries.some((entry) => entry.once_per_kill && !entry.separate_roll), "no pre-roll row to keep once (an independent row may be)");
    t.mock.method(Math, "random", seeded(77));
    const npcId = Number(Object.entries(dump.npcs).find(([, npc]) => npc.tables.includes(key))[0]);
    const table = Drops.__internals.tablesByNpc.get(npcId).find((candidate) => candidate.table_id === key);
    const npc = { getId: () => npcId, getLocation: () => new Location(3400, 3550, 2), getCurrentDefinition: () => ({ getName: () => key, getCombatLevel: () => 100 }) };
    const rows = table.entries.filter((entry) => !entry.always && !entry.pre_roll && !entry.separate_roll && !entry.shared_table && Number.isInteger(entry.item_id) && entry.item_id > 0
      && Number.isFinite(entry.weight) && entry.weight > 0);
    const ids = new Set(rows.map((entry) => entry.item_id));
    const perRoll = rows.reduce((sum, entry) => sum + entry.weight, 0) / table.main_max_roll;
    const kills = 30000;
    let hits = 0;
    for (let kill = 0; kill < kills; kill++) {
      for (const drop of Drops.__internals.rollTable(table, player, npc)) if (ids.has(drop.itemId)) hits++;
    }
    const mean = hits / kills;
    assert.ok(Math.abs(mean - perRoll * 3) < Math.max(0.03, perRoll * 3 * 0.06), `${key} ${mean} vs ${perRoll * 3}`);
    assert.ok(mean > perRoll * 2, `${key} is more than two rolls' worth`);
  });
}

// An independent (separate_roll) row of a repeated table is rolled once per kill when the Wiki gives it no `rolls`, and
// as often as the table when it does. Chasm crawler's moon key tooth half is the first kind (a single 1/729 roll; the
// pinned cache files it under Other, the live page under Tertiary); King kurask's three weapon rows are the second.
test("a separate_roll row flagged once_per_kill is rolled once however many times its table repeats", () => {
  const table = (flag) => ({ main_max_roll: 1, rolls: 3, tertiary: [], entries: [{ item_id: 4151, name: "x", quantity: [1, 1], separate_roll: true, weight: 1, out_of: 1, ...(flag ? { once_per_kill: true } : {}) }] });
  const count = (flag) => Drops.__internals.rollTable(table(flag), player, { getId: () => 1, getLocation: () => new Location(3400, 3550, 2), getCurrentDefinition: () => ({ getName: () => "x", getCombatLevel: () => 1 }) }).length;
  assert.equal(count(false), 3, "an unflagged always-hit row is tried once per roll");
  assert.equal(count(true), 1, "a flagged row is tried once per kill");
});

test("chasm crawler's moon key tooth half carries once_per_kill; king kurask's explicit rolls=3 rows do not", () => {
  const moon = dump.tables.chasm_crawler.entries.find((entry) => entry.item_id === 30105);
  assert.ok(moon.separate_roll && moon.once_per_kill === true);
  for (const name of ["Leaf-bladed sword", "Mystic robe top (light)", "Leaf-bladed battleaxe"]) {
    const row = dump.tables.king_kurask.entries.find((entry) => entry.name === name);
    assert.ok(row.separate_roll && !row.once_per_kill, `${name} is repeated with the table (rolls=3 on the Wiki)`);
  }
});

test("through the real roller the moon key tooth half comes out at its single 1/729 rate, not three times it", () => {
  const real = dump.tables.chasm_crawler;
  // The Ruins of Tapoyauik location gate is bypassed (notes cleared) so only the roll count is measured.
  const asLoaded = (once) => ({ ...real, entries: real.entries.map((entry) => entry.item_id === 30105
    ? { ...entry, notes: [], ...(once ? {} : { once_per_kill: undefined }) } : entry) });
  const npcId = Number(Object.entries(dump.npcs).find(([, npc]) => npc.tables.includes("chasm_crawler"))[0]);
  const npc = { getId: () => npcId, getLocation: () => new Location(3400, 3550, 2), getCurrentDefinition: () => ({ getName: () => "Chasm crawler", getCombatLevel: () => 79 }) };
  const rate = (table, kills) => {
    // Assigned by hand: t.mock would record every one of the millions of calls.
    const original = Math.random;
    Math.random = seeded(404);
    let hits = 0;
    try {
      for (let kill = 0; kill < kills; kill++) for (const drop of Drops.__internals.rollTable(table, player, npc)) if (drop.itemId === 30105) hits++;
    } finally { Math.random = original; }
    return hits / kills;
  };
  const kills = 150000, single = 1 / 729;
  const flagged = rate(asLoaded(true), kills);
  assert.ok(flagged > single * 0.7 && flagged < single * 1.3, `flagged ${flagged} vs ${single}`);
  const unflagged = rate(asLoaded(false), kills);
  assert.ok(unflagged > single * 2.4, `without the flag the test would see about three rolls: ${unflagged}`);
});
