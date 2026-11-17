// Run after `yarn build`: node --test tests/item-overrides.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const ItemDefinitionLoader = require("../plugins/items/ItemDefinitionLoader.plugin");

const WHIP = 4151;
const BONES = 526;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ItemDefinitionLoader.register({ log() {}, registerContentEndpoint() {}, onPlayerLogin() {} });
});

// Runs first: the next test makes the whip untradeable, which leaves it no examine price line.
test("an overridden Grand Exchange value is what examine and trade values show, over the guide price", () => {
  const { examinePrices } = require("../dist/game/content/ExaminePrice");
  const whip = ItemDefinition.forId(WHIP);
  assert.notEqual(whip.getGuidePrice(), 3000000, "the guide price differs before the override");
  ItemDefinitionLoader._test.applyItemOverrides({ [WHIP]: { grandExchangeValue: 3000000 } });
  assert.equal(whip.getGrandExchangeValue(), 3000000);
  assert.equal(whip.getGuidePrice(), 3000000);
  assert.equal(examinePrices(WHIP).prices.ge, 3000000);
});

test("a world's overrides win over the cache, prices and alch", () => {
  const whip = ItemDefinition.forId(WHIP);
  const bonuses = [0, 90, 0, 0, 0, 0, 0, 0, 0, 0, 90, 0, 0, 0];
  const requirements = [60, ...new Array(22).fill(0)];
  const loaded = ItemDefinitionLoader._test.applyItemOverrides({
    [WHIP]: {
      value: 2500000, grandExchangeValue: 3000000, highAlch: 1, lowAlch: 0, dropValue: 5,
      tradeable: false, sellable: false, attackSpeed: 3, bonuses, requirements, examine: "Sharper.",
    },
  });
  assert.equal(loaded, 1);
  assert.equal(whip.getValue(), 2500000);
  assert.equal(whip.getGrandExchangeValue(), 3000000);
  assert.equal(whip.getHighAlchValue(), 1);
  assert.equal(whip.getDropValue(), 5);
  assert.equal(whip.isTradeable(), false);
  assert.equal(whip.isPlayerTradeable(), false, "not tradeable between players either");
  assert.equal(whip.isSellable(), false);
  assert.equal(whip.getAttackSpeed(), 3);
  assert.deepEqual(whip.getBonuses(), bonuses);
  assert.deepEqual(whip.getRequirements(), requirements);
  assert.equal(whip.getExamine(), "Sharper.");
  bonuses[1] = 0;
  assert.equal(whip.getBonuses()[1], 90, "the definition keeps its own copy");
});

test("a tradeable override decides player trading too, both ways", () => {
  const DUELING_3 = 2562;       // trades, not on the Exchange
  const ECUMENICAL_KEY = 11942; // the cache's tradeable=no
  assert.equal(ItemDefinition.forId(DUELING_3).isPlayerTradeable(), true);
  ItemDefinitionLoader._test.applyItemOverrides({ [DUELING_3]: { tradeable: false }, [ECUMENICAL_KEY]: { tradeable: true } });
  assert.equal(ItemDefinition.forId(DUELING_3).isPlayerTradeable(), false);
  assert.equal(ItemDefinition.forId(ECUMENICAL_KEY).isTradeable(), true);
  assert.equal(ItemDefinition.forId(ECUMENICAL_KEY).isPlayerTradeable(), true);
});

test("invalid fields and unknown items are skipped, not fatal", () => {
  const bones = ItemDefinition.forId(BONES);
  const value = bones.getValue();
  const speed = bones.getAttackSpeed();
  const loaded = ItemDefinitionLoader._test.applyItemOverrides({
    [BONES]: { value: -1, attackSpeed: 99, bonuses: [1, 2], name: "Not allowed" },
    99999999: { value: 1 },
    nonsense: { value: 1 },
  });
  assert.equal(loaded, 1);
  assert.equal(bones.getValue(), value);
  assert.equal(bones.getAttackSpeed(), speed);
  assert.equal(bones.getName(), "Bones", "names stay the client's");
});
