// Run after `yarn build`: node --test tests/slayer-goggles-shop.test.cjs
//
// Reinforced goggles in the Slayer Equipment shop. Wiki, Reinforced goggles: sold by any Slayer
// master for 100 coins, with "additional pairs can be purchased after the quest", and the change
// note "Player can no longer purchase reinforced goggles without meeting any requirements".
//
// The row is in the shop dump itself: osrsreboxed-db merges the page's "===A Porcine of Interest==="
// store table into the shop (its dumper, not a hand edit), so tsps imports it like any other row,
// and plugins/quests/data/quest-shops.json hides it until the quest is done. This checks both
// halves: the imported row, and what a player is shown.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { ShopDefinition } = require("../dist/game/definition/ShopDefinition");
const { ShopDefinitionLoader } = require("../dist/game/definition/loader/impl/ShopDefinitionLoader");
const { ShopManager } = require("../dist/game/model/container/shop/ShopManager");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { decodeShopOpen } = require("./helpers/shop-open-packet.cjs");

const SHOP = "Slayer Equipment (shop)";
const GOGGLES = 24942;
const QUEST = "A Porcine of Interest";

let questComplete = false;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  assert.equal(new ShopDefinitionLoader().load(), true, "the server's shops");
  ShopManager.initialize();
  // The quest's answer, as QuestRuntime gives it. quest-shops.json treats no answer as "this
  // server hasn't got that quest, so let it through"; here the answer is explicit.
  PluginManager.createApi("QuestProbe").onCustomEvent("quest:is-complete", (request) => {
    if (request?.name === QUEST) request.complete = questComplete;
  });
  require("../plugins/quests/Shops.Quests")(PluginManager.createApi("QuestShops"));
});

/** Opens a shop for a real player and decodes the SHOP_OPEN packet the client would draw. */
function openShop(id) {
  const player = new Player(null);
  player.setUsername(`gogglesshop${Math.floor(Math.random() * 1e6)}`);
  const packets = [];
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.getSession = () => ({ sendClientPacket: (packet) => (packets.push(Buffer.from(packet)), true) });
  assert.equal(ShopManager.open(player, id), true, "the shop opens");
  return { player, shop: decodeShopOpen(packets.at(-1)) };
}

test("the imported shop carries the goggles row from the wiki's quest section", () => {
  const definition = ShopDefinition.all().find((entry) => entry.getName() === SHOP);
  assert.ok(definition, "the shop is in shops.json");
  const row = definition.getOriginalStock().find((entry) => entry.id === GOGGLES);
  assert.ok(row, "shop 1324 stocks reinforced goggles");
  assert.equal(row.amount, 50, "Wiki: 50 in stock");
  assert.equal(row.restockTicks, 1, "Wiki: restock 1");
});

test("a player without the quest is not shown the row, and one who finished it is", () => {
  const definition = ShopDefinition.all().find((entry) => entry.getName() === SHOP);

  questComplete = false;
  const unfinished = openShop(definition.getId());
  assert.equal(unfinished.shop.id, String(definition.getId()), "the shop itself, not a copy");
  assert.equal(unfinished.shop.stock.some((row) => row.itemId === GOGGLES), false, "no goggles row before the quest");

  questComplete = true;
  const finished = openShop(definition.getId());
  const row = finished.shop.stock.find((entry) => entry.itemId === GOGGLES);
  assert.ok(row, "the row appears after the quest");
  assert.equal(row.priceEach, 100, "Wiki: 100 coins");
  assert.equal(row.quantity, 50, "Wiki: 50 in stock");
  questComplete = false;
});
