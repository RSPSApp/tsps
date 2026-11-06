// Run after `yarn build`: node --test tests/tempoross-casket-loot.test.cjs
// The casket's jewellery rows are named by generated ItemIdentifiers. "Sapphire bracelet"
// exists twice in the cache (11071 the inert duplicate, 11072 the real item), so the row must
// name the real one or the reward cannot be noted, alched or sold (issue #2689).
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
CachePipeline.initialize();
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
const Shared = require("../plugins/minigames/tempoross/Shared.Tempoross");
const Rolls = require("../plugins/minigames/tempoross/Rewards.Tempoross");

const LOOT = require("../plugins/minigames/data/tempoross.json").casketLoot.items;
const WEIGHTED_TOTAL = LOOT.reduce((sum, row) => sum + row[3], 0);

Shared.bind({ core: { ItemIdentifiers, ItemDefinition } });

test("the casket's sapphire bracelet rows resolve to the real noteable, alchable item", () => {
  const rows = LOOT.filter(([name]) => name.startsWith("SAPPHIRE_BRACELET"));
  assert.equal(rows.length, 2, "both the common and rare sapphire bracelet rows");
  for (const [name] of rows) {
    const id = ItemIdentifiers[name];
    assert.equal(id, 11072, name);
    const definition = ItemDefinition.forId(id);
    assert.equal(definition.getNoteId(), 11073);
    assert.ok(definition.getHighAlchValue() > 0, "high alch value");
  }
});

test("opening a casket that rolls sapphire bracelet gives the noted real item (11073)", () => {
  const index = LOOT.findIndex(([name]) => name === "SAPPHIRE_BRACELET_2");
  assert.ok(index >= 0);
  const before = LOOT.slice(0, index).reduce((sum, row) => sum + row[3], 0);
  const hit = (before + LOOT[index][3] / 2) / WEIGHTED_TOTAL;

  const realRandom = Math.random;
  const values = [hit, 0.5];
  Math.random = () => values.shift() ?? 0.5;
  try {
    const reward = Rolls.rollCasket();
    assert.equal(reward.id, 11073, "noted sapphire bracelet");
    assert.notEqual(reward.id, 11071, "the inert duplicate");
    assert.equal(reward.amount, 12);
  } finally {
    Math.random = realRandom;
  }
});
