// Run after `yarn build`: node --test tests/npc-drop-overrides.test.cjs
// Hand edits to the drop tables live in npc-drop-overrides.json, on top of the Wiki dump
// (docs/npc-drops.md), so a new dump can't undo them.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { _test } = require("../plugins/npcs/NpcDrops.plugin");
const { __internals } = require("../plugins/npcs/NpcDrops.plugin");
const dump = require("../data/definitions/npc-drops.json");
const subtables = require("../data/definitions/npc-drop-subtables.json");
const overrides = require("../data/definitions/npc-drop-overrides.json");

before(() => _test.loadDrops());

const dropPlayer = { getEquipment: () => ({ get: () => null, getItems: () => [] }) };

test("shared seed categories follow the defeated NPC combat level and threshold boundaries", (t) => {
  const name = "test-combat-categories";
  const item = (itemId) => [{ itemId, quantity: [1, 1], weight: 1, outOf: 1 }];
  _test.sharedTables.set(name, { combat_level_multiplier: 10, categories: [
    { minimum: 0, maximum_exclusive: 485, entries: item(5318) },
    { minimum: 485, maximum_exclusive: 728, entries: item(5305) },
    { minimum: 728, maximum_exclusive: 850, entries: item(5096) },
    { minimum: 850, maximum_exclusive: 947, entries: item(5101) },
    { minimum: 947, maximum_exclusive: 995, entries: item(5291) },
    { minimum: 995, entries: item(5282) },
  ] });
  t.after(() => _test.sharedTables.delete(name));
  let value = 0;
  t.mock.method(Math, "random", () => value);
  const table = { entries: [{ shared_table: name, always: true }] };
  function rolled(level, roll) {
    value = roll;
    const npc = { getCurrentDefinition: () => ({ getCombatLevel: () => level }) };
    return __internals.rollTable(table, dropPlayer, npc)[0]?.itemId;
  }
  assert.equal(rolled(28, 0.999999), 5318, "low-level monsters cannot reach hops");
  for (const [threshold, below, above] of [[485, 5318, 5305], [728, 5305, 5096],
    [850, 5096, 5101], [947, 5101, 5291], [995, 5291, 5282]]) {
    assert.equal(rolled(100, (threshold - 0.01) / 1000), below);
    assert.equal(rolled(100, threshold / 1000), above);
  }
});

test("multi-herb accesses select a batch size then roll each herb independently", (t) => {
  const name = "test-herb-batches";
  _test.sharedTables.set(name, [
    { itemId: 199, quantity: [1, 1], weight: 1, outOf: 2 },
    { itemId: 201, quantity: [1, 1], weight: 1, outOf: 2 },
  ]);
  t.after(() => _test.sharedTables.delete(name));
  let values = [];
  t.mock.method(Math, "random", () => values.shift() ?? 0);
  const table = { entries: [{ shared_table: name, always: true,
    roll_count_weights: [{ rolls: 1, weight: 11 }, { rolls: 2, weight: 11 }, { rolls: 3, weight: 4 }] }] };
  for (const [roll, count] of [[0, 1], [10.999 / 26, 1], [11 / 26, 2], [21.999 / 26, 2], [22 / 26, 3], [0.999999, 3]]) {
    values = [roll, 0, 0, 0.75, 0, 0, 0];
    const drops = __internals.rollTable(table, dropPlayer, null);
    assert.equal(drops.length, count);
    assert.deepEqual(drops.map(drop => drop.itemId), [199, 201, 199].slice(0, count));
  }
});

test("exclusive pre-roll outcomes share one weighted draw", (t) => {
  let value = 0;
  t.mock.method(Math, "random", () => value);
  const table = { main_max_roll: 1, entries: [
    { item_id: 1205, quantity: [1, 1], pre_roll: true, weight: 1, out_of: 4 },
    { item_id: 1203, quantity: [1, 1], pre_roll: true, weight: 1, out_of: 4 },
    { item_id: 995, quantity: [1, 1], weight: 1, out_of: 1 },
  ] };
  for (const [roll, expected] of [[0, 1205], [0.249999, 1205], [0.25, 1203], [0.499999, 1203], [0.5, 995]]) {
    value = roll;
    assert.deepEqual(__internals.rollTable(table, dropPlayer, null).map(drop => drop.itemId), [expected]);
  }
});

test("fixed shared batches keep their count while unknown distributions remain unresolved", (t) => {
  const name = "test-fixed-shared-batch";
  _test.sharedTables.set(name, [{ itemId: 199, quantity: [1, 1], weight: 1, outOf: 1 }]);
  t.after(() => _test.sharedTables.delete(name));
  const roll = fields => __internals.rollTable({ entries: [{ always: true, shared_table: name, ...fields }] }, dropPlayer, null);
  assert.equal(roll({ roll_count: [3, 3] }).length, 3);
  assert.deepEqual(roll({ unresolved_roll_count: true }), []);
  assert.deepEqual(roll({ roll_count: [1, 3] }), [], "a quantity range alone does not establish its probability distribution");
});

