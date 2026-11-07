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
let interfaceClick;
let widgetDrag;
let onLogout;

function pluginApi() {
  const methods = {
    core,
    persistAttribute(key, initialValue) { persistedAttributes.set(key, initialValue); },
    onItemAction(name, handlers) { actions.set(name, handlers); },
    onItemOnItem(handler) { onItemOnItem = handler; },
    onInterfaceActionClick(handler) { interfaceClick = handler; },
    onCustomEvent(name, handler) { if (name === "player:widget-action") widgetDrag = handler; },
    onPlayerLogout(handler) { onLogout = handler; },
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
  const packets = [];
  const sender = {
    sendInterfaceRemoval() { player.setInterfaceId(-1); return sender; },
    sendInterface(id) { player.setInterfaceId(id); packets.push(["open", id]); return sender; },
    sendInventory(...args) { packets.push(["inventory", ...args]); return sender; },
    sendInterfaceFlagsRange(...args) { packets.push(["flags", ...args]); return sender; },
    sendInterfaceScript(...args) { packets.push(["script", ...args]); return sender; },
    sendEnterAmountPrompt(...args) { packets.push(["prompt", ...args]); return sender; },
  };
  t.mock.method(player, "sendMessage", (message) => messages.push(message));
  t.mock.method(player, "performAnimation", () => {});
  t.mock.method(player, "getPacketSender", () => sender);
  t.mock.method(inventory, "refreshItems", () => inventory);
  return { player, inventory, messages, packets };
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
  assert.equal(balance(f, "Prayer potion").doses, 3);
  assert.deepEqual(balance(f, "Prayer potion").meta, meta);

  put(f, I.PRAYER_POTION_2_, 2, meta);
  fill(f, 2, 1);
  assert.equal(balance(f, "Prayer potion").doses, 5);
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
    assert.equal(balance(f, dose.potion.name).doses, dose.doses);
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
  assert.equal(balance(capped, "Prayer potion").doses, 99);
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
  assert.equal(balance(f, "Prayer potion").doses, 2);
  assert.equal(balance(f, "Energy potion").doses, 1);
  assert.equal(drunkEvents.length, 2);
  assert.deepEqual(drunkEvents[0].meta, meta);
  assert.equal(f.player.getTimers().has(core.TimerKey.POTION), true);
  assert.equal(f.player.getTimers().has(core.TimerKey.FOOD), true);

  itemAction(f, BARREL_NAME, "Drink", 0);
  assert.deepEqual(effects, ["Prayer potion", "Energy potion"], "the potion delay blocks another drink in the same tick");
  assert.equal(balance(f, "Prayer potion").doses, 2);
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
  assert.equal(balance(area, overload.potion.name).doses, 2);
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
  assert.equal(balance(lowHealth, overload.potion.name).doses, 2);
  assert.ok(lowHealth.messages.includes("You need more than 50 Hitpoints to drink this potion."));

  const food = actor(t);
  rules.canEat = false;
  seed(food.player, { Beer: { itemId: I.BEER, name: "beer", doses: 1 } });
  put(food, I.CHUGGING_BARREL, 0);
  itemAction(food, BARREL_NAME, "Drink", 0);
  assert.equal(balance(food, "Beer").doses, 1);
  assert.ok(food.messages.includes("You cannot eat here."));

  const content = actor(t);
  rules.validateDrink = false;
  seed(content.player, { "Prayer potion": { itemId: I.PRAYER_POTION_4_, name: "prayer potion", doses: 1 } });
  put(content, I.CHUGGING_BARREL, 0);
  itemAction(content, BARREL_NAME, "Drink", 0);
  assert.equal(balance(content, "Prayer potion").doses, 1);
  assert.ok(content.messages.includes("The potion is locked."));

  const blocked = actor(t);
  rules.canDrink = false;
  seed(blocked.player, { "Prayer potion": { itemId: I.PRAYER_POTION_4_, name: "prayer potion", doses: 1 } });
  put(blocked, I.CHUGGING_BARREL, 0);
  itemAction(blocked, BARREL_NAME, "Drink", 0);
  assert.equal(balance(blocked, "Prayer potion").doses, 1);
  assert.ok(blocked.messages.includes("You cannot use potions here."));

  const stunned = actor(t);
  seed(stunned.player, { "Prayer potion": { itemId: I.PRAYER_POTION_4_, name: "prayer potion", doses: 1 } });
  put(stunned, I.CHUGGING_BARREL, 0);
  stunned.player.getTimers().extendOrRegister(core.TimerKey.STUN, 2);
  itemAction(stunned, BARREL_NAME, "Drink", 0);
  assert.equal(balance(stunned, "Prayer potion").doses, 1);
  assert.ok(stunned.messages.includes("You're currently stunned and cannot use potions."));

  const away = actor(t);
  rules.nearBank = false;
  seed(away.player, { "Prayer potion": { itemId: I.PRAYER_POTION_4_, name: "prayer potion", doses: 1 } });
  put(away, I.CHUGGING_BARREL, 0);
  itemAction(away, BARREL_NAME, "Drink", 0);
  assert.equal(balance(away, "Prayer potion").doses, 1);
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
  assert.equal(balance(stale, "Prayer potion").doses, 1);
  assert.equal(stale.inventory.getItems()[1].getId(), I.CHUGGING_BARREL);
});


