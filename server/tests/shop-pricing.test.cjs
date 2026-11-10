// Run after `yarn build`: node --test tests/shop-pricing.test.cjs
// Wiki (Shop § Pricing, Shop calculator): shops sell at their "Sells at" rate and buy at their "Buys at" rate,
// both moving by "Change per" for each item above or below the normal stock.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Item } = require("../dist/game/model/Item");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");
const { ShopDefinition } = require("../dist/game/definition/ShopDefinition");
const { ShopDefinitionLoader } = require("../dist/game/definition/loader/impl/ShopDefinitionLoader");
const { ShopManager } = require("../dist/game/model/container/shop/ShopManager");
const { PluginManager } = require("../dist/plugins/PluginManager");

const BOB = "Bob's Brilliant Axes.";
const DAVON = "Davon's Amulet Store. (Default)";
const JAMILA = "Jamila's Craft Stall.";
const LUMBRIDGE = "Lumbridge General Store";
const HUR_LEK = "TzHaar-Hur-Lek's Ore and Gem Store (Default)";

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  assert.equal(new ShopDefinitionLoader().load(), true, "the server's shops");
  ShopManager.initialize();
  ShopManager.registerItemCurrency(I.TOKKUL);
});

function shopId(name) {
  const shop = ShopDefinition.all().find((entry) => entry.getName() === name);
  assert.ok(shop, `${name} is a shop`);
  return shop.getId();
}

const valueOf = (id) => ItemDefinition.forId(id).getValue();

/** A real player, only the network stubbed, at a freshly stocked shop. */
function shopper(name, items = []) {
  ShopManager.initialize();
  ShopManager.registerItemCurrency(I.TOKKUL);
  const p = new Player(null);
  p.setUsername(`buyer${Math.floor(Math.random() * 1e6)}`);
  const messages = [];
  const sender = new Proxy({}, { get: () => () => sender });
  p.getPacketSender = () => sender;
  p.getSession = () => ({ sendClientPacket: () => true });
  p.sendMessage = (text) => messages.push(text);
  for (const [id, amount] of items) p.getInventory().add(new Item(id, amount), false);
  assert.equal(ShopManager.open(p, shopId(name)), true, `${name} opens`);
  return Object.assign(p, { messages });
}

const coins = (p) => p.getInventory().getAmount(I.COINS);

function displaySlot(p, id) {
  const index = ShopManager.getOpenShop(p).stock.findIndex((entry) => entry.itemId === id);
  assert.ok(index >= 0, `${id} is on display`);
  return index;
}

/** The shop's "currently costs" price, as the Value option and the interface show it. */
const cost = (p, id) => ShopManager.getOpenShop(p).stock[displaySlot(p, id)].price;

function buy(p, id, option = "Buy 1") {
  ShopManager.handleWidgetAction(p, {
    groupId: ShopManager.MAIN_INTERFACE_ID, childId: 16, buttonNum: 0, option, slot: displaySlot(p, id) + 1, itemId: id,
  });
}

function inventorySlot(p, id) {
  return p.getInventory().getItems().findIndex((item) => item?.getId() === id);
}

/** The "shop will buy for" price from the Value option. */
function offer(p, id) {
  ShopManager.handleWidgetAction(p, {
    groupId: ShopManager.SIDE_INTERFACE_ID, childId: 0, buttonNum: 0, option: "Value", slot: inventorySlot(p, id), itemId: id,
  });
  const match = /shop will buy for ([\d,]+) /.exec(p.messages.at(-1));
  assert.ok(match, `a sale offer: ${p.messages.at(-1)}`);
  return Number(match[1].replace(/,/g, ""));
}

function sell(p, id, option = "Sell 1") {
  ShopManager.handleWidgetAction(p, {
    groupId: ShopManager.SIDE_INTERFACE_ID, childId: 0, buttonNum: 0, option, slot: inventorySlot(p, id), itemId: id,
  });
}

test("Bob's Brilliant Axes: the Wiki's steel axe, 200 to buy and 120 to sell at 3 in stock, 196 and 116 at 4", () => {
  assert.equal(valueOf(I.STEEL_AXE), 200);
  const p = shopper(BOB, [[I.STEEL_AXE, 2]]);
  assert.equal(cost(p, I.STEEL_AXE), 200);
  assert.equal(offer(p, I.STEEL_AXE), 120);
  sell(p, I.STEEL_AXE);
  assert.equal(coins(p), 120);
  assert.equal(cost(p, I.STEEL_AXE), 196, "4 in stock");
  assert.equal(offer(p, I.STEEL_AXE), 116, "4 in stock");
  sell(p, I.STEEL_AXE);
  assert.equal(coins(p), 236);
});

