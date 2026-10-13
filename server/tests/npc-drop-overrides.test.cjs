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
