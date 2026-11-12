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
const AUTO_SMASH_VIALS = 5668;
let smashVials = 0;
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
  let chatbox = -1;
  const sender = new Proxy({
    sendInterfaceRemoval() { player.setInterfaceId(-1); chatbox = -1; return sender; },
    sendChatboxInterface(id) { chatbox = id; packets.push(["chatbox", id]); return sender; },
    isChatboxInterface: (id) => chatbox === id,
    sendClientScript(...args) { packets.push(["clientscript", ...args]); return sender; },
    sendSoundEffect() { return sender; },
    sendInterface(id) { player.setInterfaceId(id); packets.push(["open", id]); return sender; },
    sendInventory(...args) { packets.push(["inventory", ...args]); return sender; },
    sendInterfaceFlagsRange(...args) { packets.push(["flags", ...args]); return sender; },
    sendInterfaceScript(...args) { packets.push(["script", ...args]); return sender; },
    sendEnterAmountPrompt(...args) { packets.push(["prompt", ...args]); return sender; },
    // Examine price info: both settings on; barbarian vial smashing (5668) as the test sets it.
    getVarbit: (id) => (id === AUTO_SMASH_VIALS ? smashVials : 1),
    // Spam and mesbox lines land in `messages` marked, so a test sees the type live sends.
    sendTypedMessage(type, message) {
      messages.push(type === core.ChatType.SPAM ? `spam: ${message}` : type === core.ChatType.MESBOX ? `mesbox: ${message}` : message);
      return sender;
    },
  }, { get: (target, key) => (key in target ? target[key] : () => sender) });
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

test("with vial smashing on, storing a potion's last dose leaves no vial (rsprox 238/04236)", (t) => {
  smashVials = 1;
  t.after(() => { smashVials = 0; });
  const f = actor(t);
  const I = core.ItemIdentifiers;
  put(f, I.PRAYER_POTION_3_, 0);
  put(f, I.CHUGGING_BARREL, 1);
  assert.equal(fill(f, 0, 1).handled, true);
  assert.equal(f.inventory.getItems()[0]?.getId?.() ?? -1, -1, "the vial is smashed");
  assert.equal(balance(f, "Prayer potion").doses, 3);
  // The open barrel's store (op 1 on an inventory potion, as captured: prepot_device:inventory_contents).
  openBarrel(f);
  put(f, I.PRAYER_POTION_2_, 4);
  ui(f, INVENTORY_WIDGET, 4, I.PRAYER_POTION_2_, 1);
  assert.equal(f.inventory.getItems()[4]?.getId?.() ?? -1, -1, "stored from the barrel's screen, the vial is smashed too");
  assert.equal(balance(f, "Prayer potion").doses, 5);
});

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
  // A sixth kind gets the full line with the potion's own name (rsprox 238/04236.txt:44376-44391).
  assert.ok(full.messages.includes("Your chugging barrel doesn't have space to store any more Magic potion(4)."), full.messages.join(" | "));
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