const CONTENTS_WIDGET = (886 << 16) | 7;
const INVENTORY_WIDGET = (886 << 16) | 12;

function ui(f, widget, slot, itemId, action) {
  const event = { player: f.player, buttonId: widget, slot, itemId, action, handled: false };
  interfaceClick(event);
  assert.equal(event.handled, true);
}

function openBarrel(f) {
  put(f, core.ItemIdentifiers.CHUGGING_BARREL, 27);
  itemAction(f, BARREL_NAME, "Open", 27);
}

function balance(f, name) {
  return Object.values(f.player.getAttribute(ATTRIBUTE) ?? {}).find((store) =>
    Potions.doseOf(store.itemId)?.potion.name === name);
}

function storedDoses(f, name = "Prayer potion") {
  return balance(f, name)?.doses ?? 0;
}

function inventoryDoses(f, potion) {
  return f.inventory.getItems().reduce((sum, item) => {
    const dose = Potions.doseOf(item.getId());
    return sum + (dose?.potion.name === potion ? dose.doses * item.getAmount() : 0);
  }, 0);
}

test("Open sends native 886/7338/911 and preserves old excess balances", (t) => {
  const f = actor(t), I = core.ItemIdentifiers;
  seed(f.player, { "Prayer potion": { itemId: I.PRAYER_POTION_4_, name: "prayer potion", doses: 130 } });
  openBarrel(f);
  assert.deepEqual(f.packets.find((p) => p[0] === "open"), ["open", 886]);
  assert.deepEqual(f.packets.find((p) => p[0] === "script"), ["script", 7338, [30000]]);
  const packet = f.packets.find((p) => p[0] === "inventory");
  assert.equal(packet[1], 911);
  assert.equal(packet[2], 5);
  assert.deepEqual(packet[3][0], { id: I.PRAYER_POTION_1_, amount: 130 });
  assert.equal(packet[4], 886);
  assert.equal(storedDoses(f), 130);
  ui(f, CONTENTS_WIDGET, 0, I.PRAYER_POTION_4_, 2);
  assert.equal(storedDoses(f), 129);
  put(f, I.PRAYER_POTION_4_, 5);
  ui(f, INVENTORY_WIDGET, 5, I.PRAYER_POTION_4_, 5);
  assert.equal(storedDoses(f), 129, "legacy excess is withdrawable, never truncated or increased");
});

