// Run after `yarn build`: node --test tests/npc-drops-seed-integration.test.cjs
// The general seed table is imported as six combat-level categories with no flat `entries`; the plugin must
// still roll it (44 table rows reference `seed`), choosing the category by the NPC's combat level.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const Drops = require("../plugins/npcs/NpcDrops.plugin");
const subtables = require("../data/definitions/npc-drop-subtables.json");

before(() => {
  CachePipeline.initialize();
  const core = PluginManager.getCoreApi();
  const api = new Proxy({ core, emitCustomEvent: () => {}, getPluginConfig: (_key, fallback) => fallback },
    { get: (target, key) => (key in target ? target[key] : () => {}) });
  Drops.register(api);
  Drops._test.loadDrops();
});

const player = { getLocation: () => ({ getX: () => 3222, getY: () => 3218 }), getEquipment: () => ({ get: () => null, getItems: () => [] }) };
const itemsOf = (category) => new Set(category.entries.map((entry) => entry.item_id));
const rolled = (level, count) => {
  const seen = new Set();
  for (let i = 0; i < count; i++) for (const drop of Drops._test.rollSharedTable("seed", player, 0, { combatLevel: level })) seen.add(drop.itemId);
  return seen;
};

test("the seed shared table is registered from its categories and still drops seeds", () => {
  assert.equal(Drops._test.sharedCategories.get("seed").categories.length, 6);
  assert.equal(Drops._test.sharedTables.get("seed").length, 44);
  assert.ok(rolled(60, 500).size > 0, "a combat level 60 kill still gets seeds");
});

test("a low combat level only reaches the allotment seeds; a high one reaches the others", () => {
  const [allotment, ...rest] = subtables.seed.categories.map(itemsOf);
  for (const id of rolled(33, 3000)) assert.ok(allotment.has(id), `item ${id} is an allotment seed`);
  const high = rolled(150, 40000);
  assert.ok([...high].some((id) => rest.some((category) => category.has(id))), "higher categories are reachable");
  assert.ok([...high].some((id) => allotment.has(id)));
});

test("an unknown combat level rolls the allotment seeds", () => {
  const allotment = itemsOf(subtables.seed.categories[0]);
  for (const id of rolled(null, 2000)) assert.ok(allotment.has(id));
});
