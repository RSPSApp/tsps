const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const Potions = require("../plugins/items/Potions.plugin");
const ChuggingBarrel = require("../plugins/items/ChuggingBarrel.plugin");

const ATTRIBUTE = "chugging-barrel:potions";
const BARREL_NAME = "Chugging barrel";
const DISASSEMBLED_NAME = "Chugging barrel (disassembled)";
let core;
let actions;
let onItemOnItem;
let rules;
let persistedAttributes;
let drunkEvents;
let confirm;

function pluginApi() {
  const methods = {
    core,
    persistAttribute(key, initialValue) { persistedAttributes.set(key, initialValue); },
    onItemAction(name, handlers) { actions.set(name, handlers); },
    onItemOnItem(handler) { onItemOnItem = handler; },
    emitCanDrink() { return rules.canDrink; },
    emitCanEat() { return rules.canEat; },
    emitCustomEvent(name, request) {
      if (name === "league:near-bank") request.near = rules.nearBank;
      if (name === "potions:area") request.inside = rules.insideCox;
      if (name === "potions:validate-drink" && !rules.validateDrink) {
        request.allowed = false;
        request.message = "The potion is locked.";
      }
      if (name === "potions:drunk") drunkEvents.push(request);
    },
    sendMultiChatboxPrompt(player, message, option, callback) { confirm = callback; },
  };
  return new Proxy(methods, {
    get(target, key) {
      if (key in target) return target[key];
      return () => {};
    },
  });
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  actions = new Map();
  persistedAttributes = new Map();
  drunkEvents = [];
  rules = { nearBank: true, canDrink: true, canEat: true, insideCox: false, validateDrink: true };
  const api = pluginApi();
  Potions.register(api);
  ChuggingBarrel.register(api);
});

function actor(t) {
  rules = { nearBank: true, canDrink: true, canEat: true, insideCox: false, validateDrink: true };
  drunkEvents.length = 0;
  confirm = null;
  const player = new Player(null);
  const inventory = player.getInventory();
  const messages = [];
  const sender = { sendInterfaceRemoval() {} };
  t.mock.method(player, "sendMessage", (message) => messages.push(message));
  t.mock.method(player, "performAnimation", () => {});
  t.mock.method(player, "getPacketSender", () => sender);
  t.mock.method(inventory, "refreshItems", () => inventory);
  return { player, inventory, messages };
}

function put(f, itemId, slot, meta = null) {
  f.inventory.setItem(slot, new core.Item(itemId, 1, meta));
  return f.inventory.getItems()[slot];
}

function fill(f, potionSlot, barrelSlot) {
  const potion = f.inventory.getItems()[potionSlot];
  const barrel = f.inventory.getItems()[barrelSlot];
  const event = {
    player: f.player,
    usedItem: potion,
    usedItemId: potion.getId(),
    usedItemSlot: potionSlot,
    usedWithItem: barrel,
    usedWithItemId: barrel.getId(),
    usedWithItemSlot: barrelSlot,
    handled: false,
  };
  onItemOnItem(event);
  return event;
}

function itemAction(f, itemName, option, slot) {
  const item = f.inventory.getItems()[slot];
  actions.get(itemName)[option]({
    player: f.player,
    item,
    itemId: item.getId(),
    slot,
    clickType: 1,
    handled: false,
  });
}

function seed(player, entries) {
  player.setAttribute(ATTRIBUTE, entries);
}

test("filling sums doses, persists contents and returns a marked empty vessel", (t) => {
  const f = actor(t);
  const I = core.ItemIdentifiers;
  const meta = { preset: true, untradeable: true, unbankable: true };
  put(f, I.PRAYER_POTION_3_, 0, meta);
  put(f, I.CHUGGING_BARREL, 1);
  assert.equal(fill(f, 0, 1).handled, true);
  assert.equal(f.inventory.getItems()[0].getId(), I.VIAL);
  assert.deepEqual(f.inventory.getItems()[0].getMeta(), meta);
  assert.equal(f.player.getAttribute(ATTRIBUTE)["Prayer potion"].doses, 3);
  assert.deepEqual(f.player.getAttribute(ATTRIBUTE)["Prayer potion"].meta, meta);

  put(f, I.PRAYER_POTION_2_, 2);
  fill(f, 2, 1);
  assert.equal(f.player.getAttribute(ATTRIBUTE)["Prayer potion"].doses, 5);
  assert.equal(persistedAttributes.get(ATTRIBUTE), null);
});

