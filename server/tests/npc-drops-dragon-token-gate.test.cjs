// Run after `yarn build`: node --test tests/npc-drops-dragon-token-gate.test.cjs
// The export no longer types the Dragon token's quest ("Sir Amik Varze subquest of Recipe for Disaster" is prose
// only), and the row is a guaranteed black dragon drop. NpcDrops gates item 7478 by id and asks
// `npc-drops:quest-item`, so a quest plugin that declines it still stops every black dragon dropping it.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const Drops = require("../plugins/npcs/NpcDrops.plugin");
const dump = require("../data/definitions/npc-drops.json");

const DRAGON_TOKEN = 7478;
let decline = false;
const asked = [];

before(() => {
  CachePipeline.initialize();
  const core = PluginManager.getCoreApi();
  const api = new Proxy({
    core,
    emitCustomEvent: (name, event) => {
      if (name !== "npc-drops:quest-item") return;
      asked.push(event);
      if (decline && event.itemId === DRAGON_TOKEN) event.allowed = false; // what Recipe for Disaster answers
    },
    getPluginConfig: (_key, fallback) => fallback,
  }, { get: (target, key) => (key in target ? target[key] : () => {}) });
  Drops.register(api);
  Drops.__internals.loadDrops();
});

const blackDragon = () => {
  const npcId = Object.entries(dump.npcs).find(([, npc]) => npc.tables.includes("black_dragon"))[0];
  return Drops.__internals.tablesByNpc.get(Number(npcId)).find((table) => table.table_id === "black_dragon");
};
const tokens = (kills) => {
  const table = blackDragon();
  let count = 0;
  for (let i = 0; i < kills; i++) {
    count += Drops.__internals.rollTable(table, {}, null).filter((drop) => drop.itemId === DRAGON_TOKEN).length;
  }
  return count;
};

test("the Dragon token row carries a requirement by item id although its note names no quest", () => {
  const row = blackDragon().entries.find((entry) => entry.item_id === DRAGON_TOKEN);
  assert.ok(row?.always);
  assert.equal(row.notes.some((note) => note.startsWith("Quest requirement:")), false);
  assert.deepEqual(Drops.__internals.questRequirement(row), { key: "quest_recipefordisasterfreeingsiramikvarze", mode: "RequiresDuring" });
});

test("a quest plugin that declines the token stops every kill dropping it, and is asked for it", () => {
  decline = true;
  asked.length = 0;
  assert.equal(tokens(50), 0);
  assert.ok(asked.some((event) => event.itemId === DRAGON_TOKEN && event.requirement?.mode === "RequiresDuring"));
});

test("with no quest plugin answering, the guaranteed row drops as before", () => {
  decline = false;
  assert.equal(tokens(20), 20);
});
