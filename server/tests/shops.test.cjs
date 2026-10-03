// Run after `yarn build`: node --test tests/shops.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { ShopDefinition } = require("../dist/game/definition/ShopDefinition");
const { Item } = require("../dist/game/model/Item");
const { PlayerStatus } = require("../dist/game/model/PlayerStatus");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { ShopManager } = require("../dist/game/model/container/shop/ShopManager");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");

const COINS = 995;
const BRONZE_AXE = 1351;
const STEEL_AXE = 1353;
const STEEL_AXE_NOTE = 1354;

// Item definitions normally come from the cache; stub the few this test uses.
const DEFINITIONS = {
  [COINS]: { name: "Coins", stackable: true, value: 1 },
  [BRONZE_AXE]: { name: "Bronze axe", value: 16 },
  [STEEL_AXE]: { name: "Steel axe", value: 200 },
  [STEEL_AXE_NOTE]: { name: "Steel axe", stackable: true, value: 200, noteOf: STEEL_AXE },
};
ItemDefinition.forId = (id) => {
  const def = DEFINITIONS[id] ?? { name: "null", value: 0 };
  return {
    getId: () => id,
    getName: () => def.name,
    getExamine: () => "",
    isStackable: () => def.stackable === true,
    isNoted: () => def.noteOf != null,
    unNote: () => def.noteOf ?? id,
    getNoteId: () => -1,
    getValue: () => def.value,
    isTradeable: () => true,
    isSellable: () => true,
  };
};

const AXE_SHOP = 900;
const GENERAL_STORE = 901;

function loadShops() {
  ShopDefinition.replace([
    new ShopDefinition(AXE_SHOP, "Bob's Brilliant Axes", "COINS", [
      { id: BRONZE_AXE, amount: 2, restockTicks: null, price: null },
      { id: STEEL_AXE, amount: 1, restockTicks: null, price: null },
    ], 100, 100, 100, "test"),
    new ShopDefinition(GENERAL_STORE, "Lumbridge General Store", "COINS", [
      { id: BRONZE_AXE, amount: 3, restockTicks: null, price: null },
    ], 1, 1, 1, "test"),
  ]);
  ShopManager.initialize();
}

function createPlayer() {
  // Every packet-sender call is a chainable no-op; varbits are recorded.
  const varbits = new Map();
  const sender = new Proxy({}, {
    get: (_target, key) => key === "sendVarbit"
      ? (id, value) => { varbits.set(id, value); return sender; }
      : () => sender,
  });
  const messages = [];
  const attributes = new Map();
  let status = PlayerStatus.NONE;
  let interfaceId = -1;
  const player = {
    messages,
    varbits,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getUsername: () => "alice",
    sendMessage: (message) => messages.push(message),
    getPacketSender: () => sender,
    getSession: () => ({ sendClientPacket: () => true }),
    getStatus: () => status,
    setStatus: (next) => { status = next; },
    getInterfaceId: () => interfaceId,
    setInterfaceId: (next) => { interfaceId = next; },
    isPlayerBot: () => false,
  };
  player.inventory = new Inventory(player);
  player.inventory.resetItems();
  player.getInventory = () => player.inventory;
  return player;
}

function openShop(coins = 10000, shopId = AXE_SHOP) {
  loadShops();
  const player = createPlayer();
  if (coins > 0) player.getInventory().add(new Item(COINS, coins), false);
  ShopManager.open(player, shopId);
  return player;
}

function buy(player, displaySlot, itemId, option = "Buy 1") {
  ShopManager.handleWidgetAction(player, {
    groupId: ShopManager.MAIN_INTERFACE_ID, childId: 16, buttonNum: 0, option, slot: displaySlot + 1, itemId,
  });
}

test("a specialist shop sells its last item", () => {
  const player = openShop();

  buy(player, 1, STEEL_AXE);

  assert.equal(player.getInventory().getAmount(STEEL_AXE), 1);
});

function stockOf(shopId = AXE_SHOP) {
  const shop = ShopManager.shopsById.get(shopId);
  return ShopManager.displayEntries(shop).map(({ itemId, amount }) => [itemId, amount]);
}