test("copied potion chains return their own empty vessel", (t) => {
  const I = core.ItemIdentifiers;
  const copy = { name: "Prayer potion", chain: [990001, 990002], emptyItemId: 990003 };
  Potions._test.registerCopy(copy);
  assert.equal(copy.registered, true);
  assert.equal(Potions.doseOf(copy.chain[0]).emptyItemId, copy.emptyItemId);

  const f = actor(t);
  const originalGetItem = core.CacheDefinitions.getItem.bind(core.CacheDefinitions);
  t.mock.method(core.CacheDefinitions, "getItem", (itemId) => itemId === copy.chain[0]
    ? { name: "Prayer potion(2)" }
    : originalGetItem(itemId));
  put(f, copy.chain[0], 0, { preset: true });
  put(f, I.CHUGGING_BARREL, 1);
  fill(f, 0, 1);
  assert.equal(f.inventory.getItems()[0].getId(), copy.emptyItemId);
  assert.deepEqual(f.inventory.getItems()[0].getMeta(), { preset: true });
});

test("fill refuses area-locked potions, non-potion drinks and Hunting mix", (t) => {
  const I = core.ItemIdentifiers;
  for (const itemId of [
    I.OVERLOAD_1__5,
    I.BEER,
    I.ASGARNIAN_ALE_3,
    I.MOONLIGHT_MEAD,
    I.SLAYERS_RESPITE,
    I.CUP_OF_TEA_9,
    I.HUNTING_MIX_1_,
  ]) {
    assert.ok(Potions.doseOf(itemId), `item ${itemId} is registered as a drink`);
    const f = actor(t);
    put(f, itemId, 0);
    put(f, I.CHUGGING_BARREL, 1);
    fill(f, 0, 1);
    assert.equal(f.inventory.getItems()[0].getId(), itemId);
    assert.equal(f.player.getAttribute(ATTRIBUTE), undefined);
    assert.ok(f.messages.includes("You can't store that in the chugging barrel."));
  }
});

test("fill accepts barbarian mixes and potion drinks with food permission", (t) => {
  const I = core.ItemIdentifiers;
  for (const itemId of [I.PRAYER_MIX_2_, I.SARADOMIN_BREW_4_, I.GUTHIX_REST_4_]) {
    const dose = Potions.doseOf(itemId);
    assert.ok(dose, `potion ${itemId} is registered`);
    const f = actor(t);
    put(f, itemId, 0);
    put(f, I.CHUGGING_BARREL, 1);
    fill(f, 0, 1);
    assert.equal(f.inventory.getItems()[0].getId(), dose.emptyItemId);
    assert.equal(f.player.getAttribute(ATTRIBUTE)[dose.potion.name].doses, dose.doses);
  }
  assert.ok(ChuggingBarrel.dependsOn.includes("LeagueMode"), "the bank proximity event provider is a declared dependency");
});

