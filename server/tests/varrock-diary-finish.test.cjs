const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Item } = require("../dist/game/model/Item");
const diary = require("../plugins/achievements/diaries/VarrockDiaryFinish.plugin");
const apothecary = require("../plugins/npcs/Apothecary.plugin");
const gertrude = require("../plugins/npcs/Gertrude.plugin");
const asyff = require("../plugins/npcs/Asyff.plugin");
const core = PluginManager.getCoreApi();
const D = diary._test;
const A = apothecary._test;
const G = gertrude._test;
const Y = asyff._test;

before(async () => {
  await CachePipeline.initialize(process.cwd());
});

function add(player, id, amount = 1) {
  player.getInventory().add(new Item(id, amount), false);
}

function newPlayer(t) {
  const player = new Player(null);
  const messages = [];
  player.setRegistered(true);
  t.mock.method(player, "getSession", () => ({ sendClientPacket: () => true }));
  t.mock.method(player, "sendMessage", (message) => messages.push(message));
  return { player, messages };
}

function equipRing(player) {
  player.getEquipment().setItem(core.Equipment.RING_SLOT, new Item(G.RING_OF_CHAROS_A, 1));
}

/** The diary consumer; services are exercised through their own plugins. */
function diaryFixture(t) {
  const { player, messages } = newPlayer(t);
  const tasks = [];
  const taskKeys = new Set();
  const events = new Map();
  const api = {
    core,
    persistAttribute() {},
    onNpcInteraction() {},
    onCustomEvent(name, handler) {
      const handlers = events.get(name) ?? [];
      handlers.push(handler);
      events.set(name, handlers);
    },
    emitCustomEvent(name, event) {
      for (const handler of events.get(name) ?? []) handler(event);
    },
  };
  diary.register(api);
  api.onCustomEvent("diary:task", (event) => { tasks.push(event); taskKeys.add(event.task); });
  return { player, api, messages, tasks, taskKeys };
}

/** A moved service registered for real, with quest/pet responders for its gating. */
function serviceFixture(t, plugin, { questComplete = true, pet = null } = {}) {
  const { player, messages } = newPlayer(t);
  const npcActions = new Map();
  const events = new Map();
  const emitted = [];
  const api = {
    core,
    onNpcInteraction(name, actions) { npcActions.set(name, actions); },
    onCustomEvent(name, handler) {
      const handlers = events.get(name) ?? [];
      handlers.push(handler);
      events.set(name, handlers);
    },
    emitCustomEvent(name, event) {
      emitted.push({ name, event });
      if (name === "quest:is-complete") event.complete = questComplete;
      if (name === "pets:current") event.pet = pet;
      for (const handler of events.get(name) ?? []) handler(event);
    },
  };
  plugin.register(api);
  return { player, api, messages, npcActions, emitted };
}

test("the diary is credited by each ordinary success event", (t) => {
  const f = diaryFixture(t);
  f.api.emitCustomEvent("apothecary:strength-potion-made", { player: f.player, amount: 1 });
  f.api.emitCustomEvent("gertrude:kitten-colour-chosen", { player: f.player, colour: 0 });
  f.api.emitCustomEvent("garden-of-tranquillity:white-tree-fruit", { player: f.player });
  f.api.emitCustomEvent("farming:roots", {
    player: f.player, crop: "YEW", itemId: D.YEW_ROOTS, amount: 2, patch: { ...D.VARROCK_TREE_PATCH },
  });
  assert.equal(f.taskKeys.has(D.TASK.apothecary), true);
  assert.equal(f.taskKeys.has(D.TASK.kittenColour), true);
  assert.equal(f.taskKeys.has(D.TASK.whiteTreeFruit), true);
  assert.equal(f.taskKeys.has(D.TASK.yewRoots), true);
});

