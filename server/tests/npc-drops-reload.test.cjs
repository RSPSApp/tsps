// Run after `yarn build`: node --test tests/npc-drops-reload.test.cjs
//
// Progress tracker (osrs-progress.json, 2026-11-11), Economy > Loot tables, acceptance text:
//   "reloaddrops picks up edits without a restart."
//   "Missing subtables degrade to an empty roll."
//   "Count unusable subtable rows at load and expose them through __internals for diagnostics."
// loadDrops reads its files from GameConstants.DEFINITIONS_DIRECTORY on every call, so these tests point that at a
// fixture directory (and put it back); the shipped data is only used for the idempotent-reload case.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, before, after, afterEach } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { GameConstants } = require("../dist/game/GameConstants");
const { Location } = require("../dist/game/model/Location");
const Drops = require("../plugins/npcs/NpcDrops.plugin");

const { tablesByNpc, sharedTables } = Drops._test;
const commands = new Map();
const shipped = GameConstants.DEFINITIONS_DIRECTORY;
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "npc-drops-reload-"));

before(() => {
  CachePipeline.initialize();
  const core = PluginManager.getCoreApi();
  const api = new Proxy({
    core,
    emitCustomEvent: () => {},
    getPluginConfig: (_key, fallback) => fallback,
    registerCommand: (name, handler) => commands.set(name, handler),
  }, { get: (target, key) => (key in target ? target[key] : () => {}) });
  Drops.register(api);
});

afterEach((t) => {
  t.mock.restoreAll();
  GameConstants.DEFINITIONS_DIRECTORY = shipped;
  for (const file of fs.readdirSync(fixture)) fs.rmSync(path.join(fixture, file));
});

after(() => {
  GameConstants.DEFINITIONS_DIRECTORY = shipped;
  Drops._test.loadDrops();
  fs.rmSync(fixture, { recursive: true, force: true });
});

const write = (file, value) => fs.writeFileSync(path.join(fixture, file), typeof value === "string" ? value : JSON.stringify(value));
const useFixture = () => { GameConstants.DEFINITIONS_DIRECTORY = fixture + path.sep; };
const table = (itemId = 1) => ({ label: "t", main_max_roll: 1, entries: [{ item_id: itemId, weight: 1, out_of: 1, quantity: [1, 1] }], tertiary: [] });

test("reloading the shipped data twice gives the same stats and the same tables", () => {
  const first = Drops._test.loadDrops();
  const snapshot = {
    npcs: tablesByNpc.size, shared: sharedTables.size, ids: [...tablesByNpc.keys()].slice(0, 50),
    content: JSON.stringify([[...tablesByNpc], [...sharedTables]]),
  };
  const second = Drops._test.loadDrops();
  // The stats object carries unusableSubtableRows (reset at the top of every load) and the other counts; only
  // unusableSubtableRows is asserted to restart: bossNpcIds and conditionalTertiarySkipped are not reset on every path.
  assert.deepEqual(second, first, "the stats of a second load equal the first, so unusableSubtableRows does not add up");
  assert.deepEqual({
    npcs: tablesByNpc.size, shared: sharedTables.size, ids: [...tablesByNpc.keys()].slice(0, 50),
    content: JSON.stringify([[...tablesByNpc], [...sharedTables]]),
  }, snapshot, "the same tables and shared tables, entry for entry");
  assert.ok(first.npcs > 1000 && first.shared > 0);
});

test("unusable subtable rows are counted at load, skipped, and the count restarts on a reload", () => {
  useFixture();
  write("npc-drops.json", { npcs: { 9001: { tables: ["a"] } }, tables: { a: table() } });
  write("npc-drop-subtables.json", {
    good: { entries: [
      { item_id: 11, rarity_raw: "1/2", quantity_raw: "1" },
      { item_id: 12, rarity_raw: "Common", quantity_raw: "1" },   // a text rarity has no n/outOf
      { rarity_raw: "1/4" },                                      // neither an item, an empty slot nor a table
      { nothing: true, rarity_raw: "1/4" },
    ] },
  });
  const first = Drops._test.loadDrops();
  assert.equal(first.unusableSubtableRows, 2);
  assert.equal(sharedTables.get("good").length, 2, "the item and the empty slot remain");
  assert.equal(Drops._test.loadDrops().unusableSubtableRows, 2, "a second load does not add to the first");
});

test("a missing subtables file loads, and a row that points at a missing shared table rolls nothing", () => {
  useFixture();
  const npcTable = table();
  npcTable.entries = [{ shared_table: "gone", weight: 1, out_of: 1 }];
  write("npc-drops.json", { npcs: { 9001: { tables: ["a"] } }, tables: { a: npcTable } });
  const stats = Drops._test.loadDrops();
  assert.equal(stats.shared, 0);
  assert.equal(stats.unusableSubtableRows, 0);
  const rolled = tablesByNpc.get(9001)[0];
  const player = { getEquipment: () => ({ get: () => null, getItems: () => [] }), getAttribute: () => undefined };
  const npc = { getId: () => 9001, getLocation: () => new Location(3200, 3200, 0), getCurrentDefinition: () => ({ getName: () => "x", getCombatLevel: () => 1 }) };
  for (let i = 0; i < 50; i++) assert.deepEqual(Drops.__internals.rollTable(rolled, player, npc), []);
});

test("the reloaddrops command picks up edited files without a restart, and reports a broken file instead of throwing", (t) => {
  useFixture();
  const messages = [];
  const player = { sendMessage: (text) => messages.push(text) };
  const reload = commands.get("reloaddrops");
  assert.equal(typeof reload, "function");

  write("npc-drops.json", { npcs: { 9001: { tables: ["a"] } }, tables: { a: table(1) } });
  assert.equal(reload({ player }), true);
  assert.deepEqual([...tablesByNpc.keys()], [9001]);
  assert.equal(messages.at(-1), "Reloaded drops: 1 npcs, 1 tables.");

  write("npc-drops.json", { npcs: { 9002: { tables: ["a", "b"] } }, tables: { a: table(1), b: table(2) } });
  reload({ player });
  assert.deepEqual([...tablesByNpc.keys()], [9002], "the old NPC is gone and the new one is there");
  assert.equal(messages.at(-1), "Reloaded drops: 1 npcs, 2 tables.");

  t.mock.method(console, "error", () => {});
  write("npc-drops.json", "{ not json");
  assert.equal(reload({ player }), true);
  assert.equal(messages.at(-1), "Error reloading npc drops.");
  // loadDrops clears its maps BEFORE it reads the files, so a broken reload leaves the server with no drops until a
  // good one. This documents that behaviour; reading first and swapping afterwards would keep the previous drops.
  assert.equal(tablesByNpc.size, 0);
});

test("a dump without npcs or without tables loads as empty instead of throwing", (t) => {
  t.mock.method(console, "error", () => {});
  useFixture();
  write("npc-drops.json", { tables: { a: table() } });
  let stats = Drops._test.loadDrops();
  assert.deepEqual([stats.npcs, stats.tables, stats.shared], [0, 0, 0]);
  write("npc-drops.json", { npcs: { 9001: { tables: ["a"] } } });
  stats = Drops._test.loadDrops();
  assert.deepEqual([stats.npcs, stats.tables, stats.shared, stats.unusableSubtableRows], [0, 0, 0, 0]);
  assert.equal(tablesByNpc.size, 0);
});
