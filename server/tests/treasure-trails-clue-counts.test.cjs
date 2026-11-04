// Run after `yarn build`: node --test tests/treasure-trails-clue-counts.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const Data = require("../plugins/achievements/collectionlog/Data.CollectionLog");
const Runtime = require("../plugins/treasuretrails/trails/Runtime.TreasureTrails");
const Beginner = require("../plugins/treasuretrails/beginner/Runtime.BeginnerTreasureTrails");

const TIERS = [
  { name: "beginner", label: "Beginner", struct: 593 },
  { name: "easy", label: "Easy", struct: 508 },
  { name: "medium", label: "Medium", struct: 509 },
  { name: "hard", label: "Hard", struct: 510 },
  { name: "elite", label: "Elite", struct: 511 },
  { name: "master", label: "Master", struct: 512 },
];
const RARE = [
  { name: "hard", label: "Hard", struct: 2869 },
  { name: "elite", label: "Elite", struct: 2870 },
  { name: "master", label: "Master", struct: 2871 },
];
const SHARED = { name: "Shared Treasure Trail Rewards", struct: 513 };

before(async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  Data({ core: { CacheDefinitions } });
});

const clueCategories = () => Data.tabs()[2].categories;
const categoryByStruct = (struct) => clueCategories().find((category) => category.struct === struct);
const player = (attributes = {}) => ({ getAttribute: (key) => attributes[key] });
const attribute = (tier) => Runtime.completedAttribute(tier);
const count = (handler, request) => {
  handler.categoryCount(request);
  return request.count;
};

test("every clue tier uses the cache's category name and its stored completion count", () => {
  for (const tier of TIERS) {
    const category = categoryByStruct(tier.struct);
    assert.ok(category, `cache has no category struct ${tier.struct}`);
    assert.equal(category.name, `${tier.label} Treasure Trails`);
    const handler = tier.name === "beginner" ? Beginner : Runtime;
    assert.equal(count(handler, { player: player(), category: category.name, count: null }), 0, `${category.name} with no completions`);
    assert.equal(count(handler, { player: player({ [attribute(tier)]: 4 }), category: category.name, count: null }), 4, `${category.name} with four completions`);
  }
});

test("rare clue categories show their parent tier's completion count", () => {
  const attributes = { [attribute({ name: "easy" })]: 99, [attribute({ name: "hard" })]: 12, [attribute({ name: "elite" })]: 3, [attribute({ name: "master" })]: 8 };
  for (const tier of RARE) {
    const category = categoryByStruct(tier.struct);
    assert.ok(category, `cache has no category struct ${tier.struct}`);
    assert.equal(category.name, `${tier.label} Treasure Trails (Rare)`);
    assert.equal(count(Runtime, { player: player(attributes), category: category.name, count: null }), attributes[attribute(tier)]);
  }
});

test("shared clue rewards show the total across all tiers, beginner included", () => {
  const category = categoryByStruct(SHARED.struct);
  assert.ok(category, `cache has no category struct ${SHARED.struct}`);
  assert.equal(category.name, SHARED.name);
  assert.equal(count(Runtime, { player: player(), category: category.name, count: null }), 0);
  const attributes = Object.fromEntries([2, 3, 4, 5, 6, 7].map((value, index) => [attribute(TIERS[index]), value]));
  assert.equal(count(Runtime, { player: player(attributes), category: category.name, count: null }), 27);
});

test("the old and unknown category names are left uncounted", () => {
  assert.equal(count(Runtime, { player: player({ [attribute({ name: "easy" })]: 4 }), category: "Treasure Trails (Easy)", count: null }), null);
  assert.equal(count(Beginner, { player: player({ [Beginner.COMPLETED_ATTRIBUTE]: 4 }), category: "Treasure Trails (Beginner)", count: null }), null);
  assert.equal(count(Runtime, { player: player(), category: "Not a category", count: null }), null);
});