test("Store counts vials; Fill counts doses and keeps a partial marked vial", (t) => {
  const f = actor(t), I = core.ItemIdentifiers;
  put(f, I.PRAYER_POTION_4_, 0);
  put(f, I.PRAYER_POTION_4_, 1);
  openBarrel(f);
  ui(f, INVENTORY_WIDGET, 1, I.PRAYER_POTION_4_, 3);
  assert.equal(storedDoses(f), 8);
  assert.equal(inventoryDoses(f, "Prayer potion"), 0);
  put(f, I.PRAYER_POTION_4_, 2);
  ui(f, INVENTORY_WIDGET, 2, I.PRAYER_POTION_4_, 5);
  assert.equal(storedDoses(f), 9);
  assert.equal(f.inventory.getItems()[2].getId(), I.PRAYER_POTION_3_);
  ui(f, CONTENTS_WIDGET, 0, I.PRAYER_POTION_4_, 6);
  assert.equal(storedDoses(f), 12, "Fill-5 takes only the three available doses");
  assert.equal(inventoryDoses(f, "Prayer potion"), 0);
  put(f, I.PRAYER_POTION_4_, 3, { preset: true });
  ui(f, INVENTORY_WIDGET, 3, I.PRAYER_POTION_4_, 1);
  assert.equal(storedDoses(f), 12, "incompatible markings cannot overwrite an existing balance");
  assert.equal(f.inventory.getItems()[3].getId(), I.PRAYER_POTION_4_);
});

test("Fill caps at 100 without losing the input remainder; Store rejects an overfull vial", (t) => {
  const f = actor(t), I = core.ItemIdentifiers;
  seed(f.player, { "Prayer potion": { itemId: I.PRAYER_POTION_4_, name: "prayer potion", doses: 99 } });
  put(f, I.PRAYER_POTION_4_, 0);
  openBarrel(f);
  ui(f, INVENTORY_WIDGET, 0, I.PRAYER_POTION_4_, 1);
  assert.equal(storedDoses(f), 99);
  assert.equal(inventoryDoses(f, "Prayer potion"), 4);
  ui(f, INVENTORY_WIDGET, 0, I.PRAYER_POTION_4_, 7);
  assert.equal(storedDoses(f), 100);
  assert.equal(f.inventory.getItems()[0].getId(), I.PRAYER_POTION_3_);
  assert.equal(storedDoses(f) + inventoryDoses(f, "Prayer potion"), 103);
});

test("native quantities include Store-5/X, Fill-X and Withdraw max/1/All/X", (t) => {
  const f = actor(t), I = core.ItemIdentifiers;
  for (let slot = 0; slot < 7; slot++) put(f, I.PRAYER_POTION_4_, slot);
  openBarrel(f);
  ui(f, INVENTORY_WIDGET, 6, I.PRAYER_POTION_4_, 2);
  assert.equal(storedDoses(f), 20);
  ui(f, INVENTORY_WIDGET, 6, I.PRAYER_POTION_4_, 4);
  assert.deepEqual(f.packets.at(-1), ["prompt", "Enter amount:"]);
  f.player.getEnteredAmountAction().execute(1);
  assert.equal(storedDoses(f), 24);
  ui(f, INVENTORY_WIDGET, 6, I.PRAYER_POTION_4_, 8);
  assert.deepEqual(f.packets.at(-1), ["prompt", "Enter amount of doses:"]);
  f.player.getEnteredAmountAction().execute(2);
  assert.equal(storedDoses(f), 26);
  assert.equal(f.inventory.getItems()[6].getId(), I.PRAYER_POTION_2_);
  ui(f, CONTENTS_WIDGET, 0, I.PRAYER_POTION_4_, 1);
  assert.equal(storedDoses(f), 22);
  assert.equal(inventoryDoses(f, "Prayer potion"), 6);
  ui(f, CONTENTS_WIDGET, 0, I.PRAYER_POTION_4_, 4);
  f.player.getEnteredAmountAction().execute(5);
  assert.equal(storedDoses(f), 17);
  assert.equal(inventoryDoses(f, "Prayer potion"), 11);
  ui(f, CONTENTS_WIDGET, 0, I.PRAYER_POTION_4_, 3);
  assert.equal(storedDoses(f), 0);
  assert.equal(inventoryDoses(f, "Prayer potion"), 28);
});

