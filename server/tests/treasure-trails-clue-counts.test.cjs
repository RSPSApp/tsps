// Run after `yarn build`: node --test tests/treasure-trails-clue-counts.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const Data = require("../plugins/achievements/collectionlog/Data.CollectionLog");
const Progress = require("../plugins/achievements/collectionlog/Progress.CollectionLog");
const Interface = require("../plugins/achievements/collectionlog/Interface.CollectionLog");
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
  assert.equal(count(Beginner, { player: player(), category: category.name, count: null }), 0);
  const attributes = Object.fromEntries([2, 3, 4, 5, 6, 7].map((value, index) => [attribute(TIERS[index]), value]));
  assert.equal(count(Beginner, { player: player(attributes), category: category.name, count: null }), 27);
});

test("shared clue counts work with either runtime alone or both runtimes", () => {
  const attributes = { [attribute({ name: "easy" })]: 3 };
  for (const handlers of [[Runtime], [Beginner], [Runtime, Beginner], [Beginner, Runtime]]) {
    const api = new Proxy({ core: {}, emitCustomEvent(name, request) {
      if (name === "collection-log:category-count") for (const handler of handlers) handler.categoryCount(request);
    } }, { get(target, key) { return target[key] || (() => {}); } });
    Progress(api);
    assert.equal(Progress.categoryCount(player(attributes), SHARED), 3);
    assert.equal(Progress.categoryCount(player(), SHARED), 0);
  }
});

test("the old and unknown category names are left uncounted", () => {
  assert.equal(count(Runtime, { player: player({ [attribute({ name: "easy" })]: 4 }), category: "Treasure Trails (Easy)", count: null }), null);
  assert.equal(count(Beginner, { player: player({ [Beginner.COMPLETED_ATTRIBUTE]: 4 }), category: "Treasure Trails (Beginner)", count: null }), null);
  assert.equal(count(Runtime, { player: player(), category: "Not a category", count: null }), null);
});

// Free worlds register only BeginnerTreasureTrails: TreasureTrails is members-only.
test("free worlds load, count and save every clue tier's stored completions", () => {
  assert.equal(require("../plugins/treasuretrails/TreasureTrails.plugin").members, true);
  assert.notEqual(require("../plugins/treasuretrails/BeginnerTreasureTrails.plugin").members, true);

  const hooks = new Map();
  const api = new Proxy({ core: {},
    // The production plugin API delegates persistence to PlayerSave.
    persistAttribute: (key, fallback) => PlayerSave.persistAttribute(key, fallback),
    onCustomEvent(name, fn) { const list = hooks.get(name) || []; list.push(fn); hooks.set(name, list); },
    emitCustomEvent(name, event) { for (const fn of hooks.get(name) || []) fn(event); },
  }, { get(target, key) { return target[key] || (() => {}); } });
  require("../plugins/treasuretrails/BeginnerTreasureTrails.plugin").register(api);
  Progress(api);

  // A save written on a members world has a count for every tier.
  const saved = PlayerSave.fromPlayer(new Player(null));
  const counts = { beginner: 2, easy: 3, medium: 4, hard: 5, elite: 6, master: 7 };
  for (const tier of TIERS) saved.attributes[attribute(tier)] = counts[tier.name];

  // A free-world login reads back every registered count, so it is not lost on the next save.
  const player = new Player(null);
  saved.applyToPlayer(player);
  for (const tier of TIERS) {
    assert.equal(Number(player.getAttribute(attribute(tier))), counts[tier.name], `${tier.name} count loads on a free world`);
  }
  const resaved = PlayerSave.fromPlayer(player);
  for (const tier of TIERS) {
    assert.equal(resaved.attributes[attribute(tier)], counts[tier.name], `${tier.name} count survives the free-world save`);
  }

  // The shared category's count reaches the log's native varp through the real consumer.
  const category = categoryByStruct(SHARED.struct);
  const varps = new Map();
  const sender = {
    sendConfig: (id, value) => { varps.set(id, value); return sender; },
    sendVarbit: () => sender, sendInterfaceRemoval: () => sender, sendSubInterface: () => sender,
    sendInterfaceFlagsRange: () => sender, sendInterfaceScript: () => sender,
  };
  player.getPacketSender = () => sender;
  Interface.open(player, category.name);
  assert.equal(varps.get(Progress.VARP.CATEGORY_COUNTS[0]), 27, "shared total includes the saved member tiers");
});
