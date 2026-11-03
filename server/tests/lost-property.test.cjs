// Run after `yarn build`: node --test tests/lost-property.test.cjs
//
// Issue 1971: Perdu's Lost Property shop sold everything to everyone. Checked against the Wiki's
// Lost Property shop page: a row shows only once unlocked, and only while none is owned unless
// the item is on the exceptions list; the diary rows sell the highest claimed tier.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { ShopDefinition } = require("../dist/game/definition/ShopDefinition");
const { Item } = require("../dist/game/model/Item");
const { PlayerStatus } = require("../dist/game/model/PlayerStatus");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { ShopManager } = require("../dist/game/model/container/shop/ShopManager");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { ItemIdentifiers: Items } = require("../dist/util/ItemIdentifiers");

const LostProperty = require("../plugins/npcs/LostProperty.plugin");
const lostPropertyData = require("../plugins/npcs/data/lost-property.json");
const shopsJson = require("../data/definitions/shops.json");

const COINS = 995;
const SHOP_ID = 9218;
const STOCK = [Items.ECTOPHIAL_2, Items.KARAMJA_GLOVES, Items.LUNAR_RING, Items.LUNAR_HELM, Items.COLOSSAL_BLADE];

ItemDefinition.forId = (id) => ({
  getId: () => id,
  getName: () => (id === COINS ? "Coins" : `item ${id}`),
  getExamine: () => "",
  isStackable: () => id === COINS,
  isNoted: () => false,
  unNote: () => id,
  getNoteId: () => -1,
  getValue: () => (id === COINS ? 1 : 0),
  isTradeable: () => true,
  isSellable: () => true,
});

const state = { quests: new Set(), diaries: new Map(), logged: new Set() };

before(() => {
  LostProperty.register(PluginManager.createApi("LostPropertyTest"));
  const answers = PluginManager.createApi("AnswersTest");
  answers.onCustomEvent("quest:is-complete", (request) => { request.complete = state.quests.has(request.name); });
  answers.onCustomEvent("quest:is-started", (request) => { request.started = state.quests.has(request.name); });
  answers.onCustomEvent("diary:is-reward-claimed", (request) => {
    request.claimed = (state.diaries.get(request.diary) ?? []).includes(request.tier);
  });
  answers.onCustomEvent("collection-log:obtained", (request) => { request.count = state.logged.has(request.itemId) ? 1 : 0; });
  ShopDefinition.replace([new ShopDefinition(SHOP_ID, "Lost Property shop", "COINS",
    STOCK.map((id) => ({ id, amount: 2000000000, restockTicks: null, price: 200 })), 100, 100, 100, "test")]);
  ShopManager.initialize();
});

function createPlayer() {
  const sender = new Proxy({}, { get: () => () => sender });
  const attributes = new Map();
  let status = PlayerStatus.NONE;
  let interfaceId = -1;
  const banks = [{ contains: () => false }];
  const player = {
    messages: [],
    banks,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getUsername: () => "perdu-test",
    sendMessage: (message) => player.messages.push(message),
    getPacketSender: () => sender,
    getSession: () => ({ sendClientPacket: () => true }),
    getStatus: () => status,
    setStatus: (next) => { status = next; },
    getInterfaceId: () => interfaceId,
    setInterfaceId: (next) => { interfaceId = next; },
    isPlayerBot: () => false,
    getEquipment: () => ({ contains: () => false }),
    getBanks: () => banks,
    getSkillManager: () => ({ getMaxLevel: () => 99 }),
  };
  player.inventory = new Inventory(player);
  player.inventory.resetItems();
  player.getInventory = () => player.inventory;
  player.getInventory().add(new Item(COINS, 100000), false);
  return player;
}

function stockFor(player) {
  ShopManager.open(player, SHOP_ID);
  return ShopManager.getOpenShop(player).stock.map((entry) => entry.itemId);
}

function reset() {
  state.quests.clear();
  state.diaries.clear();
  state.logged.clear();
}

