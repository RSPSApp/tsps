const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const ScalyBlueDragonhide = require("../plugins/items/ScalyBlueDragonhide.plugin");

const { SCRAPED, NOT_IN_BANK } = ScalyBlueDragonhide._test;
let core;
let hook;
let nearBank;

function pluginApi() {
  return new Proxy({
    core,
    onItemOnItem(...args) { hook = { names: args.filter((arg) => typeof arg === "string"), fn: args.find((arg) => typeof arg === "function"), filter: args.at(-1) }; },
    emitCustomEvent(name, query) { if (name === "league:near-bank") query.near = nearBank; },
  }, { get: (target, key) => (key in target ? target[key] : () => {}) });
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  ScalyBlueDragonhide.register(pluginApi());
});

const I = () => core.ItemIdentifiers;

function actor(t) {
  nearBank = true;
  const player = new Player(null);
  const inventory = player.getInventory();
  const messages = [];
  t.mock.method(player, "sendMessage", (message) => messages.push(message));
  t.mock.method(inventory, "refreshItems", () => inventory);
  return { player, inventory, messages };
}

function put(f, id, slot, amount = 1) {
  f.inventory.setItem(slot, new core.Item(id, amount));
}

function use(f, usedSlot, withSlot) {
  const items = f.inventory.getItems();
  const event = {
    player: f.player,
    usedItem: items[usedSlot], usedItemId: items[usedSlot].getId(), usedItemSlot: usedSlot,
    usedWithItem: items[withSlot], usedWithItemId: items[withSlot].getId(), usedWithItemSlot: withSlot,
    handled: false,
  };
  hook.fn(event);
  return event;
}

function slot(f, s) {
  const item = f.inventory.getItems()[s];
  return item && item.getId() >= 0 && item.getAmount() > 0 ? [item.getId(), item.getAmount()] : null;
}

test("the hook is knife on the unnoted hide", () => {
  assert.deepEqual(hook.names, ["Knife", "Scaly blue dragonhide"]);
  assert.equal(hook.filter.noted, false);
  assert.equal(core.ItemDefinition.forId(I().BLUE_DRAGON_SCALE).getNoteId(), 244);
});

test("in a bank the first hide becomes 50 noted scales in its slot (rsprox 1000380 t4994)", (t) => {
  const f = actor(t);
  for (let s = 0; s < 14; s++) put(f, I().BRONZE_DAGGER, s);
  for (let s = 14; s <= 18; s++) put(f, I().SCALY_BLUE_DRAGONHIDE, s);
  put(f, I().KNIFE, 22);
  const event = use(f, 22, 18);
  assert.equal(event.handled, true);
  assert.deepEqual(slot(f, 14), [244, 50]);
  assert.deepEqual(slot(f, 18), [I().SCALY_BLUE_DRAGONHIDE, 1]);
  assert.equal(f.inventory.getAmount(I().SCALY_BLUE_DRAGONHIDE), 4);
  assert.deepEqual(f.messages, [SCRAPED]);
});

test("the next hide's scales join the stack and free its slot (rsprox 1000380 t4996)", (t) => {
  const f = actor(t);
  put(f, 244, 14, 50);
  put(f, I().SCALY_BLUE_DRAGONHIDE, 15);
  put(f, I().SCALY_BLUE_DRAGONHIDE, 18);
  put(f, I().KNIFE, 22);
  use(f, 18, 22);
  assert.deepEqual(slot(f, 14), [244, 100]);
  assert.equal(slot(f, 15), null);
  assert.deepEqual(slot(f, 18), [I().SCALY_BLUE_DRAGONHIDE, 1]);
  assert.deepEqual(f.messages, [SCRAPED]);
});

test("away from a bank the hide stays and the bank line is sent (Wiki)", (t) => {
  const f = actor(t);
  nearBank = false;
  put(f, I().SCALY_BLUE_DRAGONHIDE, 0);
  put(f, I().KNIFE, 1);
  const event = use(f, 1, 0);
  assert.equal(event.handled, true);
  assert.deepEqual(slot(f, 0), [I().SCALY_BLUE_DRAGONHIDE, 1]);
  assert.equal(f.inventory.getAmount(244), 0);
  assert.deepEqual(f.messages, [NOT_IN_BANK]);
});