test("fill enforces the 100-dose cap and five potion types", (t) => {
  const I = core.ItemIdentifiers;
  const capped = actor(t);
  put(capped, I.PRAYER_POTION_4_, 0);
  put(capped, I.CHUGGING_BARREL, 1);
  seed(capped.player, {
    "Prayer potion": { itemId: I.PRAYER_POTION_1_, name: "prayer potion", doses: 99 },
  });
  fill(capped, 0, 1);
  assert.equal(capped.inventory.getItems()[0].getId(), I.PRAYER_POTION_4_);
  assert.equal(capped.player.getAttribute(ATTRIBUTE)["Prayer potion"].doses, 99);
  assert.ok(capped.messages.some((message) => message.includes("doesn't have space")));

  const full = actor(t);
  put(full, I.MAGIC_POTION_4_, 0);
  put(full, I.CHUGGING_BARREL, 1);
  const typeIds = [I.PRAYER_POTION_4_, I.SUPER_RESTORE_4_, I.ENERGY_POTION_4_, I.RANGING_POTION_4_, I.STRENGTH_POTION_4_];
  const entries = Object.fromEntries(typeIds.map((itemId) => {
    const dose = Potions.doseOf(itemId);
    assert.ok(dose, `potion ${itemId} is registered`);
    return [dose.potion.name, { itemId, name: dose.potion.name.toLowerCase(), doses: 1 }];
  }));
  seed(full.player, entries);
  fill(full, 0, 1);
  assert.equal(full.inventory.getItems()[0].getId(), I.MAGIC_POTION_4_);
  assert.equal(Object.keys(full.player.getAttribute(ATTRIBUTE)).length, 5);
  assert.ok(full.messages.includes("You can't store that in the chugging barrel."));
});

test("Drink applies one dose per stored type, emits potion events and starts shared timers", (t) => {
  const f = actor(t);
  const I = core.ItemIdentifiers;
  const prayer = Potions.doseOf(I.PRAYER_POTION_4_);
  const energy = Potions.doseOf(I.ENERGY_POTION_4_);
  const effects = [];
  t.mock.method(prayer.potion, "effect", () => effects.push(prayer.potion.name));
  t.mock.method(energy.potion, "effect", () => effects.push(energy.potion.name));
  const meta = { preset: true };
  seed(f.player, {
    "Prayer potion": { itemId: I.PRAYER_POTION_4_, name: "prayer potion", doses: 3, meta },
    "Energy potion": { itemId: I.ENERGY_POTION_4_, name: "energy potion", doses: 2 },
  });
  put(f, I.CHUGGING_BARREL, 0);

  itemAction(f, BARREL_NAME, "Drink", 0);
  assert.deepEqual(effects, ["Prayer potion", "Energy potion"]);
  assert.equal(f.player.getAttribute(ATTRIBUTE)["Prayer potion"].doses, 2);
  assert.equal(f.player.getAttribute(ATTRIBUTE)["Energy potion"].doses, 1);
  assert.equal(drunkEvents.length, 2);
  assert.deepEqual(drunkEvents[0].meta, meta);
  assert.equal(f.player.getTimers().has(core.TimerKey.POTION), true);
  assert.equal(f.player.getTimers().has(core.TimerKey.FOOD), true);

  itemAction(f, BARREL_NAME, "Drink", 0);
  assert.deepEqual(effects, ["Prayer potion", "Energy potion"], "the potion delay blocks another drink in the same tick");
  assert.equal(f.player.getAttribute(ATTRIBUTE)["Prayer potion"].doses, 2);
});

