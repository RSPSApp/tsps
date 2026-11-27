// Run after `yarn build`: node --test tests/barbarian-rod-shop.test.cjs
//
// The pearl barbarian rod in Alry the Angler's Angling Accessories (shop 1425). Wiki, Pearl
// barbarian rod: it "can only be purchased if the relevant part of the Barbarian Training
// miniquest is completed with Otto Godblessed". The Wiki lists it in its own store table under
// "===With Barbarian Training===", which osrsreboxed-db now merges into the shop (its parser reads
// every table a requirement section adds), so the row arrives in shops.json like any other and
// BarbarianTraining.plugin.js hides it until the section is done.
//
// This is the companion of slayer-goggles-shop.test.cjs: same shop path, gate owned by the plugin
// that owns the requirement, since Barbarian Training is a miniquest with no QuestRuntime entry
// (quest-shops.json's `questDone` lets an unknown quest through by design).
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

const Training = require("../plugins/npcs/BarbarianTraining.plugin");
const T = Training._test;

const SHOP = "Alry the Angler's Angling Accessories";
const ROD = 22842;
const PEARL_FISHING_ROD = 22846;

let shopId;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  assert.equal(new ShopDefinitionLoader().load(), true, "the server's shops");
  ShopManager.initialize();
  Training.register(PluginManager.createApi("BarbarianTraining"));
  const definition = ShopDefinition.all().find((entry) => entry.getName() === SHOP);
  assert.ok(definition, "the shop is in shops.json");
  shopId = definition.getId();
});

/** A player at one stage of the rod-fishing section (0 none, 1 tasked, 2 caught, 3 told Otto). */
function playerAt(fishingRod, { bot = false } = {}) {
  const player = new Player(null);
  player.setUsername(`rodshop${Math.floor(Math.random() * 1e6)}`);
  player.setAttribute(T.STATE_ATTRIBUTE, { fishingRod });
  if (bot) player.isPlayerBot = () => true;
  return player;
}

/** Opens the shop and decodes the SHOP_OPEN packet the client would draw. */
function openShop(player) {
  const packets = [];
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.getSession = () => ({ sendClientPacket: (packet) => (packets.push(Buffer.from(packet)), true) });
  assert.equal(ShopManager.open(player, shopId), true, "the shop opens");
  return decodeShopOpen(packets.at(-1));
}

test("the imported shop carries the rod row, so only the gate can hide it", () => {
  const row = ShopDefinition.forId(shopId).getOriginalStock().find((entry) => entry.id === ROD);
  assert.ok(row, "shop 1425 stocks the pearl barbarian rod");
  assert.equal(row.amount, 1000, "Wiki: 1000 in stock");
});

test("the rod is on sale only once Otto has heard of the catch", () => {
  for (const stage of [0, T.TASKED, T.DONE]) {
    const shop = openShop(playerAt(stage));
    assert.equal(shop.stock.some((row) => row.itemId === ROD), false, `hidden at stage ${stage}`);
  }
  const done = openShop(playerAt(T.TOLD));
  const row = done.stock.find((entry) => entry.itemId === ROD);
  assert.ok(row, "shown once the section is told to Otto");
  assert.equal(row.priceEach, 150, "Wiki: 150 Molch pearls");
  assert.equal(row.quantity, 1000, "Wiki: 1000 in stock");
});

test("the rest of Alry's stock is untouched, and player bots still see the rod", () => {
  const fresh = openShop(playerAt(0));
  assert.ok(fresh.stock.some((row) => row.itemId === PEARL_FISHING_ROD), "other rows stay visible");
  const bot = openShop(playerAt(0, { bot: true }));
  assert.ok(bot.stock.some((row) => row.itemId === ROD), "a bot is not gated");
});

test("a missing player, junk state and an out-of-range stage are all safe", () => {
  const noPlayer = { shopName: SHOP, itemId: ROD, visible: true };
  assert.doesNotThrow(() => T.stockVisible(noPlayer));
  assert.equal(noPlayer.visible, true, "no player to gate");

  const junk = playerAt(0);
  junk.setAttribute(T.STATE_ATTRIBUTE, "not an object");
  assert.equal(openShop(junk).stock.some((row) => row.itemId === ROD), false, "junk state reads as stage 0");

  const absurd = openShop(playerAt(9));
  assert.equal(absurd.stock.some((row) => row.itemId === ROD), false, "a stage above TOLD clamps to 0");
});

test("the hook only answers for Alry's shop and only for the rod", () => {
  const answer = (shopName, itemId, fishingRod) => {
    const request = { shopName, itemId, player: playerAt(fishingRod), visible: true };
    T.stockVisible(request);
    return request.visible;
  };
  assert.equal(answer(SHOP, ROD, 0), false, "the rod before the section");
  assert.equal(answer(SHOP, ROD, T.TOLD), true, "the rod after it");
  assert.equal(answer(SHOP, PEARL_FISHING_ROD, 0), true, "another row in the same shop");
  assert.equal(answer("Slayer Equipment (shop)", ROD, 0), true, "the same id in another shop");
});
