// Run after `yarn build`: node --test tests/npc-drop-overrides.test.cjs
// Hand edits to the drop tables live in npc-drop-overrides.json, on top of the Wiki dump
// (docs/npc-drops.md), so a new dump can't undo them.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { _test } = require("../plugins/npcs/NpcDrops.plugin");
const dump = require("../data/definitions/npc-drops.json");
const subtables = require("../data/definitions/npc-drop-subtables.json");
const overrides = require("../data/definitions/npc-drop-overrides.json");

before(() => _test.loadDrops());

test("Shellbane gryphon resolves the current Wiki page rather than the obsolete capitalized duplicate", (t) => {
  const tables = _test.tablesByNpc.get(14860);
  assert.equal(tables.length, 1);
  assert.equal(tables[0].wiki_page, "Shellbane gryphon");
  assert.equal(tables[0].main_max_roll, 128);
  assert.equal(tables[0].table_id, "shellbane_gryphon");
  assert.equal(dump.tables.shellbane_gryphon_2, undefined);
  const folly = tables[0].entries.find(entry => entry.item_id === 31245);
  assert.equal(folly.pre_roll, true);
  assert.equal(folly.out_of, 75);
  t.mock.method(Math, "random", () => 0);
  const { __internals } = require("../plugins/npcs/NpcDrops.plugin");
  const dropPlayer = { getEquipment: () => ({ get: () => null, getItems: () => [] }) };
  const rolled = __internals.rollTable(tables[0], dropPlayer, null);
  assert.ok(rolled.some(drop => drop.itemId === 31245), "the current pre-roll is obtainable");
  assert.ok(rolled.some(drop => drop.itemId === 532), "guaranteed bones remain");
  assert.ok(rolled.some(drop => drop.itemId === 31235), "guaranteed feathers remain");
});

test("the generated files hold no hand edits: each override changes something the dump lacks", () => {
  for (const id of Object.keys(overrides.removeNpcs)) assert.ok(!_test.tablesByNpc.has(Number(id)), `${id} removed`);
  for (const id of Object.keys(overrides.addNpcs).filter((key) => key !== "$comment")) {
    for (const table of overrides.addNpcs[id].tables) {
      assert.ok(dump.tables[table], `${id}: override references an existing table (${table})`);
    }
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

test("npc-drops-custom.json re-rates and removes dump rows and adds rows, ahead of the overrides", () => {
  const { __internals } = require("../plugins/npcs/NpcDrops.plugin");
  const row = (item_id, weight) => ({ item_id, name: `Item ${item_id}`, quantity: [1, 1], weight, out_of: 128 });
  const edited = { tables: { goblin: { main_max_roll: 128, entries: [row(1, 10), row(2, 5)], tertiary: [] } }, npcs: {} };
  __internals.applyCustomDrops(edited, {
    tables: {
      goblin: {
        removeEntries: [{ field: "entries", index: 1 }],
        setEntries: { "entries:0": { weight: 1.28 } },
        addEntries: [row(4, 2)],
      },
      missing: { addEntries: [row(9, 1)] },
    },
  });
  __internals.applyOverrides(edited, {}, { tables: { goblin: { addEntries: [row(3, 1), row(4, 9)] } } });
  const { entries } = edited.tables.goblin;
  assert.deepEqual(entries.map((entry) => entry.item_id), [1, 4, 3], "an item already on the table is not added twice");
  assert.equal(entries[0].weight, 1.28);
  assert.equal(entries[0].rarity, 1.28 / 128);
  assert.equal(entries[1].weight, 2, "the world's own row wins");
});

test("npc-drops-custom.json sets a dump row's quantity to a fixed amount or a range", (t) => {
  const { __internals } = require("../plugins/npcs/NpcDrops.plugin");
  const row = (item_id) => ({ item_id, name: `Item ${item_id}`, quantity: [1, 1], weight: 128, out_of: 128 });
  const table = { main_max_roll: 128, entries: [row(1), row(2)], tertiary: [row(3)] };
  __internals.applyCustomDrops({ tables: { goblin: table }, npcs: {} }, {
    tables: {
      goblin: {
        setEntries: {
          "entries:0": { quantity: [7, 7], weight: 64 },
          "entries:1": { quantity: [20, 83] },
          "tertiary:0": { quantity: [2, 4] },
        },
      },
    },
  });
  assert.deepEqual(table.entries[0].quantity, [7, 7]);
  assert.deepEqual(table.entries[1].quantity, [20, 83]);
  assert.equal(table.entries[0].weight, 64, "a rate edit on the same row still applies");
  assert.deepEqual(table.tertiary[0].quantity, [2, 4]);
  assert.equal(table.entries[1].weight, 128, "a quantity edit leaves the rate alone");

  const amount = (random) => {
    t.mock.method(Math, "random", () => random);
    const [drop] = __internals.rollOnce(table, [table.entries[1]], null);
    Math.random.mock.restore();
    return drop.amount;
  };
  assert.equal(amount(0), 20);
  assert.equal(amount(0.999), 83);
});

test("a quantity edit replaces the row's conditional alternatives, which would otherwise win the roll", (t) => {
  const { __internals } = require("../plugins/npcs/NpcDrops.plugin");
  const entry = {
    item_id: 25766, name: "Malicious ashes", quantity: [1, 1], weight: 128, out_of: 128,
    quantity_selection: "unknown",
    quantity_alternatives: [{ quantity: [1, 1] }, { quantity: [2, 2], condition: { type: "preferred_method", location: "Chasm of Fire" } }],
  };
  const table = { main_max_roll: 128, entries: [entry], tertiary: [] };
  __internals.applyCustomDrops({ tables: { demon: table }, npcs: {} }, { tables: { demon: { setEntries: { "entries:0": { quantity: [50, 50] } } } } });
  assert.equal(entry.quantity_alternatives, undefined);
  assert.equal(entry.quantity_selection, undefined);
  t.mock.method(Math, "random", () => 0);
  assert.equal(__internals.rollOnce(table, table.entries, null)[0].amount, 50);
});

test("an unusable quantity edit leaves the row as it was", () => {
  const { __internals } = require("../plugins/npcs/NpcDrops.plugin");
  for (const quantity of [[0, 3], [5, 1], [1.5, 2], [1], [1, 2, 3], ["3", "3"], 5, null, [1, 2147483648]]) {
    const alternatives = [{ quantity: [1, 1] }];
    const entry = { item_id: 1, name: "Item 1", quantity: [2, 3], weight: 1, out_of: 128, quantity_alternatives: alternatives };
    __internals.applyCustomDrops({ tables: { goblin: { entries: [entry] } }, npcs: {} }, { tables: { goblin: { setEntries: { "entries:0": { quantity } } } } });
    assert.deepEqual(entry.quantity, [2, 3], JSON.stringify(quantity));
    assert.equal(entry.quantity_alternatives, alternatives, JSON.stringify(quantity));
  }
});

test("a fractional main weight stays on the main table", (t) => {
  const { __internals } = require("../plugins/npcs/NpcDrops.plugin");
  t.mock.method(Math, "random", () => 0);
  const table = { main_max_roll: 128, entries: [{ item_id: 995, name: "Coins", quantity: [1, 1], weight: 1.28, out_of: 128 }], tertiary: [] };
  assert.deepEqual(__internals.rollOnce(table, table.entries, null).map((drop) => drop.itemId ?? drop.id), [995]);
});