test("Drink skips only the refused potion and plays the barrel sound once (rsprox 4242)", (t) => {
  const f = actor(t);
  const I = core.ItemIdentifiers;
  const prayer = Potions.doseOf(I.PRAYER_POTION_4_);
  const divine = Potions.doseOf(I.DIVINE_SUPER_COMBAT_POTION_4_);
  const energy = Potions.doseOf(I.ENERGY_POTION_4_);
  const effects = [];
  for (const dose of [prayer, divine, energy]) {
    t.mock.method(dose.potion, "effect", () => effects.push(dose.potion.name));
  }
  const sounds = [];
  t.mock.method(core.Sounds, "sendSound", (_player, sound) => sounds.push([sound.getId(), sound.getDelay()]));
  f.player.getSkillManager()
    .setMaxLevels(core.Skill.HITPOINTS, 99, false)
    .setCurrentLevels(core.Skill.HITPOINTS, 10, false);
  seed(f.player, {
    "Prayer potion": { itemId: I.PRAYER_POTION_4_, name: "prayer potion", doses: 3 },
    [divine.potion.name]: { itemId: I.DIVINE_SUPER_COMBAT_POTION_4_, name: "divine super combat potion", doses: 2 },
    "Energy potion": { itemId: I.ENERGY_POTION_4_, name: "energy potion", doses: 2 },
  });
  put(f, I.CHUGGING_BARREL, 0);

  itemAction(f, BARREL_NAME, "Drink", 0);
  assert.deepEqual(effects, ["Prayer potion", "Energy potion"], "the refused divine potion is skipped, the rest drink");
  // rsprox 238/04242.txt:61023-61030: the drink lines are spam, the divine refusal a game message.
  assert.deepEqual(f.messages, [
    "spam: You drink some of your prayer potion.",
    "You need more than 10 hitpoints to survive the power of a divine potion.",
    "spam: You drink some of your energy potion.",
  ]);
  assert.equal(balance(f, "Prayer potion").doses, 2);
  assert.equal(balance(f, divine.potion.name).doses, 2, "a refused potion keeps its dose");
  assert.equal(balance(f, "Energy potion").doses, 1);
  assert.equal(drunkEvents.length, 2);
  assert.deepEqual(sounds, [[9491, 30]]);
});

test("Drink tells each refused divine potion's reason, one per potion (rsprox 4242)", (t) => {
  const I = core.ItemIdentifiers;
  const f = actor(t);
  const combat = Potions.doseOf(I.DIVINE_SUPER_COMBAT_POTION_4_);
  const ranging = Potions.doseOf(I.DIVINE_RANGING_POTION_4_);
  f.player.getSkillManager()
    .setMaxLevels(core.Skill.HITPOINTS, 99, false)
    .setCurrentLevels(core.Skill.HITPOINTS, 10, false);
  seed(f.player, {
    combat: { itemId: I.DIVINE_SUPER_COMBAT_POTION_4_, name: "divine super combat potion", doses: 2, slot: 0 },
    ranging: { itemId: I.DIVINE_RANGING_POTION_4_, name: "divine ranging potion", doses: 2, slot: 1 },
  });
  put(f, I.CHUGGING_BARREL, 0);
  itemAction(f, BARREL_NAME, "Drink", 0);
  assert.ok(combat && ranging);
  const reason = "You need more than 10 hitpoints to survive the power of a divine potion.";
  assert.deepEqual(f.messages.filter((m) => m === reason).length, 2);
  assert.equal(balance(f, combat.potion.name).doses, 2);
  assert.equal(balance(f, ranging.potion.name).doses, 2);
  assert.equal(drunkEvents.length, 0);
});