test("the spottier cape task needs Asyff's trade and then the cape worn", (t) => {
  const f = diaryFixture(t);
  f.player.getEquipment().setItem(core.Equipment.CAPE_SLOT, new Item(Y.SPOTTIER_CAPE, 1));
  f.api.emitCustomEvent("equipment:changed", { player: f.player });
  assert.equal(f.taskKeys.has(D.TASK.spottierCape), false, "a cape from elsewhere");

  f.player.getEquipment().setItem(core.Equipment.CAPE_SLOT, null);
  f.api.emitCustomEvent("asyff:spottier-cape-traded", { player: f.player, capeId: Y.SPOTTIER_CAPE });
  assert.equal(f.taskKeys.has(D.TASK.spottierCape), false, "traded but not worn");

  f.player.getEquipment().setItem(core.Equipment.CAPE_SLOT, new Item(Y.SPOTTIER_CAPE, 1));
  f.api.emitCustomEvent("equipment:changed", { player: f.player });
  assert.equal(f.taskKeys.has(D.TASK.spottierCape), true);
});

test("only a Varrock Palace yew harvest of at least two roots credits the diary", (t) => {
  const f = diaryFixture(t);
  const patch = { ...D.VARROCK_TREE_PATCH };
  f.api.emitCustomEvent("farming:roots", { player: f.player, crop: "YEW", itemId: D.YEW_ROOTS, amount: 1, patch });
  assert.equal(f.taskKeys.has(D.TASK.yewRoots), false);

  f.api.emitCustomEvent("farming:roots", { player: f.player, crop: "YEW", itemId: D.YEW_ROOTS, amount: 2, patch });
  assert.equal(f.taskKeys.has(D.TASK.yewRoots), true);

  const wrongPatch = diaryFixture(t);
  wrongPatch.api.emitCustomEvent("farming:roots", {
    player: wrongPatch.player, crop: "YEW", itemId: D.YEW_ROOTS, amount: 4,
    patch: { ...D.VARROCK_TREE_PATCH, x: 3229 },
  });
  assert.equal(wrongPatch.taskKeys.has(D.TASK.yewRoots), false);

  const wrongCrop = diaryFixture(t);
  wrongCrop.api.emitCustomEvent("farming:roots", {
    player: wrongCrop.player, crop: "MAPLE", itemId: D.YEW_ROOTS, amount: 4, patch,
  });
  assert.equal(wrongCrop.taskKeys.has(D.TASK.yewRoots), false);
});

test("Apothecary charges 5 coins plus one limpwurt root and red spiders' eggs per strength potion", (t) => {
  const f = serviceFixture(t, apothecary);
  add(f.player, A.LIMPWURT_ROOT, 1);
  add(f.player, A.RED_SPIDERS_EGGS, 1);
  add(f.player, core.ItemIdentifiers.COINS, 5);

  const price = { player: f.player, shopId: A.APOTHECARY_SHOP_ID, itemId: A.STRENGTH_POTION_4, price: 147 };
  f.api.emitCustomEvent("shop:buy-price", price);
  assert.equal(price.price, A.STRENGTH_POTION_COST);

  const limit = { player: f.player, shopId: A.APOTHECARY_SHOP_ID, itemId: A.STRENGTH_POTION_4, available: 2_000_000_000, limit: 2_000_000_000 };
  f.api.emitCustomEvent("shop:buy-limit", limit);
  assert.equal(limit.limit, 1);

  f.api.emitCustomEvent("shop:purchase", {
    player: f.player, shopId: A.APOTHECARY_SHOP_ID, itemId: A.STRENGTH_POTION_4, amount: 1,
  });
  assert.equal(f.player.getInventory().getAmount(A.LIMPWURT_ROOT), 0);
  assert.equal(f.player.getInventory().getAmount(A.RED_SPIDERS_EGGS), 0);
  assert.deepEqual(f.emitted.filter((e) => e.name === A.STRENGTH_POTION_MADE_EVENT).map((e) => e.event.amount), [1]);
});

