// Run after `yarn build`: node --test tests/zombie-pirate-drops.test.cjs
// The Chaos Temple zombie pirates have two drop tables. The Wiki gives the regular one a 15%
// chance of loot beyond bones and the Medium Wilderness Diary one 50%; the NPC lists the regular
// table first, so the diary table is only reached through npc-drops:table.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { _test, __internals } = require("../plugins/npcs/NpcDrops.plugin");
const pirates = require("../plugins/npcs/ZombiePirates.plugin");

before(() => _test.loadDrops());

const IDS = [13489, 13490, 13491, 13492, 13493];

/** A plugin API whose diary query answers `complete`. */
function stubApi(complete) {
  return {
    emitCustomEvent(name, request) {
      if (name === "diary:is-complete") request.complete = complete;
    },
    onCustomEvent() {},
  };
}

const nothingWeight = (table) => (table.entries.find((entry) => entry.nothing) || {}).weight;

test("both zombie pirate tables exist and match the Wiki's rates", () => {
  for (const id of IDS) {
    const tables = _test.tablesByNpc.get(id);
    assert.deepEqual(tables.map((table) => table.table_id), ["zombie_pirate_2", "zombie_pirate"]);
    // 1071/1260 nothing -> 15% of kills drop loot beyond bones.
    assert.equal(nothingWeight(tables[0]) / tables[0].main_max_roll, 0.85);
    // 189/378 nothing -> 50% with the Medium Wilderness Diary.
    assert.equal(nothingWeight(tables[1]) / tables[1].main_max_roll, 0.5);
  }
});

test("the dump maps only the regular table; npc-drop-overrides.json adds the diary one", () => {
  // The dumper exports both dropversion tables of the page but maps only the regular one, so the
  // diary table is unreachable without the override. If the dump ever maps both, drop the override.
  const dump = require("../data/definitions/npc-drops.json");
  for (const id of IDS) assert.deepEqual(dump.npcs[id].tables, ["zombie_pirate_2"]);
});

test("the diary table is chosen when the Medium Wilderness Diary is complete", () => {
  pirates.register(stubApi(true));
  const tables = _test.tablesByNpc.get(13489);
  const request = { player: {}, npcId: 13489, tables, table: null };
  pirates._test.chooseTable(request);
  assert.equal(request.table?.table_id, "zombie_pirate");
});

test("the regular table is kept when the diary is not complete", () => {
  pirates.register(stubApi(false));
  const tables = _test.tablesByNpc.get(13489);
  const request = { player: {}, npcId: 13489, tables, table: null };
  pirates._test.chooseTable(request);
  assert.equal(request.table, null);
});

test("other zombie pirates are left alone", () => {
  pirates.register(stubApi(true));
  // The level-57 Braindeath Island / Harmony Island pirates are a different monster.
  const tables = _test.tablesByNpc.get(563);
  const request = { player: {}, npcId: 563, tables, table: null };
  pirates._test.chooseTable(request);
  assert.equal(request.table, null);
});

test("a kill with no player still resolves the first table", () => {
  // Backwards compatibility: tableForNpc(npcId) is what every caller used before the hook.
  assert.equal(__internals.tableForNpc(13489).table_id, "zombie_pirate_2");
  assert.equal(__internals.tableForNpc(13489, null, null).table_id, "zombie_pirate_2");
});

test("the plugin is members-only, like the pirates themselves", () => {
  assert.equal(pirates.name, "ZombiePirates");
  assert.equal(pirates.members, true);
});
