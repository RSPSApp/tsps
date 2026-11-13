// Run after `yarn build`: node --test tests/specialist-shop-buyback.test.cjs
// Issue #3912: shops paying in their own reward currency buy their stock back at the Wiki's "Buys at" (80%).
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Item } = require("../dist/game/model/Item");
const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");
const { ShopDefinition } = require("../dist/game/definition/ShopDefinition");
const { ShopDefinitionLoader } = require("../dist/game/definition/loader/impl/ShopDefinitionLoader");
const { ShopManager } = require("../dist/game/model/container/shop/ShopManager");

const GRACE = "Grace's Graceful Clothing";
const MAX_STACK = 2147483647;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  assert.equal(new ShopDefinitionLoader().load(), true, "the server's shops");
  ShopManager.initialize();
  for (const id of [I.MARK_OF_GRACE, I.GOLDEN_NUGGET, I.UNIDENTIFIED_MINERALS, I.STARDUST]) {
    ShopManager.registerItemCurrency(id);
  }
});

function shopId(name) {
  const shop = ShopDefinition.all().find((entry) => entry.getName() === name);
  assert.ok(shop, `${name} is a shop`);
  return shop.getId();
}

/** A real player, only the network stubbed. */
function player() {
  const p = new Player(null);
  p.setUsername(`grace${Math.floor(Math.random() * 1e6)}`);
  const messages = [];
  const sender = new Proxy({}, { get: () => () => sender });
  p.getPacketSender = () => sender;
  p.getSession = () => ({ sendClientPacket: () => true });
  p.sendMessage = (text) => messages.push(text);
  return Object.assign(p, { messages });
}

function slotOf(p, id) {
  return p.getInventory().getItems().findIndex((item) => item?.getId() === id);
}

function value(p, id) {
  ShopManager.handleWidgetAction(p, {
    groupId: ShopManager.SIDE_INTERFACE_ID, childId: 0, buttonNum: 0, option: "Value", slot: slotOf(p, id), itemId: id,
  });
  return p.messages.at(-1);
}

function sell(p, id, option = "Sell 1") {
  ShopManager.handleWidgetAction(p, {
    groupId: ShopManager.SIDE_INTERFACE_ID, childId: 0, buttonNum: 0, option, slot: slotOf(p, id), itemId: id,
  });
}

test("Grace buys every piece of her stock back for 80% of its price in marks of grace", () => {
  // Wiki (Grace's Graceful Clothing): sold at / bought at.
  const prices = [
    [I.GRACEFUL_HOOD, 35, 28], [I.GRACEFUL_TOP, 55, 44], [I.GRACEFUL_LEGS, 60, 48],
    [I.GRACEFUL_GLOVES, 30, 24], [I.GRACEFUL_BOOTS, 40, 32], [I.GRACEFUL_CAPE, 40, 32], [I.AMYLASE_PACK, 10, 8],
  ];
  const p = player();
  p.getInventory().add(new Item(I.MARK_OF_GRACE, 1000), false);
  ShopManager.open(p, shopId(GRACE));
  for (const [id, cost, refund] of prices) {
    const before = p.getInventory().getAmount(I.MARK_OF_GRACE);
    ShopManager.handleWidgetAction(p, {
      groupId: ShopManager.MAIN_INTERFACE_ID, childId: 16, buttonNum: 0, option: "Buy 1",
      slot: ShopDefinition.forId(shopId(GRACE)).getOriginalStock().findIndex((stock) => stock.id === id) + 1, itemId: id,
    });
    assert.equal(p.getInventory().getAmount(I.MARK_OF_GRACE), before - cost, `bought ${id}`);
    assert.match(value(p, id), new RegExp(`: shop will buy for ${refund} x Mark of grace\\.$`, "i"));
    sell(p, id);
    assert.equal(p.getInventory().getAmount(id), 0, `sold ${id}`);
    assert.equal(p.getInventory().getAmount(I.MARK_OF_GRACE), before - cost + refund);
  }
});

test("amylase packs from elsewhere sell to Grace for 8 marks each, the last one included, with a full inventory", () => {
  const p = player();
  // Fill all 28 slots: 27 packs and nothing else, so the marks need the slot the last pack frees.
  for (let slot = 0; slot < 27; slot++) p.getInventory().add(new Item(I.AMYLASE_PACK, 1), false);
  p.getInventory().add(new Item(I.BRONZE_AXE, 1), false);
  assert.equal(p.getInventory().getFreeSlots(), 0);
  ShopManager.open(p, shopId(GRACE));
  sell(p, I.AMYLASE_PACK, "Sell 50");
  assert.equal(p.getInventory().getAmount(I.AMYLASE_PACK), 0, "every pack sells, the last one too");
  assert.equal(p.getInventory().getAmount(I.MARK_OF_GRACE), 27 * 8);
  assert.equal(p.getInventory().getAmount(I.BRONZE_AXE), 1);
  assert.equal(value(p, I.BRONZE_AXE), "You can't sell this item to this shop.", "she takes only her own stock");
});