test("a new account sees none of these rows, and a hidden row can't be bought", () => {
  reset();
  const player = createPlayer();
  assert.deepEqual(stockFor(player), [], "no quest, diary or log: every row in this stock is hidden");
  ShopManager.handleWidgetAction(player, { groupId: ShopManager.MAIN_INTERFACE_ID, childId: 16, buttonNum: 0, option: "Buy 1", slot: 1, itemId: Items.ECTOPHIAL_2 });
  assert.equal(player.getInventory().getAmount(Items.ECTOPHIAL_2), 0);
});

test("a quest unlocks its rows; a non-multiple row goes once owned and sells one at a time", () => {
  reset();
  state.quests.add("Ghosts Ahoy").add("Lunar Diplomacy");
  const player = createPlayer();
  assert.deepEqual(stockFor(player), [Items.ECTOPHIAL_2, Items.LUNAR_RING, Items.LUNAR_HELM]);
  ShopManager.handleWidgetAction(player, { groupId: ShopManager.MAIN_INTERFACE_ID, childId: 16, buttonNum: 0, option: "Buy 10", slot: 1, itemId: Items.ECTOPHIAL_2 });
  assert.equal(player.getInventory().getAmount(Items.ECTOPHIAL_2), 1, "one per purchase");
  assert.deepEqual(stockFor(player), [Items.LUNAR_RING, Items.LUNAR_HELM], "owned: the Ectophial row goes");

  player.getInventory().add(new Item(Items.LUNAR_RING, 1), false);
  assert.ok(stockFor(player).includes(Items.LUNAR_RING), "the Lunar ring is on the exceptions list");
  player.getInventory().delete(Items.ECTOPHIAL_2, 1);
  player.banks[0] = { contains: (id) => id === Items.ECTOPHIAL };
  assert.ok(!stockFor(player).includes(Items.ECTOPHIAL_2), "a full ectophial in the bank counts as owned");
});

test("a diary row sells the highest claimed tier of its reward", () => {
  reset();
  state.diaries.set("karamja", ["easy", "medium"]);
  const player = createPlayer();
  assert.deepEqual(stockFor(player), [Items.KARAMJA_GLOVES]);
  ShopManager.handleWidgetAction(player, { groupId: ShopManager.MAIN_INTERFACE_ID, childId: 16, buttonNum: 0, option: "Buy 1", slot: 1, itemId: Items.KARAMJA_GLOVES });
  assert.equal(player.getInventory().getAmount(Items.KARAMJA_GLOVES_2), 1);
  assert.equal(player.getInventory().getAmount(Items.KARAMJA_GLOVES), 0, "never the display item");
  assert.equal(player.getInventory().getAmount(COINS), 100000 - 200);
});

test("an activity reward shows once the collection log has it", () => {
  reset();
  const player = createPlayer();
  assert.ok(!stockFor(player).includes(Items.COLOSSAL_BLADE));
  state.logged.add(Items.COLOSSAL_BLADE);
  assert.deepEqual(stockFor(player), [Items.COLOSSAL_BLADE]);
});

test("Perdu buys nothing back", () => {
  reset();
  state.quests.add("Lunar Diplomacy");
  const player = createPlayer();
  player.getInventory().add(new Item(Items.LUNAR_HELM, 1), false);
  ShopManager.open(player, SHOP_ID);
  const slot = player.getInventory().getSlotForItemId(Items.LUNAR_HELM);
  ShopManager.handleItemContainerAction(player, { kind: "buy_sell", containerId: ShopManager.INVENTORY_INTERFACE_ID, slot, itemId: Items.LUNAR_HELM, amount: 1 });
  assert.equal(player.getInventory().getAmount(Items.LUNAR_HELM), 1);
});

test("every shops.json Lost Property row has data, a Wiki price, and resolvable item names", () => {
  const shop = shopsJson.find((entry) => entry.name === "Lost Property shop");
  const rows = new Set(lostPropertyData.items.map((entry) => Items[entry.item]));
  for (const { id } of shop.originalStock) {
    assert.ok(rows.has(id), `stock ${id} has a lost-property.json row`);
    assert.ok(shop.prices[id] > 0, `stock ${id} has a price`);
  }
  for (const entry of lostPropertyData.items) {
    for (const name of [entry.item, ...(entry.owned ?? []), ...(entry.tiers ?? []), ...(entry.carrying ? [entry.carrying] : [])]) {
      assert.equal(typeof Items[name], "number", `${name} is an item`);
    }
  }
});