test("Bob's Brilliant Axes: below the normal stock each axe costs 2% more, and a bulk buy pays each one's price", () => {
  const p = shopper(BOB, [[I.COINS, 10_000]]);
  buy(p, I.STEEL_AXE, "Buy 5");
  // 3 in stock: 200 (3 left), 204 (2 left), 208 (1 left); then sold out.
  assert.equal(p.getInventory().getAmount(I.STEEL_AXE), 3);
  assert.equal(coins(p), 10_000 - 200 - 204 - 208);
  assert.equal(p.messages.length, 0);
  sell(p, I.STEEL_AXE);
  assert.equal(coins(p), 10_000 - 612 + Math.floor(200 * (600 + 3 * 20) / 1000), "sold to an empty shop: 66%");
});

test("a purchase stops at what the player can pay for, at the rising price", () => {
  const p = shopper(BOB, [[I.COINS, 404]]);
  buy(p, I.STEEL_AXE, "Buy 5");
  assert.equal(p.getInventory().getAmount(I.STEEL_AXE), 2, "200 + 204; the third would cost 208");
  assert.equal(coins(p), 0);
  buy(p, I.STEEL_AXE);
  assert.equal(p.getInventory().getAmount(I.STEEL_AXE), 2);
  assert.equal(p.messages.at(-1), "You don't have enough coins.");
});

test("Davon's Amulet Store sells at 120% and buys at 90%, 2% per amulet", () => {
  const amulet = I.AMULET_OF_POWER;
  const value = valueOf(amulet);
  const p = shopper(DAVON, [[amulet, 2]]);
  assert.equal(offer(p, amulet), Math.floor(value * 900 / 1000), "none in stock, none normally");
  sell(p, amulet);
  assert.equal(coins(p), Math.floor(value * 900 / 1000));
  assert.equal(offer(p, amulet), Math.floor(value * 880 / 1000));
  assert.equal(cost(p, amulet), Math.floor(value * 1180 / 1000), "one above its normal stock of 0");
});

test("Jamila's Craft Stall sells at 150% and buys at 25%, 1% per item", () => {
  assert.equal(valueOf(I.TIARA_MOULD), 100);
  const p = shopper(JAMILA, [[I.TIARA_MOULD, 1]]);
  assert.equal(cost(p, I.TIARA_MOULD), 150, "her normal stock of 10");
  assert.equal(offer(p, I.TIARA_MOULD), 25);
  sell(p, I.TIARA_MOULD);
  assert.equal(coins(p), 25);
  assert.equal(cost(p, I.TIARA_MOULD), 149, "11 in stock");
});

test("a general store sells at 130% and buys at 40%, 3% per item, with items it doesn't stock normally at 0", () => {
  const p = shopper(LUMBRIDGE, [[I.STEEL_AXE, 1]]);
  assert.equal(cost(p, I.BUCKET), Math.max(1, Math.floor(valueOf(I.BUCKET) * 1300 / 1000)));
  assert.equal(offer(p, I.STEEL_AXE), 80, "Wiki: a steel axe sells to a general store for 80");
  sell(p, I.STEEL_AXE);
  assert.equal(cost(p, I.STEEL_AXE), 254, "one above none: 127%");
});

test("a sale never pays less than 10% of value, however overstocked the shop", () => {
  const p = shopper(LUMBRIDGE, [[I.STEEL_AXE, 15]]);
  sell(p, I.STEEL_AXE, "Sell 50");
  // 40%, 37% ... 13% for the first ten, then the 10% floor (20) for the other five.
  const first = [80, 74, 68, 62, 56, 50, 44, 38, 32, 26];
  assert.equal(coins(p), first.reduce((a, b) => a + b, 0) + 5 * 20);
});

test("the TzHaar shops sell for tokkul at 150% and buy at 15% (an uncut onyx costs 300,000)", () => {
  const p = shopper(HUR_LEK, [[I.TOKKUL, 1_000_000], [I.UNCUT_SAPPHIRE, 1]]);
  assert.equal(cost(p, I.UNCUT_ONYX), 300_000);
  assert.equal(cost(p, I.UNCUT_SAPPHIRE), 37, "25 × 1.5, rounded down");
  assert.equal(offer(p, I.UNCUT_SAPPHIRE), Math.floor(valueOf(I.UNCUT_SAPPHIRE) * 150 / 1000), "at its normal stock of 1");
  buy(p, I.UNCUT_ONYX);
  assert.equal(p.getInventory().getAmount(I.TOKKUL), 700_000);
});

test("a per-item price stays the price, and the price hooks still have the last word", (t) => {
  const stranger = shopper("Mysterious Stranger (shop)", [[I.COINS, 100_000]]);
  assert.equal(cost(stranger, 22517), 75_000, "the escape crystal's own price");

  const original = PluginManager.emitCustomEvent;
  t.mock.method(PluginManager, "emitCustomEvent", (name, request) => {
    if (name === "shop:buy-price" && request.itemId === I.STEEL_AXE) request.price = 0;
    if (name === "shop:sell-price" && request.itemId === I.STEEL_AXE) request.price = 1;
    return original.call(PluginManager, name, request);
  });
  const p = shopper(BOB, [[I.STEEL_AXE, 1]]);
  assert.equal(cost(p, I.STEEL_AXE), 0);
  sell(p, I.STEEL_AXE);
  assert.equal(coins(p), 1);
});
