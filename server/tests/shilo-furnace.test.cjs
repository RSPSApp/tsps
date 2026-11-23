// Run after `yarn build`: node --test tests/shilo-furnace.test.cjs
const assert = require("node:assert/strict");
const { test, before, beforeEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const ShiloFurnace = require("../plugins/world/ShiloFurnace.plugin");

const { attach, resolveIds, gateSmelt, gateItem, openCoffer, depositAndReopen, emptyCoffer, COFFER_ATTRIBUTE, DONT_ASK_ATTRIBUTE } = ShiloFurnace._test;

let core;
let elite = false;
const prompts = [];
const reruns = [];
let LIT;
let PARENT;
let OTHER_FURNACE;
const COINS = 995;

before(async () => {
  await require("../dist/game/cache/CachePipeline").CachePipeline.initialize(process.cwd());
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  LIT = core.CacheDefinitions.getLocId("zqfurnace_lit");
  PARENT = core.CacheDefinitions.getLocId("zqfurnace");
  OTHER_FURNACE = core.CacheDefinitions.getLocId("furnace");
  attach({
    core,
    emitCustomEvent(name, request) {
      if (name === "diary:is-complete" && request.diary === "karamja" && request.tier === "elite") request.complete = elite;
    },
    sendMultiChatboxPrompt: (player, title, ...pairs) => prompts.push({ player, title, labels: pairs.filter((_, i) => i % 2 === 0), callbacks: pairs.filter((_, i) => i % 2 === 1) }),
    emitObjectInteraction: (event) => { reruns.push({ kind: "object", event }); gateSmelt(event); return true; },
    emitItemOnObject: (event) => { reruns.push({ kind: "item", event }); gateItem(event); return event.itemId !== 401; },
  });
  resolveIds();
});

beforeEach(() => {
  elite = false;
  prompts.length = 0;
  reruns.length = 0;
});

function player({ coins = 0, coffer = 0, dontAsk = false } = {}) {
  const attributes = new Map([[COFFER_ATTRIBUTE, coffer], [DONT_ASK_ATTRIBUTE, dontAsk]]);
  const p = {
    coins, messages: [], sounds: [], amountPrompt: null, amountAction: null, npcLines: [], closed: 0,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (text) => p.messages.push(text),
    getInventory: () => ({
      getAmount: (id) => (id === COINS ? p.coins : 0),
      deleteNumber: (id, count) => { if (id === COINS) p.coins -= count; },
      addItem: (item) => { if (item.getId() === COINS) p.coins += item.getAmount(); },
      getAddableAmount: (item) => Math.min(item.getAmount(), 2147483647 - p.coins),
    }),
    getPacketSender: () => ({
      sendSound: (id) => p.sounds.push(id),
      sendInterfaceRemoval: () => { p.closed++; },
      sendEnterAmountPrompt: (title) => { p.amountPrompt = title; },
    }),
    setEnteredAmountAction: (action) => { p.amountAction = action; },
    getDialogueManager: () => ({ startDialogues: (chain) => p.npcLines.push(chain) }),
  };
  return p;
}

const coffer = (p) => p.getAttribute(COFFER_ATTRIBUTE);
const smeltEvent = (p, overrides = {}) => ({
  player: p, objectId: PARENT, definition: core.ObjectDefinition.forId(LIT), option: "smelt", clickType: 2, handled: false, ...overrides,
});
const itemEvent = (p, itemId, overrides = {}) => ({
  player: p, objectId: PARENT, definition: core.ObjectDefinition.forId(LIT), itemId, handled: false, ...overrides,
});
const choose = (prompt, label) => prompt.callbacks[prompt.labels.indexOf(label)]();

test("the lit Shilo furnace is the zqfurnace multiloc's Smelt/Coffer child", () => {
  const definition = core.ObjectDefinition.forId(LIT);
  assert.equal(definition.name, "Furnace");
  assert.deepEqual(definition.getInteractions().slice(1, 3), ["Smelt", "Coffer"]);
});

test("Smelt with an empty coffer offers one use or what the coins carried allow (local 1000359)", () => {
  const p = player({ coins: 204 });
  const event = smeltEvent(p);
  gateSmelt(event);
  assert.equal(event.handled, true);
  assert.equal(reruns.length, 0);
  assert.equal(prompts[0].title, "Your coffer is empty.");
  assert.deepEqual(prompts[0].labels, ["Add one use: 20 coins", "Add 10 uses: 200 coins", "Cancel"]);
  choose(prompts[0], "Add one use: 20 coins");
  assert.equal(p.coins, 184);
  assert.equal(coffer(p), 0);
  assert.deepEqual(p.messages, ["<col=ff0000>Your coffer is empty. You must top it up before you can use the furnace again."]);
  assert.deepEqual(p.sounds, [2115]);
  // The paid click runs again past the fee, for Smithing and Crafting to take.
  assert.equal(reruns.length, 1);
  assert.equal(reruns[0].event.handled, false);
});

test("a rich player's top-up stops at the coffer's 40,000 coins (local 1000217)", () => {
  const p = player({ coins: 1253039942 });
  gateSmelt(smeltEvent(p));
  assert.deepEqual(prompts[0].labels, ["Add one use: 20 coins", "Add 2,000 uses: 40,000 coins", "Cancel"]);
  choose(prompts[0], "Add 2,000 uses: 40,000 coins");
  assert.equal(p.coins, 1252999942);
  assert.equal(coffer(p), 39980);
  assert.deepEqual(p.messages, []);
  assert.equal(reruns.length, 1);
});

test("no coins in the coffer or the inventory: Yohnus asks for his fee", () => {
  const p = player({ coins: 19 });
  gateSmelt(smeltEvent(p));
  assert.equal(prompts.length, 0);
  assert.equal(p.npcLines.length, 1);
  assert.equal(reruns.length, 0);
});

test("with coins in the coffer it asks first; don't ask again sticks (local 1000230, 1000412)", () => {
  const p = player({ coffer: 39980 });
  gateSmelt(smeltEvent(p));
  assert.equal(prompts[0].title, "Furnace coffer: 39,980 coins");
  assert.deepEqual(prompts[0].labels, ["Pay 20 coins to use the furnace.", "Pay 20 coins and don't ask again.", "Cancel."]);
  choose(prompts[0], "Pay 20 coins and don't ask again.");
  assert.equal(coffer(p), 39960);
  assert.equal(p.getAttribute(DONT_ASK_ATTRIBUTE), true);
  assert.deepEqual(p.messages, []);
  assert.equal(reruns.length, 1);

  // Then a Smelt click names what is left (local 1000262, 1000334); an item use says nothing.
  gateSmelt(smeltEvent(p));
  assert.equal(prompts.length, 1);
  assert.equal(coffer(p), 39940);
  assert.deepEqual(p.messages, ["Your coffer contains 39,940 coins, enough for 1997 more furnace uses."]);
  gateItem(itemEvent(p, 2357));
  assert.equal(coffer(p), 39920);
  assert.equal(p.messages.length, 1);
  assert.equal(reruns.length, 3);
});

test("Cancel leaves the coffer and the click alone", () => {
  const p = player({ coffer: 400 });
  gateItem(itemEvent(p, 2357));
  choose(prompts[0], "Cancel.");
  assert.equal(coffer(p), 400);
  assert.equal(reruns.length, 0);
});

test("any item used on the furnace pays first; one nothing takes says so", () => {
  const p = player({ coffer: 400, dontAsk: true });
  gateItem(itemEvent(p, 401));
  assert.equal(coffer(p), 380);
  assert.deepEqual(p.messages, ["Nothing interesting happens."]);
});

test("the elite Karamja Diary makes it free", () => {
  elite = true;
  const p = player({ coins: 1000 });
  const event = smeltEvent(p);
  gateSmelt(event);
  assert.equal(prompts.length, 0);
  assert.equal(p.coins, 1000);
  assert.equal(reruns.length, 1);
});

test("other furnaces and other options are not charged", () => {
  const p = player({ coins: 1000 });
  const other = smeltEvent(p, { objectId: OTHER_FURNACE, definition: core.ObjectDefinition.forId(OTHER_FURNACE) });
  gateSmelt(other);
  gateItem(itemEvent(p, 2357, { objectId: OTHER_FURNACE, definition: core.ObjectDefinition.forId(OTHER_FURNACE) }));
  const cofferClick = smeltEvent(p, { option: "coffer", clickType: 3 });
  gateSmelt(cofferClick);
  assert.equal(other.handled, false);
  assert.equal(cofferClick.handled, false);
  assert.equal(prompts.length, 0);
});

test("Coffer: deposit rounds to whole uses, the menu reopens (recording 1749)", () => {
  const p = player({ coins: 200000 });
  openCoffer({ player: p });
  assert.equal(prompts[0].title, "Furnace coffer: 0 coins");
  assert.deepEqual(prompts[0].labels, ["Deposit coins", "Empty coffer", "Cancel"]);
  choose(prompts[0], "Deposit coins");
  assert.equal(p.amountPrompt, "How much do you wish to deposit? (20 - 40,000 coins)");
  p.amountAction.execute(200000);
  assert.equal(coffer(p), 40000);
  assert.equal(p.coins, 160000);
  assert.deepEqual(p.sounds, [2115]);
  assert.equal(prompts[1].title, "Furnace coffer: 40,000 coins");

  const q = player({ coins: 75 });
  depositAndReopen(q, 75);
  assert.equal(coffer(q), 60);
  assert.equal(q.coins, 15);
});

test("Coffer: Empty coffer withdraws it all, or says it is already empty", () => {
  const p = player({ coffer: 8600 });
  emptyCoffer(p);
  assert.equal(coffer(p), 0);
  assert.equal(p.coins, 8600);
  assert.deepEqual(p.messages, ["You withdraw 8,600 coins."]);
  emptyCoffer(p);
  assert.equal(p.messages[1], "It's already empty.");
});

test("Coffer after the elite diary: deposits are struck out (recording 3030)", () => {
  elite = true;
  const p = player({ coins: 500 });
  openCoffer({ player: p });
  assert.deepEqual(prompts[0].labels, ["<str>Deposit coins</str>", "Empty coffer", "Cancel"]);
  choose(prompts[0], "<str>Deposit coins</str>");
  assert.equal(coffer(p), 0);
  assert.deepEqual(p.messages, ["You have earned the Elite Karamja reward, so you no longer need to pay to use this furnace."]);
});

test("item-on-object handlers registered with `before` run ahead of the others", () => {
  const order = [];
  const api = PluginManager.createApi("ShiloFurnaceBeforeTest");
  api.onItemOnObject(() => order.push("normal"));
  api.onItemOnObject((event) => { order.push("before"); event.handled = true; }, { before: true });
  PluginManager.emitItemOnObject({ player: {}, object: {}, objectId: -1, itemId: -1, handled: false });
  assert.deepEqual(order, ["before"]);
});