test("withdraw decants into partial vials before empty slots and rolls back when full", (t) => {
  const f = actor(t), I = core.ItemIdentifiers;
  seed(f.player, { "Prayer potion": { itemId: I.PRAYER_POTION_4_, name: "prayer potion", doses: 9 } });
  for (let slot = 0; slot < 27; slot++) put(f, I.COINS, slot);
  put(f, I.PRAYER_POTION_3_, 8);
  openBarrel(f);
  ui(f, CONTENTS_WIDGET, 0, I.PRAYER_POTION_4_, 3);
  assert.equal(storedDoses(f), 8);
  assert.equal(f.inventory.getItems()[8].getId(), I.PRAYER_POTION_4_);
  const before = f.inventory.getItems().map((item) => [item.getId(), item.getAmount()]);
  ui(f, CONTENTS_WIDGET, 0, I.PRAYER_POTION_4_, 2);
  assert.equal(storedDoses(f), 8);
  assert.deepEqual(f.inventory.getItems().map((item) => [item.getId(), item.getAmount()]), before);
  assert.ok(f.messages.some((m) => m.includes("don't have space")));
});

test("sparse slots persist, swaps change Drink order and empty-slot insertion does not compact", (t) => {
  const f = actor(t), I = core.ItemIdentifiers;
  seed(f.player, {
    "Prayer potion": { itemId: I.PRAYER_POTION_4_, name: "prayer potion", doses: 2, slot: 0 },
    "Energy potion": { itemId: I.ENERGY_POTION_4_, name: "energy potion", doses: 2, slot: 3 },
  });
  openBarrel(f);
  widgetDrag({ player: f.player, packet: { type: "widget_drag", sourceWidgetId: CONTENTS_WIDGET,
    targetWidgetId: CONTENTS_WIDGET, sourceSlot: 0, targetSlot: 3,
    sourceItemId: I.PRAYER_POTION_2_, targetItemId: I.ENERGY_POTION_2_ } });
  const saved = JSON.parse(JSON.stringify(f.player.getAttribute(ATTRIBUTE)));
  assert.equal(saved[String(I.PRAYER_POTION_1_)].slot, 3);
  assert.equal(saved[String(I.ENERGY_POTION_1_)].slot, 0);
  onLogout({ player: f.player });
  seed(f.player, saved);
  itemAction(f, BARREL_NAME, "Open", 27);
  const effects = [];
  t.mock.method(Potions.doseOf(I.PRAYER_POTION_4_).potion, "effect", () => effects.push("prayer"));
  t.mock.method(Potions.doseOf(I.ENERGY_POTION_4_).potion, "effect", () => effects.push("energy"));
  itemAction(f, BARREL_NAME, "Drink", 27);
  assert.deepEqual(effects, ["energy", "prayer"]);
  ui(f, CONTENTS_WIDGET, 0, I.ENERGY_POTION_1_, 3);
  assert.equal(balance(f, "Prayer potion").slot, 3);
  put(f, I.STRENGTH_POTION_4_, 4);
  ui(f, INVENTORY_WIDGET, 4, I.STRENGTH_POTION_4_, 1);
  assert.equal(balance(f, "Strength potion").slot, 0);
});

