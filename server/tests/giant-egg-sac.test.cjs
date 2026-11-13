const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const GiantEggSac = require("../plugins/items/GiantEggSac.plugin");

const { EGGS_META } = GiantEggSac._test;
let core;
let actions;
let onItemOnItem;
let onItemOnItemNames;
let bankOp;
let nearBank;

function pluginApi() {
  return new Proxy({
    core,
    onItemAction(name, handlers) { actions.set(name, handlers); },
    onItemOnItem(...args) { onItemOnItem = args.find((arg) => typeof arg === "function"); onItemOnItemNames = args.filter((arg) => typeof arg === "string"); },
    onCustomEvent(name, handler) { if (name === core.Bank.INVENTORY_OP_EVENT) bankOp = handler; },
    emitCustomEvent(name, query) { if (name === "league:near-bank") query.near = nearBank; },
  }, { get: (target, key) => (key in target ? target[key] : () => {}) });
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  actions = new Map();
  GiantEggSac.register(pluginApi());
});

function actor(t) {
  nearBank = true;
  const player = new Player(null);
  const inventory = player.getInventory();
  const messages = [];
  t.mock.method(player, "sendMessage", (message) => messages.push(message));
  t.mock.method(inventory, "refreshItems", () => inventory);
  return { player, inventory, messages };
}

const I = () => core.ItemIdentifiers;
function put(f, id, slot, meta = null) {
  f.inventory.setItem(slot, new core.Item(id, 1, meta));
  return f.inventory.getItems()[slot];
}
function fillSlots(f, from, to) {
  for (let slot = from; slot <= to; slot++) put(f, I().BRONZE_DAGGER, slot);
}
function eggCount(f) {
  return f.inventory.getItems().filter((item) => item?.getId() === I().RED_SPIDERS_EGGS).length;
}
function option(name, op, f, slot) {
  const item = f.inventory.getItems()[slot];
  return actions.get(name)[op]({ player: f.player, item, itemId: item.getId(), slot, handled: false });
}
function knifeOn(f, knifeSlot, sacSlot) {
  const items = f.inventory.getItems();
  const event = {
    player: f.player,
    usedItem: items[knifeSlot], usedItemId: items[knifeSlot].getId(), usedItemSlot: knifeSlot,
    usedWithItem: items[sacSlot], usedWithItemId: items[sacSlot].getId(), usedWithItemSlot: sacSlot,
    handled: false,
  };
  onItemOnItem(event);
  return event;
}

test("a knife on the full sac in a bank opens it: eggs fill the free slots, the rest stay in the sac (rsprox 1507 t460)", (t) => {
  const f = actor(t);
  fillSlots(f, 0, 15);
  put(f, I().GIANT_EGG_SAC_FULL_, 16);
  put(f, I().KNIFE, 17);
  fillSlots(f, 24, 27);
  const event = knifeOn(f, 17, 16);
  assert.equal(event.handled, true);
  const sac = f.inventory.getItems()[16];
  assert.equal(sac.getId(), I().GIANT_EGG_SAC);
  assert.equal(sac.getMetaValue(EGGS_META), 94);
  assert.equal(eggCount(f), 6);
  for (let slot = 18; slot <= 23; slot++) assert.equal(f.inventory.getItems()[slot].getId(), I().RED_SPIDERS_EGGS);
  assert.equal(f.inventory.getItems()[17].getId(), I().KNIFE);
  assert.deepEqual(f.messages, ["You cut open the egg sac and receive 6 red spiders' eggs."]);
});

test("Cut-open checks the knife before the bank: no knife off a bank asks for one, a knife off a bank asks for a bank", (t) => {
  const f = actor(t);
  put(f, I().GIANT_EGG_SAC_FULL_, 0);
  nearBank = false;
  option("Giant egg sac(full)", "Cut-open", f, 0);
  put(f, I().KNIFE, 1);
  option("Giant egg sac(full)", "Cut-open", f, 0);
  nearBank = true;
  assert.deepEqual(f.messages, ["You need to have a knife to cut the egg sac open.", "You can only do this whilst in a bank."]);
  assert.equal(f.inventory.getItems()[0].getId(), I().GIANT_EGG_SAC_FULL_);
  assert.equal(eggCount(f), 0);
});

test("Cut-open with a knife and an empty backpack gives 26 eggs and keeps 74", (t) => {
  const f = actor(t);
  put(f, I().GIANT_EGG_SAC_FULL_, 0);
  put(f, I().KNIFE, 1);
  option("Giant egg sac(full)", "Cut-open", f, 0);
  assert.equal(eggCount(f), 26);
  assert.equal(f.inventory.getItems()[0].getMetaValue(EGGS_META), 74);
  assert.deepEqual(f.messages, ["You cut open the egg sac and receive 26 red spiders' eggs."]);
});