test("Drink tells a player-wide refusal once, not once per potion", (t) => {
  const I = core.ItemIdentifiers;
  const f = actor(t);
  rules.canDrink = false;
  seed(f.player, {
    prayer: { itemId: I.PRAYER_POTION_3_, name: "prayer potion", doses: 3, slot: 0 },
    energy: { itemId: I.ENERGY_POTION_3_, name: "energy potion", doses: 2, slot: 1 },
  });
  put(f, I.CHUGGING_BARREL, 0);
  itemAction(f, BARREL_NAME, "Drink", 0);
  assert.equal(f.messages.filter((message) => message === "You cannot use potions here.").length, 1);
  assert.equal(drunkEvents.length, 0);
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

// rsprox 238/04236.txt ticks 5395-5403: objectbox warning, then confirmdestroy (584, script 814);
// ticks 98 and 339: assemble and disassemble are objectbox_double boxes, one form to the other.
const box = (f) => {
  const current = f.player.getDialogueManager().getCurrent();
  return [current?.getItemIds?.() ?? [current?.getItemId?.()], current?.getText?.()];
};
const confirmScreen = (f, action) => ChuggingBarrel._test.confirmDismantle({ player: f.player, action });

test("assembling and disassembling show the recorded two-item boxes", (t) => {
  const I = core.ItemIdentifiers;
  const f = actor(t);
  put(f, I.CHUGGING_BARREL_DISASSEMBLED_, 0);
  itemAction(f, "Chugging barrel (disassembled)", "Assemble", 0);
  assert.deepEqual(box(f), [[I.CHUGGING_BARREL_DISASSEMBLED_, I.CHUGGING_BARREL], "You assemble the Chugging barrel."]);
  itemAction(f, BARREL_NAME, "Dismantle", 0);
  assert.equal(f.inventory.getItems()[0].getId(), I.CHUGGING_BARREL_DISASSEMBLED_, "an empty barrel needs no confirm");
  assert.deepEqual(box(f), [[I.CHUGGING_BARREL, I.CHUGGING_BARREL_DISASSEMBLED_], "You disassemble the Chugging barrel."]);
  // Each box's mesbox chat line goes with it (238/04236.txt ticks 98, 339).
  assert.deepEqual(f.messages, ["mesbox: You assemble the Chugging barrel.", "mesbox: You disassemble the Chugging barrel."]);
});

test("dismantling a barrel with potions warns, asks on the confirm screen, and only Yes clears it", (t) => {
  const I = core.ItemIdentifiers;
  const f = actor(t);
  put(f, I.CHUGGING_BARREL, 0);
  seed(f.player, { "Prayer potion": { itemId: I.PRAYER_POTION_4_, name: "prayer potion", doses: 1 } });
  itemAction(f, BARREL_NAME, "Dismantle", 0);
  // Wrapped as sent (238/04236.txt line 51250); its mesbox chat line has the breaks as spaces (tick 5395).
  assert.deepEqual(box(f), [[I.CHUGGING_BARREL], "Your barrel contains potions.<br>If you disassemble it without emptying it first, they'll be<br>lost."]);
  assert.deepEqual(f.messages, ["mesbox: Your barrel contains potions. If you disassemble it without emptying it first, they'll be lost."]);
  f.player.getDialogueManager().advance();
  assert.deepEqual(f.packets.filter((p) => p[0] === "chatbox" || p[0] === "clientscript").slice(-2), [
    ["chatbox", 584],
    ["clientscript", 814, I.CHUGGING_BARREL, 1, "Are you sure you want to disassemble the barrel?", "The potions stored will be lost."],
  ]);
  assert.equal(confirmScreen(f, 0), true, "No");
  assert.equal(balance(f, "Prayer potion").doses, 1, "No keeps the potions");
  assert.equal(f.inventory.getItems()[0].getId(), I.CHUGGING_BARREL);

  itemAction(f, BARREL_NAME, "Dismantle", 0);
  f.player.getDialogueManager().advance();
  assert.equal(confirmScreen(f, 1), true, "Yes");
  assert.deepEqual(f.player.getAttribute(ATTRIBUTE), {});
  assert.equal(f.inventory.getItems()[0].getId(), I.CHUGGING_BARREL_DISASSEMBLED_);

  const stale = actor(t);
  const moved = put(stale, I.CHUGGING_BARREL, 0);
  seed(stale.player, { "Prayer potion": { itemId: I.PRAYER_POTION_4_, name: "prayer potion", doses: 1 } });
  itemAction(stale, BARREL_NAME, "Dismantle", 0);
  stale.player.getDialogueManager().advance();
  stale.inventory.setItem(0, new core.Item(I.VIAL));
  stale.inventory.setItem(1, moved);
  confirmScreen(stale, 1);
  assert.equal(balance(stale, "Prayer potion").doses, 1, "a moved barrel is not dismantled");
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

test("Examine (op 10): a contents row is priced as the stored doses of its 1-dose form; an inventory potion as one", (t) => {
  const f = actor(t), I = core.ItemIdentifiers;
  const examine = (id) => core.ItemDefinition.forId(id).getExamine();
  seed(f.player, { "Prayer potion": { itemId: I.PRAYER_POTION_4_, name: "prayer potion", doses: 130 } });
  openBarrel(f);
  f.messages.length = 0;
  ui(f, CONTENTS_WIDGET, 0, I.PRAYER_POTION_4_, 10);
  assert.equal(f.messages.length, 2, f.messages.join(" | "));
  assert.equal(f.messages[0], examine(I.PRAYER_POTION_1_));
  assert.match(f.messages[1], /^Price of 130 x Prayer potion\(1\): /);
  assert.equal(storedDoses(f), 130, "examining withdraws nothing");
  f.messages.length = 0;
  put(f, I.PRAYER_POTION_4_, 5);
  ui(f, INVENTORY_WIDGET, 5, I.PRAYER_POTION_4_, 10);
  assert.equal(f.messages.length, 2, f.messages.join(" | "));
  assert.equal(f.messages[0], examine(I.PRAYER_POTION_4_));
  assert.match(f.messages[1], /^Price of Prayer potion\(4\): /);
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

test("a destroy prompt left open or walked away from never takes the barrel's Yes (real PacketSender)", () => {
  const I = core.ItemIdentifiers;
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const DestroyItem = require("../plugins/interface/DestroyItem.plugin");
  // DestroyItem registers on the shared confirm button (584) ahead of the barrel, as in production.
  let dropPolicy, destroyConfirm;
  const destroyed = [];
  DestroyItem.register(new Proxy({
    core,
    onItemDropPolicy: (handler) => { dropPolicy = handler; },
    onInterfaceActionButton: (_button, handler) => { destroyConfirm = handler; },
    emitCustomEvent: (name, event) => { if (name === "destroy-item:destroyed") destroyed.push(event.itemId); },
  }, { get: (target, key) => (key in target ? target[key] : () => {}) }));
  const yes = (player) => destroyConfirm({ player, action: 1 }) === false && ChuggingBarrel._test.confirmDismantle({ player, action: 1 });

  for (const leave of ["walk-away", "still-open"]) {
    const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
    const player = new Player(new PlayerSession(channel), new core.Location(3200, 3200, 0));
    player.setIndex(1801);
    player.getSession().sendClientPacket = () => true;
    const inventory = player.getInventory();
    inventory.setItem(0, new core.Item(I.CHUGGING_BARREL, 1));
    const keep = new core.Item(I.FIRE_CAPE, 1, { [core.Item.UNTRADEABLE_META]: true });
    inventory.setItem(1, keep);
    seed(player, { "Prayer potion": { itemId: I.PRAYER_POTION_4_, name: "prayer potion", doses: 1 } });

    // The cape's Drop opens DestroyItem's 584 prompt, armed for the cape.
    const drop = { player, item: keep, itemId: keep.getId(), slot: 1, interfaceId: 149, handled: false };
    dropPolicy(drop);
    assert.equal(drop.handled, true);
    assert.equal(player.getAttribute("destroy-item:pending"), keep.getId(), `${leave}: the destroy prompt is armed`);
    if (leave === "walk-away") player.getPacketSender().sendInterfaceRemoval();

    actions.get(BARREL_NAME).Dismantle({ player, item: inventory.getItems()[0], itemId: I.CHUGGING_BARREL, slot: 0, clickType: 1, handled: false });
    player.getDialogueManager().advance();
    assert.equal(player.getPacketSender().isChatboxInterface(584), true, `${leave}: the barrel's confirm is up`);
    assert.notEqual(player.getAttribute("destroy-item:pending"), keep.getId(), `${leave}: the stale destroy is disarmed`);
    assert.equal(yes(player), true, `${leave}: Yes answers the barrel`);
    assert.equal(inventory.getItems()[1], keep, `${leave}: the cape is kept`);
    assert.deepEqual(destroyed, [], `${leave}: nothing is destroyed`);
    assert.equal(inventory.getItems()[0].getId(), I.CHUGGING_BARREL_DISASSEMBLED_, `${leave}: the barrel is dismantled`);
  }
});