test("inventory drag swaps references once and forged/stale clicks or prompts cannot transfer", (t) => {
  const f = actor(t), I = core.ItemIdentifiers;
  const a = put(f, I.PRAYER_POTION_4_, 0), b = put(f, I.ENERGY_POTION_4_, 1);
  openBarrel(f);
  widgetDrag({ player: f.player, packet: { type: "widget_drag", sourceWidgetId: INVENTORY_WIDGET,
    targetWidgetId: INVENTORY_WIDGET, sourceSlot: 0, targetSlot: 1, sourceItemId: a.getId(), targetItemId: b.getId() } });
  assert.equal(f.inventory.getItems()[0], b);
  assert.equal(f.inventory.getItems()[1], a);
  ui(f, INVENTORY_WIDGET, 1, I.ENERGY_POTION_4_, 1);
  assert.equal(storedDoses(f), 0);
  ui(f, INVENTORY_WIDGET, 1, I.PRAYER_POTION_4_, 4);
  const prompt = f.player.getEnteredAmountAction();
  f.player.setInterfaceId(-1);
  prompt.execute(1);
  assert.equal(storedDoses(f), 0);
  itemAction(f, BARREL_NAME, "Open", 27);
  ui(f, INVENTORY_WIDGET, 1, I.PRAYER_POTION_4_, 8);
  const pending = f.player.getEnteredAmountAction();
  onLogout({ player: f.player });
  pending.execute(1);
  assert.equal(storedDoses(f), 0);
});

test("mix withdrawal uses two-dose vials and Open refuses a stale barrel or distant bank", (t) => {
  const f = actor(t), I = core.ItemIdentifiers;
  seed(f.player, { "Prayer mix": { itemId: I.PRAYER_MIX_2_, name: "prayer mix", doses: 5 } });
  openBarrel(f);
  ui(f, CONTENTS_WIDGET, 0, I.PRAYER_MIX_2_, 1);
  assert.equal(storedDoses(f, "Prayer mix"), 3);
  assert.equal(f.inventory.getItems()[0].getId(), I.PRAYER_MIX_2_);
  ui(f, CONTENTS_WIDGET, 0, I.PRAYER_MIX_2_, 3);
  assert.equal(inventoryDoses(f, "Prayer mix"), 5);
  const away = actor(t);
  put(away, I.CHUGGING_BARREL, 27);
  rules.nearBank = false;
  itemAction(away, BARREL_NAME, "Open", 27);
  assert.equal(away.packets.length, 0);
  assert.ok(away.messages.includes("You must be near a bank to use that barrel."));
});


test("normal and blighted potion chains remain separate across native controls and legacy fill", (t) => {
  const I = core.ItemIdentifiers, f = actor(t);
  seed(f.player, { "Super restore": { itemId: I.SUPER_RESTORE_4_, name: "super restore", doses: 4 } });
  put(f, I.BLIGHTED_SUPER_RESTORE_3_, 0);
  openBarrel(f);
  ui(f, CONTENTS_WIDGET, 0, I.SUPER_RESTORE_4_, 2);
  assert.equal(f.inventory.getItems()[0].getId(), I.BLIGHTED_SUPER_RESTORE_3_,
    "withdrawing normal doses cannot convert a blighted partial vial");
  assert.equal(f.inventory.getItems()[1].getId(), I.SUPER_RESTORE_1_);
  ui(f, CONTENTS_WIDGET, 0, I.SUPER_RESTORE_3_, 7);
  const normal = String(I.SUPER_RESTORE_1_), blighted = String(I.BLIGHTED_SUPER_RESTORE_1_);
  assert.equal(f.player.getAttribute(ATTRIBUTE)[normal].doses, 4, "Fill consumes only the ordinary one-dose vial");
  assert.equal(f.inventory.getItems()[0].getId(), I.BLIGHTED_SUPER_RESTORE_3_);
  ui(f, INVENTORY_WIDGET, 0, I.BLIGHTED_SUPER_RESTORE_3_, 1);
  assert.equal(f.player.getAttribute(ATTRIBUTE)[normal].doses, 4);
  assert.equal(f.player.getAttribute(ATTRIBUTE)[blighted].doses, 3);
  put(f, I.BLIGHTED_SUPER_RESTORE_4_, 4);
  fill(f, 4, 27);
  assert.equal(f.player.getAttribute(ATTRIBUTE)[blighted].doses, 7);
  assert.equal(f.player.getAttribute(ATTRIBUTE)[normal].doses, 4);
  ui(f, CONTENTS_WIDGET, 1, I.BLIGHTED_SUPER_RESTORE_4_, 3);
  assert.equal(f.inventory.getItems().filter((item) => item.getId() === I.SUPER_RESTORE_4_).length, 0);
  assert.equal(inventoryDoses(f, "Super restore"), 7);
});