test("Apothecary refuses the service without materials or coins and never emits a failed purchase", (t) => {
  const f = serviceFixture(t, apothecary);
  add(f.player, core.ItemIdentifiers.COINS, 5);
  const limit = { player: f.player, shopId: A.APOTHECARY_SHOP_ID, itemId: A.STRENGTH_POTION_4, available: 2_000_000_000, limit: 2_000_000_000, message: null };
  f.api.emitCustomEvent("shop:buy-limit", limit);
  assert.equal(limit.limit, 0);
  assert.match(limit.message, /limpwurt root and red spiders' eggs/);

  f.api.emitCustomEvent("shop:purchase", {
    player: f.player, shopId: A.APOTHECARY_SHOP_ID, itemId: A.STRENGTH_POTION_4, amount: 1,
  });
  assert.equal(f.emitted.some((e) => e.name === A.STRENGTH_POTION_MADE_EVENT), false);
});

test("choosing a kitten colour needs Gertrude's Cat, the worn Ring of Charos(a), 100 coins and no current cat", (t) => {
  const f = serviceFixture(t, gertrude);
  equipRing(f.player);
  add(f.player, core.ItemIdentifiers.COINS, 100);

  assert.equal(G.canChooseKitten(f.player, f.api), true);
  assert.equal(G.chooseKittenColour(f.api, f.player, 3), true);
  assert.equal(f.player.getInventory().getAmount(G.KITTEN_ITEM_IDS[3]), 1);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 0);
  assert.equal(f.emitted.some((e) => e.name === G.KITTEN_COLOUR_CHOSEN_EVENT), true);

  const noRing = serviceFixture(t, gertrude);
  add(noRing.player, core.ItemIdentifiers.COINS, 100);
  assert.equal(G.chooseKittenColour(noRing.api, noRing.player, 0), false);
  assert.match(noRing.messages.at(-1), /Ring of Charos/);

  const unfinished = serviceFixture(t, gertrude, { questComplete: false });
  equipRing(unfinished.player);
  add(unfinished.player, core.ItemIdentifiers.COINS, 100);
  assert.equal(G.chooseKittenColour(unfinished.api, unfinished.player, 0), false);
  assert.match(unfinished.messages.at(-1), /Gertrude's Cat/);

  const alreadyOwned = serviceFixture(t, gertrude);
  equipRing(alreadyOwned.player);
  add(alreadyOwned.player, core.ItemIdentifiers.COINS, 100);
  add(alreadyOwned.player, G.KITTEN_ITEM_IDS[0], 1);
  assert.equal(G.chooseKittenColour(alreadyOwned.api, alreadyOwned.player, 1), false);
  assert.match(alreadyOwned.messages.at(-1), /already looking after a cat/);

  const following = serviceFixture(t, gertrude, { pet: { getId: () => core.NpcIdentifiers.CAT } });
  equipRing(following.player);
  add(following.player, core.ItemIdentifiers.COINS, 100);
  assert.equal(G.chooseKittenColour(following.api, following.player, 0), false);
  assert.match(following.messages.at(-1), /already looking after a cat/);

  const poor = serviceFixture(t, gertrude);
  equipRing(poor.player);
  add(poor.player, core.ItemIdentifiers.COINS, 99);
  assert.equal(G.chooseKittenColour(poor.api, poor.player, 0), false);
  assert.match(poor.messages.at(-1), /100 coins/);

  const full = serviceFixture(t, gertrude);
  equipRing(full.player);
  add(full.player, core.ItemIdentifiers.COINS, 100);
  add(full.player, core.ItemIdentifiers.BRONZE_AXE, 28);
  assert.equal(G.chooseKittenColour(full.api, full.player, 0), false);
  assert.match(full.messages.at(-1), /free inventory slot/);
});

test("Gertrude's colour interface action opens the colour menu and is claimed", (t) => {
  const f = serviceFixture(t, gertrude);
  equipRing(f.player);
  add(f.player, core.ItemIdentifiers.COINS, 100);
  let started = null;
  t.mock.method(f.player, "getDialogueManager", () => ({ startDialogues: (chain) => { started = chain; } }));

  const event = { player: f.player, stepId: "ft92fH", action: "open_interface", target: "Pick a kitten interface", handled: false };
  f.api.emitCustomEvent("npc-dialogue:action", event);
  assert.equal(event.handled, true);
  assert.notEqual(started, null);
});

test("spottier cape trade takes 2 dashing kebbit furs and 800 coins at 66 Hunter", (t) => {
  const f = serviceFixture(t, asyff);
  f.player.getSkillManager().setCurrentLevels(core.Skill.HUNTER, Y.SPOTTIER_HUNTER_LEVEL);
  add(f.player, Y.DASHING_KEBBIT_FUR, 2);
  add(f.player, core.ItemIdentifiers.COINS, 800);

  assert.equal(Y.tradeSpottierCape(f.api, f.player), true);
  assert.equal(f.player.getInventory().getAmount(Y.DASHING_KEBBIT_FUR), 0);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 0);
  assert.equal(f.player.getInventory().getAmount(Y.SPOTTIER_CAPE), 1);
  assert.equal(f.emitted.some((e) => e.name === Y.SPOTTIER_CAPE_TRADED_EVENT), true);
  assert.match(f.messages.at(-1), /spottier cape/);

  const weak = serviceFixture(t, asyff);
  weak.player.getSkillManager().setCurrentLevels(core.Skill.HUNTER, Y.SPOTTIER_HUNTER_LEVEL - 1);
  add(weak.player, Y.DASHING_KEBBIT_FUR, 2);
  add(weak.player, core.ItemIdentifiers.COINS, 800);
  assert.equal(Y.tradeSpottierCape(weak.api, weak.player), false);
  assert.equal(weak.player.getInventory().getAmount(Y.DASHING_KEBBIT_FUR), 2);
  assert.match(weak.messages.at(-1), /66 Hunter/);

  const poor = serviceFixture(t, asyff);
  poor.player.getSkillManager().setCurrentLevels(core.Skill.HUNTER, Y.SPOTTIER_HUNTER_LEVEL);
  add(poor.player, Y.DASHING_KEBBIT_FUR, 2);
  add(poor.player, core.ItemIdentifiers.COINS, 799);
  assert.equal(Y.tradeSpottierCape(poor.api, poor.player), false);
  assert.equal(poor.player.getInventory().getAmount(Y.DASHING_KEBBIT_FUR), 2);
});

