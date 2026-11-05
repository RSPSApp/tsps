const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Item } = require("../dist/game/model/Item");
const plugin = require("../plugins/achievements/diaries/VarrockDiaryFinish.plugin");
const core = PluginManager.getCoreApi();
const T = plugin._test;

before(async () => {
  await CachePipeline.initialize(process.cwd());
});

function fixture(t, { questComplete = true, pet = null } = {}) {
  const player = new Player(null);
  const messages = [];
  const tasks = [];
  const events = new Map();
  player.setRegistered(true);
  t.mock.method(player, "getSession", () => ({ sendClientPacket: () => true }));
  t.mock.method(player, "sendMessage", (message) => messages.push(message));
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
      if (name === "quest:is-complete") event.complete = questComplete;
      if (name === "pets:current" && pet) event.pet = pet;
      for (const handler of events.get(name) ?? []) handler(event);
    },
    setQuestComplete(value) { questComplete = value; },
  };
  plugin.register(api);
  api.onCustomEvent("diary:task", (event) => tasks.push(event));
  const taskKeys = new Set();
  api.onCustomEvent("diary:task", (event) => taskKeys.add(event.task));
  return { player, api, messages, tasks, taskKeys };
}

function add(player, id, amount = 1) {
  player.getInventory().add(new Item(id, amount), false);
}

function equipRing(player) {
  player.getEquipment().setItem(core.Equipment.RING_SLOT, new Item(6465, 1));
}

function equipCape(player) {
  player.getEquipment().setItem(core.Equipment.CAPE_SLOT, new Item(T.SPOTTIER_CAPE, 1));
}

test("Apothecary charges 5 coins plus one limpwurt root and red spiders' eggs per strength potion", (t) => {
  const f = fixture(t);
  add(f.player, 225, 1);
  add(f.player, 223, 1);
  add(f.player, core.ItemIdentifiers.COINS, 5);

  const price = { player: f.player, shopId: T.APOTHECARY_SHOP_ID, itemId: T.STRENGTH_POTION_4, price: 147 };
  T.apothecaryBuyPrice(f.api, price);
  assert.equal(price.price, T.STRENGTH_POTION_COST);

  const limit = { player: f.player, shopId: T.APOTHECARY_SHOP_ID, itemId: T.STRENGTH_POTION_4, available: 2_000_000_000, limit: 2_000_000_000 };
  T.apothecaryBuyLimit(f.api, limit);
  assert.equal(limit.limit, 1);

  f.api.emitCustomEvent("shop:purchase", {
    player: f.player, shopId: T.APOTHECARY_SHOP_ID, itemId: T.STRENGTH_POTION_4, amount: 1,
  });
  assert.equal(f.player.getInventory().getAmount(225), 0);
  assert.equal(f.player.getInventory().getAmount(223), 0);
  assert.equal(f.taskKeys.has(T.TASK.apothecary), true);
  assert.equal(f.tasks.length, 1);
});

test("Apothecary refuses the service without materials or coins and never credits a failed purchase", (t) => {
  const f = fixture(t);
  add(f.player, core.ItemIdentifiers.COINS, 5);
  const limit = { player: f.player, shopId: T.APOTHECARY_SHOP_ID, itemId: T.STRENGTH_POTION_4, available: 2_000_000_000, limit: 2_000_000_000, message: null };
  T.apothecaryBuyLimit(f.api, limit);
  assert.equal(limit.limit, 0);
  assert.match(limit.message, /limpwurt root and red spiders' eggs/);

  f.api.emitCustomEvent("shop:purchase", {
    player: f.player, shopId: T.APOTHECARY_SHOP_ID, itemId: T.STRENGTH_POTION_4, amount: 1,
  });
  assert.equal(f.taskKeys.has(T.TASK.apothecary), false);
  assert.equal(f.tasks.length, 0);
});

test("choosing a kitten colour needs Gertrude's Cat, the worn Ring of Charos(a), 100 coins and no current cat", (t) => {
  const f = fixture(t);
  equipRing(f.player);
  add(f.player, core.ItemIdentifiers.COINS, 100);

  assert.equal(T.canChooseKitten(f.player, f.api), true);
  assert.equal(T.chooseKittenColour(f.api, f.player, 3), true);
  assert.equal(f.player.getInventory().getAmount(T.KITTEN_ITEM_IDS[3]), 1);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 0);
  assert.equal(f.taskKeys.has(T.TASK.kittenColour), true);

  const noRing = fixture(t);
  add(noRing.player, core.ItemIdentifiers.COINS, 100);
  assert.equal(T.chooseKittenColour(noRing.api, noRing.player, 0), false);
  assert.equal(noRing.tasks.length, 0);
  assert.match(noRing.messages.at(-1), /Ring of Charos/);

  const unfinished = fixture(t, { questComplete: false });
  equipRing(unfinished.player);
  add(unfinished.player, core.ItemIdentifiers.COINS, 100);
  assert.equal(T.chooseKittenColour(unfinished.api, unfinished.player, 0), false);
  assert.match(unfinished.messages.at(-1), /Gertrude's Cat/);

  const alreadyOwned = fixture(t);
  equipRing(alreadyOwned.player);
  add(alreadyOwned.player, core.ItemIdentifiers.COINS, 100);
  add(alreadyOwned.player, T.KITTEN_ITEM_IDS[0], 1);
  assert.equal(T.chooseKittenColour(alreadyOwned.api, alreadyOwned.player, 1), false);
  assert.match(alreadyOwned.messages.at(-1), /already looking after a cat/);

  const poor = fixture(t);
  equipRing(poor.player);
  add(poor.player, core.ItemIdentifiers.COINS, 99);
  assert.equal(T.chooseKittenColour(poor.api, poor.player, 0), false);
  assert.match(poor.messages.at(-1), /100 coins/);
});

test("Gertrude's colour interface action opens the colour menu and is claimed", (t) => {
  const f = fixture(t);
  equipRing(f.player);
  add(f.player, core.ItemIdentifiers.COINS, 100);
  let started = null;
  t.mock.method(f.player, "getDialogueManager", () => ({ startDialogues: (chain) => { started = chain; } }));

  const event = { player: f.player, stepId: "ft92fH", action: "open_interface", target: "Pick a kitten interface", handled: false };
  T.onDialogueAction(f.api, event);
  assert.equal(event.handled, true);
  assert.notEqual(started, null);
});

test("spottier cape trade takes 2 dashing kebbit furs and 800 coins at 66 Hunter", (t) => {
  const f = fixture(t);
  f.player.getSkillManager().setCurrentLevels(core.Skill.HUNTER, T.SPOTTIER_HUNTER_LEVEL);
  add(f.player, T.DASHING_KEBBIT_FUR, 2);
  add(f.player, core.ItemIdentifiers.COINS, 800);

  assert.equal(T.tradeSpottierCape(f.player, f.api), true);
  assert.equal(f.player.getInventory().getAmount(T.DASHING_KEBBIT_FUR), 0);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 0);
  assert.equal(f.player.getInventory().getAmount(T.SPOTTIER_CAPE), 1);
  assert.equal(f.player.getAttribute(T.SPOTTIER_TRADED_ATTRIBUTE), true);
  assert.match(f.messages.at(-1), /spottier cape/);

  const weak = fixture(t);
  weak.player.getSkillManager().setCurrentLevels(core.Skill.HUNTER, T.SPOTTIER_HUNTER_LEVEL - 1);
  add(weak.player, T.DASHING_KEBBIT_FUR, 2);
  add(weak.player, core.ItemIdentifiers.COINS, 800);
  assert.equal(T.tradeSpottierCape(weak.player, weak.api), false);
  assert.equal(weak.player.getInventory().getAmount(T.DASHING_KEBBIT_FUR), 2);
  assert.match(weak.messages.at(-1), /66 Hunter/);

  const poor = fixture(t);
  poor.player.getSkillManager().setCurrentLevels(core.Skill.HUNTER, T.SPOTTIER_HUNTER_LEVEL);
  add(poor.player, T.DASHING_KEBBIT_FUR, 2);
  add(poor.player, core.ItemIdentifiers.COINS, 799);
  assert.equal(T.tradeSpottierCape(poor.player, poor.api), false);
  assert.equal(poor.player.getInventory().getAmount(T.DASHING_KEBBIT_FUR), 2);
});