test("Drink enforces bank, area, food permission, content and stun refusals", (t) => {
  const I = core.ItemIdentifiers;
  const area = actor(t);
  const overload = Potions.doseOf(I.OVERLOAD_1__5);
  let effectCount = 0;
  t.mock.method(overload.potion, "effect", () => effectCount++);
  seed(area.player, { [overload.potion.name]: { itemId: I.OVERLOAD_1__5, name: "overload", doses: 2 } });
  put(area, I.CHUGGING_BARREL, 0);
  itemAction(area, BARREL_NAME, "Drink", 0);
  assert.equal(area.player.getAttribute(ATTRIBUTE)[overload.potion.name].doses, 2);
  assert.equal(effectCount, 0);
  assert.ok(area.messages.some((message) => message.includes("inside the Chambers of Xeric")));

  const lowHealth = actor(t);
  rules.insideCox = true;
  lowHealth.player.getSkillManager()
    .setMaxLevels(core.Skill.HITPOINTS, 99, false)
    .setCurrentLevels(core.Skill.HITPOINTS, 49, false);
  seed(lowHealth.player, { [overload.potion.name]: { itemId: I.OVERLOAD_1__5, name: "overload", doses: 2 } });
  put(lowHealth, I.CHUGGING_BARREL, 0);
  itemAction(lowHealth, BARREL_NAME, "Drink", 0);
  assert.equal(lowHealth.player.getAttribute(ATTRIBUTE)[overload.potion.name].doses, 2);
  assert.ok(lowHealth.messages.includes("You need more than 50 Hitpoints to drink this potion."));

  const food = actor(t);
  rules.canEat = false;
  seed(food.player, { Beer: { itemId: I.BEER, name: "beer", doses: 1 } });
  put(food, I.CHUGGING_BARREL, 0);
  itemAction(food, BARREL_NAME, "Drink", 0);
  assert.equal(food.player.getAttribute(ATTRIBUTE).Beer.doses, 1);
  assert.ok(food.messages.includes("You cannot eat here."));

  const content = actor(t);
  rules.validateDrink = false;
  seed(content.player, { "Prayer potion": { itemId: I.PRAYER_POTION_4_, name: "prayer potion", doses: 1 } });
  put(content, I.CHUGGING_BARREL, 0);
  itemAction(content, BARREL_NAME, "Drink", 0);
  assert.equal(content.player.getAttribute(ATTRIBUTE)["Prayer potion"].doses, 1);
  assert.ok(content.messages.includes("The potion is locked."));

  const blocked = actor(t);
  rules.canDrink = false;
  seed(blocked.player, { "Prayer potion": { itemId: I.PRAYER_POTION_4_, name: "prayer potion", doses: 1 } });
  put(blocked, I.CHUGGING_BARREL, 0);
  itemAction(blocked, BARREL_NAME, "Drink", 0);
  assert.equal(blocked.player.getAttribute(ATTRIBUTE)["Prayer potion"].doses, 1);
  assert.ok(blocked.messages.includes("You cannot use potions here."));

  const stunned = actor(t);
  seed(stunned.player, { "Prayer potion": { itemId: I.PRAYER_POTION_4_, name: "prayer potion", doses: 1 } });
  put(stunned, I.CHUGGING_BARREL, 0);
  stunned.player.getTimers().extendOrRegister(core.TimerKey.STUN, 2);
  itemAction(stunned, BARREL_NAME, "Drink", 0);
  assert.equal(stunned.player.getAttribute(ATTRIBUTE)["Prayer potion"].doses, 1);
  assert.ok(stunned.messages.includes("You're currently stunned and cannot use potions."));

  const away = actor(t);
  rules.nearBank = false;
  seed(away.player, { "Prayer potion": { itemId: I.PRAYER_POTION_4_, name: "prayer potion", doses: 1 } });
  put(away, I.CHUGGING_BARREL, 0);
  itemAction(away, BARREL_NAME, "Drink", 0);
  assert.equal(away.player.getAttribute(ATTRIBUTE)["Prayer potion"].doses, 1);
  assert.ok(away.messages.includes("You must be near a bank to use that barrel."));
});

test("dismantling clears contents on confirmation and ignores a moved barrel", (t) => {
  const I = core.ItemIdentifiers;
  const f = actor(t);
  const barrel = put(f, I.CHUGGING_BARREL, 0);
  seed(f.player, { "Prayer potion": { itemId: I.PRAYER_POTION_4_, name: "prayer potion", doses: 1 } });
  itemAction(f, BARREL_NAME, "Dismantle", 0);
  assert.equal(typeof confirm, "function");
  confirm();
  assert.deepEqual(f.player.getAttribute(ATTRIBUTE), {});
  assert.equal(f.inventory.getItems()[0].getId(), I.CHUGGING_BARREL_DISASSEMBLED_);

  const stale = actor(t);
  const moved = put(stale, I.CHUGGING_BARREL, 0);
  seed(stale.player, { "Prayer potion": { itemId: I.PRAYER_POTION_4_, name: "prayer potion", doses: 1 } });
  itemAction(stale, BARREL_NAME, "Dismantle", 0);
  stale.inventory.setItem(0, new core.Item(I.VIAL));
  stale.inventory.setItem(1, moved);
  confirm();
  assert.equal(stale.player.getAttribute(ATTRIBUTE)["Prayer potion"].doses, 1);
  assert.equal(stale.inventory.getItems()[1].getId(), I.CHUGGING_BARREL);
});