test("a mark of grace stack at its cap refuses the sale and keeps the item", () => {
  const p = player();
  p.getInventory().add(new Item(I.MARK_OF_GRACE, MAX_STACK - 10), false);
  p.getInventory().add(new Item(I.GRACEFUL_HOOD, 1), false);
  ShopManager.open(p, shopId(GRACE));
  sell(p, I.GRACEFUL_HOOD);
  assert.equal(p.getInventory().getAmount(I.GRACEFUL_HOOD), 1, "the hood stays");
  assert.equal(p.getInventory().getAmount(I.MARK_OF_GRACE), MAX_STACK - 10);
  assert.equal(p.messages.at(-1), "You don't have enough inventory space.");
  sell(p, I.MARK_OF_GRACE);
  assert.equal(p.getInventory().getAmount(I.MARK_OF_GRACE), MAX_STACK - 10, "her own currency isn't bought");
});

test("a metadata-locked graceful piece still can't be sold", () => {
  const p = player();
  p.getInventory().add(new Item(I.GRACEFUL_HOOD, 1, { [Item.UNTRADEABLE_META]: true }), false);
  ShopManager.open(p, shopId(GRACE));
  sell(p, I.GRACEFUL_HOOD);
  assert.equal(p.getInventory().getAmount(I.GRACEFUL_HOOD), 1);
  assert.equal(p.getInventory().getAmount(I.MARK_OF_GRACE), 0);
});

test("the other 80% reward-currency shops buy back too; Petrified Pete (0%) still doesn't", () => {
  const percy = player();
  percy.getInventory().add(new Item(I.PROSPECTOR_HELMET, 1), false);
  ShopManager.open(percy, shopId("Prospector Percy's Nugget Shop"));
  sell(percy, I.PROSPECTOR_HELMET);
  assert.equal(percy.getInventory().getAmount(I.PROSPECTOR_HELMET), 0);
  assert.equal(percy.getInventory().getAmount(I.GOLDEN_NUGGET), 32, "Wiki: bought at 32 nuggets");

  const guild = player();
  guild.getInventory().add(new Item(I.MINING_GLOVES, 1), false);
  ShopManager.open(guild, shopId("Mining Guild Mineral Exchange"));
  sell(guild, I.MINING_GLOVES);
  assert.equal(guild.getInventory().getAmount(I.MINING_GLOVES), 0);
  assert.equal(guild.getInventory().getAmount(I.UNIDENTIFIED_MINERALS), 32, "Wiki: bought at 32 minerals");

  const pete = ShopDefinition.forId(shopId("Petrified Pete's Ore Shop"));
  const ore = pete.getOriginalStock()[0].id;
  const miner = player();
  miner.getInventory().add(new Item(ore, 1), false);
  ShopManager.open(miner, pete.getId());
  sell(miner, ore);
  assert.equal(miner.getInventory().getAmount(ore), 1);
  assert.equal(miner.messages.at(-1), "You cannot sell to this shop.");
});

// A shop whose Wiki StoreLines all read buy=N/A buys nothing (shops.json `buysNothing`): Farming Supplies refused a
// bucket of compost on Value and Sell, "You cannot sell to this shop." (rsprox 231/03030). A coin shop with a "Buys at"
// still buys: Rok's Chocs Box. pays 65% (Wiki StoreTableHead buymultiplier=650), recorded as 6 coins for a 10-coin
// chocolate bar (230/00333: "Chocolate bar: shop will buy for 6 coins.").
test("Farming Supplies and the inns buy nothing; a shop with a Buys at isn't flagged", () => {
  for (const name of ["Farming Supplies", "Blue Moon Inn", "Rising Sun Inn"]) {
    assert.equal(ShopDefinition.forId(shopId(name)).getSalesPolicy().buysNothing, true, `${name} buys nothing`);
  }
  const p = player();
  p.getInventory().add(new Item(I.COMPOST, 1), false);
  ShopManager.open(p, shopId("Farming Supplies"));
  assert.equal(value(p, I.COMPOST), "You cannot sell to this shop.");
  sell(p, I.COMPOST);
  assert.equal(p.messages.at(-1), "You cannot sell to this shop.");
  assert.equal(p.getInventory().getAmount(I.COMPOST), 1, "the compost stays");
  assert.equal(p.getInventory().getAmount(I.COINS), 0);

  // Rok's Chocs Box. has a "Buys at", so it isn't flagged: 650 per mille, 6 coins for a 10-coin chocolate bar.
  const chocs = ShopDefinition.forId(shopId("Rok's Chocs Box.")).getSalesPolicy();
  assert.equal(chocs.buysNothing, undefined);
  assert.equal(chocs.buysAt, 650);
});