test("every exported pre-roll has an executable probability", () => {
  const invalid = [];
  for (const [id, table] of Object.entries(dump.tables)) {
    for (const entry of table.entries || []) {
      if (entry.pre_roll && !(Number.isFinite(entry.out_of) && entry.out_of > 0 &&
          Number.isFinite(entry.weight) && entry.weight > 0 && entry.weight <= entry.out_of)) {
        invalid.push(`${id}: ${entry.name || 'Nothing'}`);
      }
    }
  }
  assert.deepEqual(invalid, [], "rare pre-rolls must remain obtainable");
});

test("regenerated giant-key and Sarachnis unique slots are obtainable through the real roller", (t) => {
  let value = 0;
  t.mock.method(Math, "random", () => value);
  const tables = [..._test.tablesByNpc.values()].flat();
  const giant = tables.find(table => table.table_id === "hill_giant");
  assert.ok(__internals.rollTable(giant, dropPlayer, null).some(drop => drop.itemId === 20754));
  const sarachnis = tables.find(table => table.table_id === "sarachnis");
  value = 2 / 384;
  assert.ok(__internals.rollTable(sarachnis, dropPlayer, null).some(drop => drop.itemId === 23528));
});

test("every exported shared-table access resolves to a named table", () => {
  const invalid = [];
  for (const [id, table] of Object.entries(dump.tables)) {
    for (const entry of [...(table.entries || []), ...(table.tertiary || [])]) {
      if (Object.hasOwn(entry, "shared_table") &&
          (!entry.shared_table || !Object.hasOwn(subtables, entry.shared_table) &&
            !Object.hasOwn(overrides.subtables, entry.shared_table))) {
        invalid.push(`${id}: ${JSON.stringify(entry.shared_table)}`);
      }
    }
  }
  assert.deepEqual(invalid, [], "shared herb/seed accesses must not silently yield nothing");
});

test("the generated files hold no hand edits: each override changes something the dump lacks", () => {
  for (const id of Object.keys(overrides.removeNpcs)) assert.ok(!_test.tablesByNpc.has(Number(id)), `${id} removed`);
  for (const id of Object.keys(overrides.addNpcs).filter((key) => key !== "$comment")) {
    assert.ok(_test.tablesByNpc.has(Number(id)), `${overrides.addNpcs[id].name} (${id}) has its table`);
  }
  // Overrides that the dump already covers would be dead weight: the dump would win anyway.
  const covered = Object.keys(overrides.addNpcs).filter((id) => id !== "$comment" && dump.npcs[id]);
  assert.deepEqual(covered, [], "the dump maps these itself now: remove them from the overrides");
  for (const name of Object.keys(overrides.subtables)) assert.equal(subtables[name], undefined, `${name} is in the dump now`);
  for (const [id, change] of Object.entries(overrides.tables)) {
    for (const section of change.removeSections ?? []) {
      assert.ok(dump.tables[id].entries.some((entry) => entry.section === section), `${id} has no ${section} section in the dump now`);
    }
  }
});

test("Yama's normal kill leaves out what his contracts reward", () => {
  const yama = _test.tablesByNpc.get(14176)[0];
  assert.ok(!yama.entries.some((entry) => entry.section === "Contract"));
  assert.ok(yama.entries.some((entry) => entry.item_id === 30803), "the dossier");
});

test("the Ents drop nothing themselves (their trunk does), and the Sire keeps its pet", () => {
  for (const id of [6594, 7234, 9474]) assert.equal(_test.tablesByNpc.get(id), undefined);
  const sire = Object.values(dump.npcs).find((npc) => npc.tables?.includes("abyssal_sire"));
  const tables = _test.tablesByNpc.get(sire.npc_id);
  assert.ok(tables.some((table) => (table.tertiary || []).some((entry) => entry.item_id === 13262)), "Abyssal orphan");
  assert.ok(_test.sharedTables.has("uncommonSeed"), "the uncommon seed table (Obor, Bryophyta)");
});

test("drops the Wiki marks noted come noted, without a hand-made list", () => {
  const corp = _test.tablesByNpc.get(319)[0];
  assert.equal(corp.entries.find((entry) => entry.item_id === 451).noted, true, "Corp's runite ore");
  let noted = 0;
  for (const tables of _test.tablesByNpc.values()) for (const table of tables) noted += (table.entries || []).filter((entry) => entry.noted).length;
  assert.ok(noted > 2000, `${noted} noted entries`);
});
