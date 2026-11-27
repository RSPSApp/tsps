// Run after `yarn build`: node --test tests/slayer-goggles-shop.test.cjs
// Reinforced goggles in the Slayer Equipment shop (Wiki, Reinforced goggles: sold by any Slayer
// master for 100 coins after A Porcine of Interest; before the quest the row is not there).
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Location } = require("../dist/game/model/Location");

const BASE_SHOP = 1324;
const GOGGLES_COPY = 1700;
const GOGGLES = 24942;
const QUEST = "a_porcine_of_interest";

let core;
let ShopManager;
let questComplete = false;
const opened = [];
let nextIndex = 2600;

before(() => {
  CachePipeline.initialize();
  RegionManager.init();
  new NpcDefinitionLoader().load();
  core = PluginManager.getCoreApi();
  // The Slayer plugin registers the goggles shop as a definition source, which the loader reads
  // when it loads — so the plugin comes first, then the shops.
  require("../plugins/skills/Slayer.plugin").register(PluginManager.createApi("Slayer"));
  // The quest's answer, as QuestRuntime gives it: the shop unit only asks.
  PluginManager.createApi("QuestProbe").onCustomEvent("quest:is-complete", (request) => {
    if (request?.key === QUEST && questComplete) request.complete = true;
  });
  PluginManager.createApi("ShopProbe").onCustomEvent("shop:opened", (event) => opened.push(event));
  const { ShopDefinitionLoader } = require("../dist/game/definition/loader/impl/ShopDefinitionLoader");
  new ShopDefinitionLoader().load();
  ShopManager = require("../dist/game/model/container/shop/ShopManager").ShopManager;
  ShopManager.initialize();
});

/** A real player, since opening a shop writes to the client. */
function createPlayer() {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const channel = { kind: "test", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session, new Location(3089, 3524, 0));
  session.setPlayer(player);
  player.setIndex(nextIndex++);
  player.setUsername(`gogglesshop${nextIndex}`);
  player.setRegistered(true);
  return player;
}

function stock(player) {
  const shop = ShopManager.getOpenShop(player);
  assert.ok(shop, "a shop is open");
  return shop.stock;
}

test("the Slayer Equipment shop carries the goggles only after A Porcine of Interest", () => {
  const fresh = createPlayer();
  opened.length = 0;
  assert.equal(ShopManager.open(fresh, BASE_SHOP), true);
  assert.equal(opened.at(-1).shopId, BASE_SHOP, "an unfinished player gets the shop itself");
  assert.equal(stock(fresh).some((entry) => entry.itemId === GOGGLES), false, "no goggles row");

  const done = createPlayer();
  questComplete = true;
  try {
    opened.length = 0;
    assert.equal(ShopManager.open(done, BASE_SHOP), true);
    assert.equal(opened.at(-1).shopId, GOGGLES_COPY, "a finished player gets the copy");
    const row = stock(done).find((entry) => entry.itemId === GOGGLES);
    assert.ok(row, "the goggles row is stocked");
    assert.equal(row.price, 100, "Wiki: sold for 100 coins");
    assert.equal(row.amount, 50, "Wiki: 50 in stock");
  } finally {
    questComplete = false;
  }
});
