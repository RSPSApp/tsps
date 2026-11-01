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
const { PluginManager } = require("../dist/plugins/PluginManager");

const COINS = 995;
const BRONZE_AXE = 1351;
const STEEL_AXE = 1353;
const STEEL_AXE_NOTE = 1354;

// Item definitions normally come from the cache; stub the few this test uses.
const DEFINITIONS = {
  [COINS]: { name: "Coins", stackable: true, value: 1 },
  [BRONZE_AXE]: { name: "Bronze axe", value: 16 },
  [STEEL_AXE]: { name: "Steel axe", value: 200, note: STEEL_AXE_NOTE },
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
    getNoteId: () => def.note ?? -1,
    getValue: () => def.value,
    isTradeable: () => true,
    isSellable: () => true,
  };
};

const AXE_SHOP = 900;
const GENERAL_STORE = 901;

function loadShops(steelStock = 1) {
  ShopDefinition.replace([
    new ShopDefinition(AXE_SHOP, "Bob's Brilliant Axes", "COINS", [
      { id: BRONZE_AXE, amount: 2, restockTicks: null, price: null },
      { id: STEEL_AXE, amount: steelStock, restockTicks: null, price: null },
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

test("shop:purchase reports only paid, delivered quantities", (t) => {
  const purchases = [];
  t.mock.method(PluginManager, "emitCustomEvent", (name, event) => {
    if (name === "shop:purchase") purchases.push(event);
  });
  const player = openShop();
  buy(player, 0, BRONZE_AXE, "Buy 5");
  assert.deepEqual(purchases, [{ player, shopId: AXE_SHOP, shopName: "Bob's Brilliant Axes", currency: "COINS", itemId: BRONZE_AXE, amount: 2, originalStock: true }]);
  buy(player, 0, BRONZE_AXE);
  buy(player, 1, BRONZE_AXE);
  assert.equal(purchases.length, 1, "sold-out and stale requests do not report a purchase");
  const broke = openShop(0);
  buy(broke, 0, BRONZE_AXE);
  assert.equal(purchases.length, 1, "an unaffordable purchase does not report acquisition");
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

test("invalid shop:sell-price responses preserve the default refund", (t) => {
  let override;
  t.mock.method(PluginManager, "emitCustomEvent", (name, request) => {
    if (name === "shop:sell-price") request.price = override;
  });
  for (const price of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    override = price;
    const player = openShop(0);
    player.getInventory().add(new Item(STEEL_AXE, 1), false);
    sell(player, 0);
    assert.equal(player.getInventory().getAmount(COINS), Math.floor(200 * 0.85));
  }
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

test("a currency with a unit uses OSRS's wording: costs, buy-back and too few", () => {
  const STICKS = 6306;
  DEFINITIONS[STICKS] = { name: "Trading sticks", stackable: true, value: 1 };
  ShopManager.registerItemCurrency(STICKS, { name: "Trading sticks", unit: "trade sticks" });
  ShopDefinition.replace([
    new ShopDefinition(902, "Stick shop", "TRADING STICKS", [
      { id: STEEL_AXE, amount: 5, restockTicks: null, price: null },
    ], 100, 100, 100, "test"),
  ]);
  ShopManager.initialize();
  const player = createPlayer();
  player.getInventory().add(new Item(STICKS, 100), false);
  player.getInventory().add(new Item(STEEL_AXE, 1), false);
  ShopManager.open(player, 902);
  ShopManager.handleItemContainerAction(player, { kind: "value", containerId: ShopManager.ITEMS_INTERFACE_ID, slot: 0, itemId: STEEL_AXE, amount: 0 });
  ShopManager.handleItemContainerAction(player, { kind: "value", containerId: ShopManager.INVENTORY_INTERFACE_ID, slot: 1, itemId: STEEL_AXE, amount: 0 });
  buy(player, 0, STEEL_AXE);
  assert.deepEqual(player.messages, [
    "Steel axe: currently costs 200 trade sticks.",
    "Steel axe: shop will buy for 170 trade sticks.",
    "You don't have enough trade sticks.",
  ]);
});


test("Baba Yaga's Trade opens her post-Lunar Diplomacy shop", () => {
  const shops = require("../data/definitions/shops.json");
  const BabaYaga = require("../plugins/npcs/BabaYaga.plugin");
  const opened = [];
  let actions;
  BabaYaga.register({
    core: { ShopManager: { open: (...args) => opened.push(args) } },
    onNpcInteraction: (name, handlers) => { if (name === "Baba Yaga") actions = handlers; },
  });
  const player = {};
  actions.Trade({ player });
  assert.equal(opened[0][0], player);
  assert.match(shops.find(({ id }) => id === opened[0][1]).name, /^Baba Yaga's Magic Shop\. \(After Lunar Diplomacy\)$/);
});

test("a custom shop's npcInteractions bind its NPC, over shops.json on the same option", (t) => {
  const fs = require("node:fs");
  const { shopkeepers } = require("../plugins/npcs/Shopkeepers.plugin");
  const trader = (id, npcId, optionSlot) => ({ id, npcInteractions: [{ npcIds: [npcId], optionSlot }] });
  const files = {
    "shops.json": [trader(100, 1, 3), trader(101, 2, 3), trader(102, 2, 3), trader(103, 3, 3)],
    "custom-shops.json": [trader(7, 3, 3), trader(8, 4, 1), trader(9, 5, 9), { id: 10, originalStock: [] }],
  };
  const readFileSync = fs.readFileSync;
  t.mock.method(fs, "readFileSync", (file, ...args) => {
    const name = Object.keys(files).find((candidate) => String(file).endsWith(`/${candidate}`));
    return name ? JSON.stringify(files[name]) : readFileSync(file, ...args);
  });
  assert.deepEqual([...shopkeepers()], [["1:3", 100], ["2:3", null], ["3:3", 7], ["4:1", 8]],
    "shops.json keeps its bindings and ambiguity; custom shops add theirs; an out-of-range slot is ignored");
});

const CustomShops = require("../plugins/interface/CustomShops.plugin");
const CUSTOM_GROUP = 30009;
const NOTED_TOGGLE_UID = (CUSTOM_GROUP << 16) | 6;
const BUY_NOTED_ATTRIBUTE = "custom-shops:buy-noted";

function customShopHarness(t, steelStock = 50) {
  const fs = require("node:fs");
  const readFileSync = fs.readFileSync;
  t.mock.method(fs, "readFileSync", (file, ...args) => String(file).endsWith("custom-shops.json")
    ? JSON.stringify([{ id: AXE_SHOP, icon: STEEL_AXE }, { id: GENERAL_STORE, icon: BRONZE_AXE }])
    : readFileSync(file, ...args));
  const { Wilderness } = require("../dist/game/content/wilderness/Wilderness");
  t.mock.method(Wilderness, "isIn", () => false);
  let command, definition, delivery, startup;
  const buttons = new Map();
  const persisted = new Map();
  CustomShops.register({
    core: { ItemDefinition },
    onServerStartup: (handler) => { startup = handler; },
    getCombatFactory: () => ({ inCombat: () => false }),
    persistAttribute: (key, value) => {
      persisted.set(key, value);
      PlayerSave.persistAttribute(key, value);
    },
    registerCustomInterface: (group) => { definition = group; },
    registerCommand: (_name, handler) => { command = handler; },
    onInterfaceActionButton: (ids, handler) => {
      for (const id of Array.isArray(ids) ? ids : [ids]) buttons.set(id, handler);
    },
    onCustomEvent: (_name, handler) => { delivery = handler; },
  });
  t.mock.method(PluginManager, "emitCustomEvent", (name, request) => {
    if (name === "shop:delivery") delivery(request);
  });
  startup();
  loadShops(steelStock);
  const texts = new Map();
  const player = createPlayer();
  player.busy = () => false;
  const sender = player.getPacketSender();
  player.getPacketSender = () => new Proxy(sender, {
    get: (target, key) => key === "sendString"
      ? (text, id) => { texts.set(id, text); return target; } : target[key],
  });
  player.getInventory().add(new Item(COINS, 10000), false);
  const toggle = () => buttons.get(NOTED_TOGGLE_UID)({ player });
  const open = () => command({ player });
  open();
  return { player, toggle, open, texts, persisted, definition, delivery, buttons };
}

test("custom shops offer a saved noted toggle with unnoted purchases by default", t => {
  const h = customShopHarness(t);
  assert.equal(h.persisted.get(BUY_NOTED_ATTRIBUTE), false);
  assert.ok(PlayerSave.persistentAttributeKeys.has(BUY_NOTED_ATTRIBUTE));
  assert.match(h.texts.get(NOTED_TOGGLE_UID), /Off/);
  const widget = h.definition.widgets.find(({ id }) => id === NOTED_TOGGLE_UID);
  assert.equal(widget.flags & 2, 2, "the toggle transmits its click");
  assert.deepEqual(widget.actions, ["Toggle"]);
  buy(h.player, 1, STEEL_AXE);
  assert.equal(h.player.getInventory().getAmount(STEEL_AXE), 1);
  h.toggle();
  assert.equal(h.player.getAttribute(BUY_NOTED_ATTRIBUTE), true);
  assert.match(h.texts.get(NOTED_TOGGLE_UID), /On/);
  h.open();
  assert.match(h.texts.get(NOTED_TOGGLE_UID), /On/, "reopening preserves the choice");
  buy(h.player, 1, STEEL_AXE, "Buy 5");
  assert.equal(h.player.getInventory().getAmount(STEEL_AXE_NOTE), 5);
  assert.equal(h.player.getInventory().getAmount(COINS), 8800);
  assert.equal(stockOf().find(([id]) => id === STEEL_AXE)[1], 44);
  h.toggle();
  buy(h.player, 1, STEEL_AXE);
  assert.equal(h.player.getInventory().getAmount(STEEL_AXE), 2);
  assert.equal(h.player.getInventory().getAmount(STEEL_AXE_NOTE), 5);
  h.player.setInterfaceId(-1);
  h.toggle();
  assert.equal(h.player.getAttribute(BUY_NOTED_ATTRIBUTE), false, "a stale click cannot change it");
});

test("noted purchases use one slot, can extend a full inventory stack, and preserve payment on refusal", t => {
  const h = customShopHarness(t);
  h.toggle();
  for (let slot = 1; slot < 28; slot++) h.player.getInventory().add(new Item(20000 + slot), false);
  buy(h.player, 1, STEEL_AXE, "Buy 5");
  assert.equal(h.player.getInventory().getAmount(COINS), 10000);
  assert.equal(stockOf().find(([id]) => id === STEEL_AXE)[1], 50);
  h.player.getInventory().deleteAtSlot(27, 1, false);
  buy(h.player, 1, STEEL_AXE, "Buy 5");
  assert.equal(h.player.getInventory().getAmount(STEEL_AXE_NOTE), 5);
  assert.equal(h.player.getInventory().getFreeSlots(), 0);
  buy(h.player, 1, STEEL_AXE, "Buy 5");
  assert.equal(h.player.getInventory().getAmount(STEEL_AXE_NOTE), 10);
  assert.equal(h.player.getInventory().getAmount(COINS), 8000);
  assert.equal(stockOf().find(([id]) => id === STEEL_AXE)[1], 40);
});

test("noted mode leaves other shops, stackable/non-noteable items and other plugin delivery intact", t => {
  const h = customShopHarness(t);
  h.toggle();
  for (const [shopId, itemId, deliverId] of [[GENERAL_STORE, STEEL_AXE, STEEL_AXE],
    [AXE_SHOP, BRONZE_AXE, BRONZE_AXE], [AXE_SHOP, COINS, COINS],
    [AXE_SHOP, STEEL_AXE, BRONZE_AXE], [AXE_SHOP, STEEL_AXE, STEEL_AXE_NOTE]]) {
    const request = { player: h.player, shopId, itemId, deliverId };
    h.delivery(request);
    assert.equal(request.deliverId, deliverId);
  }
  const original = DEFINITIONS[STEEL_AXE].note;
  try {
    DEFINITIONS[STEEL_AXE].note = BRONZE_AXE;
    const request = { player: h.player, shopId: AXE_SHOP, itemId: STEEL_AXE, deliverId: STEEL_AXE };
    h.delivery(request);
    assert.equal(request.deliverId, STEEL_AXE, "a nonreciprocal note id cannot substitute another item");
  } finally {
    DEFINITIONS[STEEL_AXE].note = original;
  }
});