test("only Asyff's Custom Fur Clothing dialogue opens the spottier cape service", (t) => {
  const f = serviceFixture(t, asyff);
  let started = 0;
  t.mock.method(f.player, "getDialogueManager", () => ({ startDialogues: () => { started++; } }));
  for (const npcId of [core.NpcIdentifiers.NIA, core.NpcIdentifiers.PELLEM]) {
    const event = { player: f.player, npcId, action: "open_interface", target: Y.CUSTOM_FUR_TARGET, handled: false };
    f.api.emitCustomEvent("npc-dialogue:action", event);
    assert.equal(event.handled, false, "other fur merchants must keep their own service");
  }
  assert.equal(started, 0);
  const event = { player: f.player, npcId: core.NpcIdentifiers.ASYFF, action: "open_interface", target: Y.CUSTOM_FUR_TARGET, handled: false };
  f.api.emitCustomEvent("npc-dialogue:action", event);
  assert.equal(event.handled, true);
  assert.equal(started, 1);
});

test("Asyff's Fur Clothing option opens the made-to-order trade", (t) => {
  const f = serviceFixture(t, asyff);
  let started = 0;
  t.mock.method(f.player, "getDialogueManager", () => ({ startDialogues: () => { started++; } }));
  const action = f.npcActions.get("Asyff")?.["Fur Clothing"];
  assert.equal(typeof action, "function");
  const event = { player: f.player, handled: false };
  action(event);
  assert.equal(event.handled, true);
  assert.equal(started, 1);
});