test("the knife hook is by name, knife and full sac", () => {
  assert.deepEqual(onItemOnItemNames, ["Knife", "Giant egg sac(full)"]);
});

test("a noted knife is no knife to cut with", (t) => {
  const f = actor(t);
  put(f, I().GIANT_EGG_SAC_FULL_, 0);
  put(f, core.ItemDefinition.forId(I().KNIFE).getNoteId?.() ?? 947, 1);
  assert.equal(f.inventory.getItems()[1].getDefinition().isNoted(), true);
  option("Giant egg sac(full)", "Cut-open", f, 0);
  assert.deepEqual(f.messages, ["You need to have a knife to cut the egg sac open."]);
  assert.equal(f.inventory.getItems()[0].getId(), I().GIANT_EGG_SAC_FULL_);
});

test("a knife on the full sac outside a bank refuses", (t) => {
  const f = actor(t);
  put(f, I().KNIFE, 0);
  put(f, I().GIANT_EGG_SAC_FULL_, 1);
  nearBank = false;
  const event = knifeOn(f, 1, 0);
  assert.equal(event.handled, true);
  assert.deepEqual(f.messages, ["You can only do this whilst in a bank."]);
  assert.equal(f.inventory.getItems()[1].getId(), I().GIANT_EGG_SAC_FULL_);
});

test("Check-eggs says 100 on the full sac and the count on the open one (rsprox 1507 t88, t495)", (t) => {
  const f = actor(t);
  put(f, I().GIANT_EGG_SAC_FULL_, 0);
  put(f, I().GIANT_EGG_SAC, 1, { [EGGS_META]: 94 });
  option("Giant egg sac(full)", "Check-eggs", f, 0);
  option("Giant egg sac", "Check-eggs", f, 1);
  assert.deepEqual(f.messages, ["There are 100 eggs left.", "There are 94 eggs left."]);
});

test("Remove-eggs with a full backpack refuses; with room it takes what fits; the last egg takes the sac", (t) => {
  const f = actor(t);
  put(f, I().GIANT_EGG_SAC, 0, { [EGGS_META]: 30 });
  fillSlots(f, 1, 27);
  option("Giant egg sac", "Remove-eggs", f, 0);
  assert.deepEqual(f.messages, ["You do not have enough inventory space."]);
  for (let slot = 1; slot <= 27; slot++) f.inventory.setItem(slot, new core.Item(-1, 0));
  option("Giant egg sac", "Remove-eggs", f, 0);
  assert.equal(eggCount(f), 27);
  assert.equal(f.inventory.getItems()[0].getMetaValue(EGGS_META), 3);
  for (let slot = 1; slot <= 25; slot++) f.inventory.setItem(slot, new core.Item(-1, 0));
  option("Giant egg sac", "Remove-eggs", f, 0);
  assert.equal(f.inventory.getItems()[0]?.getId() ?? -1, -1);
  assert.equal(f.inventory.getItems().some((item) => item?.getId() === I().GIANT_EGG_SAC), false);
  assert.equal(eggCount(f), 5);
});

test("the bank panel's Empty puts every egg in the bank and the sac goes (rsprox 1507 t679)", (t) => {
  const f = actor(t);
  put(f, I().GIANT_EGG_SAC, 16, { [EGGS_META]: 94 });
  const bank = f.player.getBank(core.Bank.getTabForItem(f.player, I().RED_SPIDERS_EGGS));
  bank.add(new core.Item(I().RED_SPIDERS_EGGS, 40), false);
  const event = { player: f.player, item: f.inventory.getItems()[16], slot: 16, op: 9, handled: false };
  bankOp(event);
  assert.equal(event.handled, true);
  assert.equal(f.inventory.getItems()[16]?.getId() ?? -1, -1);
  assert.equal(bank.getAmount(I().RED_SPIDERS_EGGS), 134);
  assert.deepEqual(f.messages, ["You empty 94 red spiders' eggs into the bank."]);
});

test("other bank ops and other items are left to the bank", (t) => {
  const f = actor(t);
  put(f, I().GIANT_EGG_SAC, 0, { [EGGS_META]: 10 });
  put(f, I().GIANT_EGG_SAC_FULL_, 1);
  const deposit = { player: f.player, item: f.inventory.getItems()[0], slot: 0, op: 2, handled: false };
  const full = { player: f.player, item: f.inventory.getItems()[1], slot: 1, op: 9, handled: false };
  bankOp(deposit);
  bankOp(full);
  assert.equal(deposit.handled, false);
  assert.equal(full.handled, false);
});