test("equipping the traded spottier cape completes the diary task; a cape from elsewhere does not", (t) => {
  const f = fixture(t);
  equipCape(f.player);
  f.api.emitCustomEvent("equipment:changed", { player: f.player });
  assert.equal(f.taskKeys.has(T.TASK.spottierCape), false);

  f.player.setAttribute(T.SPOTTIER_TRADED_ATTRIBUTE, true);
  f.api.emitCustomEvent("equipment:changed", { player: f.player });
  assert.equal(f.taskKeys.has(T.TASK.spottierCape), true);
});

test("only a Varrock Palace yew harvest of at least two roots credits the diary", (t) => {
  const f = fixture(t);
  const patch = { ...T.VARROCK_TREE_PATCH };
  f.api.emitCustomEvent("farming:roots", { player: f.player, crop: "YEW", itemId: T.YEW_ROOTS, amount: 1, patch });
  assert.equal(f.taskKeys.has(T.TASK.yewRoots), false);

  f.api.emitCustomEvent("farming:roots", { player: f.player, crop: "YEW", itemId: T.YEW_ROOTS, amount: 2, patch });
  assert.equal(f.taskKeys.has(T.TASK.yewRoots), true);

  const wrongPatch = fixture(t);
  wrongPatch.api.emitCustomEvent("farming:roots", {
    player: wrongPatch.player, crop: "YEW", itemId: T.YEW_ROOTS, amount: 4,
    patch: { ...T.VARROCK_TREE_PATCH, x: 3229 },
  });
  assert.equal(wrongPatch.taskKeys.has(T.TASK.yewRoots), false);

  const wrongCrop = fixture(t);
  wrongCrop.api.emitCustomEvent("farming:roots", {
    player: wrongCrop.player, crop: "MAPLE", itemId: T.YEW_ROOTS, amount: 4, patch,
  });
  assert.equal(wrongCrop.taskKeys.has(T.TASK.yewRoots), false);
});

test("picking a white tree fruit credits the diary task", (t) => {
  const f = fixture(t);
  f.api.emitCustomEvent("garden-of-tranquillity:white-tree-fruit", { player: f.player });
  assert.equal(f.taskKeys.has(T.TASK.whiteTreeFruit), true);
});


test("only Asyff's Custom Fur Clothing dialogue opens the spottier cape service", (t) => {
  const f = fixture(t);
  let started = 0;
  t.mock.method(f.player, "getDialogueManager", () => ({ startDialogues: () => { started++; } }));
  for (const npcId of [core.NpcIdentifiers.NIA, core.NpcIdentifiers.PELLEM]) {
    const event = { player: f.player, npcId, action: "open_interface", target: "Custom Fur Clothing", handled: false };
    T.onDialogueAction(f.api, event);
    assert.equal(event.handled, false, "other fur merchants must keep their own service");
  }
  assert.equal(started, 0);
  const event = { player: f.player, npcId: core.NpcIdentifiers.ASYFF, action: "open_interface", target: "Custom Fur Clothing", handled: false };
  T.onDialogueAction(f.api, event);
  assert.equal(event.handled, true);
  assert.equal(started, 1);
});