test("Fill never merges a restricted source into an ordinary legacy balance", (t) => {
  const I = core.ItemIdentifiers, f = actor(t);
  seed(f.player, { "Super restore": { itemId: I.SUPER_RESTORE_4_, name: "super restore", doses: 1 } });
  put(f, I.BLIGHTED_SUPER_RESTORE_4_, 0);
  openBarrel(f);
  ui(f, CONTENTS_WIDGET, 0, I.SUPER_RESTORE_1_, 7);
  assert.equal(storedDoses(f, "Super restore"), 1);
  assert.equal(f.inventory.getItems()[0].getId(), I.BLIGHTED_SUPER_RESTORE_4_);
});

test("item-on-barrel preserves metadata and a legacy restricted balance during migration", (t) => {
  const I = core.ItemIdentifiers, f = actor(t);
  const meta = { preset: true, unbankable: true };
  seed(f.player, { "Super restore": { itemId: I.BLIGHTED_SUPER_RESTORE_4_, name: "super restore", doses: 130, meta, slot: 3 } });
  put(f, I.SUPER_RESTORE_4_, 0);
  put(f, I.BLIGHTED_SUPER_RESTORE_4_, 1);
  put(f, I.CHUGGING_BARREL, 27);
  fill(f, 0, 27);
  const restricted = f.player.getAttribute(ATTRIBUTE)[String(I.BLIGHTED_SUPER_RESTORE_1_)];
  assert.equal(restricted.doses, 130);
  assert.deepEqual(restricted.meta, meta);
  assert.equal(restricted.slot, 3);
  assert.equal(f.player.getAttribute(ATTRIBUTE)[String(I.SUPER_RESTORE_1_)].doses, 4);
  fill(f, 1, 27);
  assert.equal(restricted.doses, 130);
  assert.equal(f.inventory.getItems()[1].getId(), I.BLIGHTED_SUPER_RESTORE_4_);
});


test("legacy name-key insertion order survives canonical numeric keys and later reopen", (t) => {
  const f = actor(t), I = core.ItemIdentifiers;
  seed(f.player, {
    "Energy potion": { itemId: I.ENERGY_POTION_4_, name: "energy potion", doses: 2 },
    "Prayer potion": { itemId: I.PRAYER_POTION_4_, name: "prayer potion", doses: 2 },
  });
  openBarrel(f);
  const saved = JSON.parse(JSON.stringify(f.player.getAttribute(ATTRIBUTE)));
  assert.equal(saved[String(I.ENERGY_POTION_1_)].slot, 0);
  assert.equal(saved[String(I.PRAYER_POTION_1_)].slot, 1);
  onLogout({ player: f.player });
  seed(f.player, saved);
  itemAction(f, BARREL_NAME, "Open", 27);
  const effects = [];
  t.mock.method(Potions.doseOf(I.ENERGY_POTION_4_).potion, "effect", () => effects.push("energy"));
  t.mock.method(Potions.doseOf(I.PRAYER_POTION_4_).potion, "effect", () => effects.push("prayer"));
  itemAction(f, BARREL_NAME, "Drink", 27);
  assert.deepEqual(effects, ["energy", "prayer"]);
});