test("a sold-out item keeps its slot with 0 stock", () => {
  const player = openShop();

  buy(player, 0, BRONZE_AXE, "Buy 5");

  assert.equal(player.getInventory().getAmount(BRONZE_AXE), 2);
  assert.deepEqual(stockOf(), [[BRONZE_AXE, 0], [STEEL_AXE, 1]]);
  buy(player, 1, STEEL_AXE);
  assert.equal(player.getInventory().getAmount(STEEL_AXE), 1);
});

test("a click whose item no longer matches the slot buys nothing", () => {
  const player = openShop();

  buy(player, 1, BRONZE_AXE);

  assert.equal(player.getInventory().getAmount(BRONZE_AXE), 0);
  assert.equal(player.getInventory().getAmount(STEEL_AXE), 0);
});

function sell(player, slot, option = "Sell 1") {
  ShopManager.handleWidgetAction(player, {
    groupId: ShopManager.SIDE_INTERFACE_ID, childId: 0, buttonNum: 0, option, slot,
  });
}

test("Sell N sells unstackable items from every slot, skipping ones that can't be sold", () => {
  const player = openShop(0);
  player.getInventory().add(new Item(STEEL_AXE, 1), false);
  player.getInventory().add(new Item(STEEL_AXE, 1, { [Item.UNTRADEABLE_META]: true }), false);
  player.getInventory().add(new Item(STEEL_AXE, 1), false);

  sell(player, 2, "Sell 5");

  assert.equal(player.getInventory().getAmount(STEEL_AXE), 1);
  assert.equal(player.getInventory().getItems()[1].isUntradeable(), true);
  assert.deepEqual(stockOf(), [[BRONZE_AXE, 2], [STEEL_AXE, 3]]);
});

test("notes sell as the item they stand for", () => {
  const player = openShop(0);
  player.getInventory().add(new Item(STEEL_AXE_NOTE, 3), false);

  sell(player, 0, "Sell 5");

  assert.equal(player.getInventory().getAmount(STEEL_AXE_NOTE), 0);
  assert.equal(player.getInventory().getAmount(COINS), 3 * Math.floor(200 * 0.85));
  assert.deepEqual(stockOf(), [[BRONZE_AXE, 2], [STEEL_AXE, 4]]);
});

test("a sale whose payment wouldn't fit is refused, unless selling frees the slot", () => {
  const player = openShop(0);
  player.getInventory().add(new Item(STEEL_AXE_NOTE, 5), false);
  for (let slot = 1; slot < 28; slot++) player.getInventory().add(new Item(20000 + slot, 1), false);

  sell(player, 0, "Sell 1");
  assert.equal(player.getInventory().getAmount(STEEL_AXE_NOTE), 5);
  assert.ok(player.messages.includes("You don't have enough inventory space."));

  sell(player, 0, "Sell 5");
  assert.equal(player.getInventory().getAmount(STEEL_AXE_NOTE), 0);
  assert.equal(player.getInventory().getAmount(COINS), 5 * Math.floor(200 * 0.85));
});

test("every general store buys items it doesn't stock and restocks its own", () => {
  const player = openShop(10000, GENERAL_STORE);
  player.getInventory().add(new Item(STEEL_AXE, 1), false);

  sell(player, 1);
  buy(player, 0, BRONZE_AXE, "Buy 5");
  assert.deepEqual(stockOf(GENERAL_STORE), [[BRONZE_AXE, 0], [STEEL_AXE, 1]]);

  for (let tick = 0; tick < 3; tick++) ShopManager.restockAll();
  assert.equal(stockOf(GENERAL_STORE)[0][1], 3);
});

test("the quantity buttons set what an item's left-click buys, and the choice is saved", () => {
  const player = openShop();
  const clickButton = (childId) => ShopManager.handleWidgetAction(player, {
    groupId: ShopManager.MAIN_INTERFACE_ID, childId, buttonNum: 1, option: undefined,
  });

  clickButton(10); // Buy-5
  assert.equal(player.varbits.get(6348), 2);
  assert.equal(player.getAttribute("shop:quantity-mode"), 2);
  assert.ok(PlayerSave.persistentAttributeKeys.has("shop:quantity-mode"));

  ShopManager.handleWidgetAction(player, {
    groupId: ShopManager.MAIN_INTERFACE_ID, childId: 16, buttonNum: 1, slot: 1, itemId: BRONZE_AXE,
  });
  assert.equal(player.getInventory().getAmount(BRONZE_AXE), 2, "buys up to 5, capped at the 2 in stock");
});
