// Run after `yarn build`: node --test tests/rune-pouch.test.cjs
// Checks the pouch against the rsprox captures in docs/rune-pouch.md, with the real cache.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Item } = require("../dist/game/model/Item");
const { ItemIdentifiers: Items } = require("../dist/util/ItemIdentifiers");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CombatSpells } = require("../dist/game/content/combat/magic/CombatSpells");
const { MagicSpellbook } = require("../dist/game/model/MagicSpellbook");
const { PlayerStatus } = require("../dist/game/model/PlayerStatus");
const { Bank } = require("../dist/game/model/container/impl/Bank");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");

const RunePouch = require("../plugins/items/RunePouch.plugin");
const Pouch = require("../plugins/items/runepouch/Common.RunePouch");
const Loadouts = require("../plugins/items/runepouch/Loadouts.RunePouch");

before(async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  // The real plugin through the real PluginManager, so its hooks and the spell rune source dispatch.
  RunePouch.register(PluginManager.createApi("RunePouchTest"));
});

const varbit = (name) => CacheDefinitions.getVarbitId(name);
const component = (name) => CacheDefinitions.getComponentId(name);

function createContainer(capacity, initial = []) {
  const items = initial;
  const container = {
    getItems: () => items,
    getValidItems: () => items.filter((item) => item.getId() > 0 && item.getAmount() > 0),
    getAmount: (id) => items.filter((item) => item.getId() === id).reduce((total, item) => total + item.getAmount(), 0),
    contains: (id) => items.some((item) => item.getId() === id && item.getAmount() > 0),
    getFreeSlots: () => capacity - container.getValidItems().length,
    add(item) {
      const stack = items.find((entry) => entry.getId() === item.getId());
      if (stack && item.getDefinition().isStackable()) stack.setAmount(stack.getAmount() + item.getAmount());
      else if (container.getFreeSlots() > 0) items.push(item.clone());
      return container;
    },
    deleteNumber(id, amount) {
      let left = amount;
      for (const item of [...items]) {
        if (left <= 0 || item.getId() !== id) continue;
        const taken = Math.min(left, item.getAmount());
        item.setAmount(item.getAmount() - taken);
        left -= taken;
        if (item.getAmount() <= 0) items.splice(items.indexOf(item), 1);
      }
      return container;
    },
    delete(id, amount) {
      return container.deleteNumber(id, amount);
    },
    deletes(item) {
      return container.deleteNumber(item.getId(), item.getAmount());
    },
    refreshItems: () => container,
    sortItems: () => container,
  };
  return container;
}

function createPlayer(inventoryItems = [], bankItems = []) {
  const inventory = createContainer(28, inventoryItems);
  const banks = Array.from({ length: Bank.TOTAL_BANK_TABS }, (_, tab) => createContainer(800, tab === 0 ? bankItems : []));
  const equipment = Array.from({ length: 14 }, () => new Item(-1, 0));
  const attributes = new Map();
  const varps = new Map();
  const log = [];
  const sender = {
    getVarp: (id) => varps.get(id) ?? 0,
    getVarbit(id) {
      const { baseVar, startBit, endBit } = CacheDefinitions.getVarbit(id);
      return (sender.getVarp(baseVar) >>> startBit) & ((2 ** (endBit - startBit + 1)) - 1);
    },
    sendVarbit(id, value) {
      const { baseVar, startBit, endBit } = CacheDefinitions.getVarbit(id);
      const mask = ((2 ** (endBit - startBit + 1)) - 1) * 2 ** startBit;
      varps.set(baseVar, ((sender.getVarp(baseVar) & ~mask) | ((value * 2 ** startBit) & mask)) | 0);
      log.push(`varbit ${id}=${value}`);
      return sender;
    },
    sendConfig(id, value) {
      varps.set(id, value | 0);
      log.push(`varp ${id}=${value}`);
      return sender;
    },
    sendSubInterface(target, group, type) {
      log.push(`open ${target >>> 16}:${target & 0xffff} ${group} ${type}`);
      return sender;
    },
    sendClientScript(id, ...args) {
      log.push(`script ${id} [${args}]`);
      return sender;
    },
    sendInterfaceFlagsRange(uid, from, to, flags) {
      log.push(`flags ${uid >>> 16}:${uid & 0xffff} ${from}-${to} ${flags}`);
      return sender;
    },
    sendEnterAmountPrompt(title) {
      log.push(`prompt ${title}`);
      return sender;
    },
    sendInterfaceRemoval: () => sender,
  };
  const player = {
    messages: [],
    log,
    interfaceId: -1,
    status: PlayerStatus.NONE,
    enteredAmountAction: null,
    enteredSyntaxAction: null,
    bankCustomQuantity: 0,
    bankQuantityMode: 0,
    sendMessage: (message) => player.messages.push(message),
    getInventory: () => inventory,
    getBank: (tab) => banks[tab],
    getCurrentBankTab: () => 0,
    isSearchingBank: () => false,
    getBankCustomQuantity: () => player.bankCustomQuantity,
    setBankCustomQuantity: (amount) => { player.bankCustomQuantity = amount; },
    getBankQuantityMode: () => player.bankQuantityMode,
    getStatus: () => player.status,
    getInterfaceId: () => player.interfaceId,
    setInterfaceId: (id) => { player.interfaceId = id; },
    getEquipment: () => ({ getItems: () => equipment, containsAllItem: () => true }),
    getSkillManager: () => ({ getCurrentLevel: () => 99 }),
    getSpellbook: () => MagicSpellbook.NORMAL,
    getCombat: () => ({ setCastSpell() {}, reset() {} }),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    setEnteredAmountAction: (action) => { player.enteredAmountAction = action; },
    getEnteredAmountAction: () => player.enteredAmountAction,
    setEnteredSyntaxAction: (action) => { player.enteredSyntaxAction = action; },
    getPacketSender: () => sender,
    getHitpoints: () => 10,
    isTeleportingReturn: () => false,
  };
  return player;
}

function openBank(player) {
  player.status = PlayerStatus.BANKING;
  player.interfaceId = Bank.MAIN_INTERFACE_ID;
}

/** The pouch's slots as `[rune, amount]` pairs, read back from the varbits the client sees. */
function varbitSlots(player) {
  const sender = player.getPacketSender();
  return [1, 2, 3, 4].map((n) => [
    Pouch.runeOf(sender.getVarbit(varbit(`rune_pouch_type_${n}`))),
    sender.getVarbit(varbit(`rune_pouch_quantity_${n}`)),
  ]).filter(([, amount]) => amount > 0);
}

function useOnPouch(player, rune, pouch) {
  return PluginManager.emitItemOnItem({
    player, usedItem: rune, usedItemId: rune.getId(), usedItemSlot: 0,
    usedWithItem: pouch, usedWithItemId: pouch.getId(), usedWithItemSlot: 0, handled: false,
  });
}

function itemOption(player, item, option) {
  const slot = player.getInventory().getItems().indexOf(item);
  const definition = CacheDefinitions.getItem(item.getId());
  const index = definition.interfaceOptions?.indexOf(option) ?? definition.inventoryActions?.indexOf(option);
  return PluginManager.emitItemAction({
    player, interfaceId: 149 << 16, item, itemId: item.getId(), slot,
    clickType: index + 1, option, handled: false,
  });
}

function clickComponent(player, name, action, extra = {}) {
  const uid = component(name);
  return PluginManager.emitInterfaceActionClick({
    player, buttonId: uid, action, groupId: uid >>> 16, childId: uid & 0xffff, handled: false, ...extra,
  });
}

const pouchWith = (player, runes) => runes.forEach(([id, amount]) => Pouch.store(player, id, amount));

test("the cache enum maps pouch types to the runes the captures show", () => {
  assert.equal(Pouch.runeOf(1), Items.AIR_RUNE);
  assert.equal(Pouch.runeOf(3), Items.EARTH_RUNE);
  assert.equal(Pouch.runeOf(7), Items.DEATH_RUNE);
  assert.equal(Pouch.runeOf(8), Items.BLOOD_RUNE);
  assert.equal(Pouch.runeOf(13), Items.SOUL_RUNE);
  assert.equal(Pouch.typeOf(Items.NATURE_RUNE), 10);
  assert.equal(Pouch.typeOf(Items.COINS), 0);
});

test("using a rune on the pouch stores the whole stack with no prompt", () => {
  const pouch = new Item(Items.RUNE_POUCH, 1);
  const blood = new Item(Items.BLOOD_RUNE, 4762);
  const player = createPlayer([pouch, blood]);

  assert.equal(useOnPouch(player, blood, pouch), true);
  assert.equal(player.enteredAmountAction, null);
  assert.equal(player.getInventory().getAmount(Items.BLOOD_RUNE), 0);
  assert.deepEqual(varbitSlots(player), [[Items.BLOOD_RUNE, 4762]]);
});

test("a stack over 16,000 leaves the rest in the inventory, and a full pouch can't hold more", () => {
  const pouch = new Item(Items.RUNE_POUCH, 1);
  const air = new Item(Items.AIR_RUNE, 20000);
  const [fire, water, death] = [Items.FIRE_RUNE, Items.WATER_RUNE, Items.DEATH_RUNE].map((id) => new Item(id, 5));
  const player = createPlayer([pouch, air, fire, water, death]);

  useOnPouch(player, air, pouch);
  assert.equal(player.getInventory().getAmount(Items.AIR_RUNE), 4000);
  useOnPouch(player, air, pouch);
  assert.equal(player.messages.at(-1), "The pouch can't hold that.");

  for (const rune of [fire, water, death]) useOnPouch(player, rune, pouch);
  assert.equal(player.messages.at(-1), "The pouch can't hold that.", "a 4th type");
  assert.deepEqual(varbitSlots(player), [[Items.AIR_RUNE, 16000], [Items.FIRE_RUNE, 5], [Items.WATER_RUNE, 5]]);
});

test("the divine pouch takes a 4th type", () => {
  const pouch = new Item(Items.DIVINE_RUNE_POUCH, 1);
  const player = createPlayer([pouch]);
  pouchWith(player, [[Items.AIR_RUNE, 1], [Items.WATER_RUNE, 1], [Items.EARTH_RUNE, 1], [Items.FIRE_RUNE, 1]]);
  assert.equal(Pouch.store(player, Items.MIND_RUNE, 1), 0);
  assert.deepEqual(varbitSlots(player).map(([id]) => id), [Items.AIR_RUNE, Items.WATER_RUNE, Items.EARTH_RUNE, Items.FIRE_RUNE]);
});

test("carrying both pouches, the divine pouch's 4th slot counts", () => {
  const player = createPlayer([new Item(Items.RUNE_POUCH, 1), new Item(Items.DIVINE_RUNE_POUCH, 1)]);
  pouchWith(player, [[Items.AIR_RUNE, 1], [Items.WATER_RUNE, 1], [Items.EARTH_RUNE, 1]]);
  assert.equal(Pouch.store(player, Items.FIRE_RUNE, 1), 1);
  assert.equal(Pouch.slotCount(player), 4);
});

test("a non-rune on the pouch is left alone", () => {
  const pouch = new Item(Items.RUNE_POUCH, 1);
  const coins = new Item(Items.COINS, 1);
  const player = createPlayer([pouch, coins]);
  assert.equal(useOnPouch(player, coins, pouch), false);
});

test("Empty returns every rune; with the bank open or no room it can't", () => {
  const pouch = new Item(Items.RUNE_POUCH, 1);
  const player = createPlayer([pouch]);
  pouchWith(player, [[Items.AIR_RUNE, 100], [Items.FIRE_RUNE, 5]]);

  openBank(player);
  itemOption(player, pouch, "Empty");
  assert.equal(player.messages.at(-1), "It was not possible to empty the pouch.");
  assert.equal(Pouch.isEmpty(player), false);

  player.status = PlayerStatus.NONE;
  player.interfaceId = -1;
  itemOption(player, pouch, "Empty");
  assert.equal(Pouch.isEmpty(player), true);
  assert.equal(player.getInventory().getAmount(Items.AIR_RUNE), 100);
  assert.deepEqual(varbitSlots(player), []);

  const full = createPlayer([pouch, ...Array.from({ length: 27 }, () => new Item(Items.BRONZE_DAGGER, 1))]);
  pouchWith(full, [[Items.AIR_RUNE, 10]]);
  itemOption(full, pouch, "Empty");
  assert.equal(full.messages.at(-1), "It was not possible to empty the pouch.");
  assert.equal(Pouch.amountOf(full, Items.AIR_RUNE), 10);
});

test("Open shows interface 190 over an op-less inventory, and closing puts the inventory back", () => {
  const pouch = new Item(Items.RUNE_POUCH, 1);
  const player = createPlayer([pouch]);
  itemOption(player, pouch, "Open");
  assert.equal(player.interfaceId, 190);
  assert.ok(player.log.includes("varp 261=3"), "three slots");
  assert.ok(player.log.includes("open 161:79 907 1"));
  assert.ok(player.log.includes("open 161:16 190 0"));
  assert.ok(player.log.some((line) => line.startsWith("flags 190:4 0-5")));
  assert.ok(player.log.some((line) => line.startsWith("flags 190:7 0-27")));

  PluginManager.emitCustomEvent("interface:closed", { player, interfaceId: 190 });
  assert.ok(player.log.includes("open 161:79 149 1"));
  assert.ok(player.log.includes("script 915 [3]"));
});

test("the interface's quantity buttons and ops move runes as captured", () => {
  const pouch = new Item(Items.RUNE_POUCH, 1);
  const water = new Item(Items.WATER_RUNE, 100);
  const player = createPlayer([pouch, water]);
  itemOption(player, pouch, "Open");
  const sender = player.getPacketSender();
  const deposit = (op) => clickComponent(player, "rune_pouch:inventory", op, { slot: 1, itemId: Items.WATER_RUNE });

  clickComponent(player, "rune_pouch:1", 1);
  deposit(1);
  assert.deepEqual(varbitSlots(player), [[Items.WATER_RUNE, 1]]);
  clickComponent(player, "rune_pouch:5", 1);
  assert.equal(sender.getVarbit(varbit("rune_pouch_selectedquantity")), 1);
  deposit(1);
  assert.deepEqual(varbitSlots(player), [[Items.WATER_RUNE, 6]]);

  clickComponent(player, "rune_pouch:x", 2);
  assert.equal(player.log.at(-1), "prompt Enter amount: (1 - 16,000)");
  player.enteredAmountAction.execute(50);
  assert.equal(sender.getVarbit(varbit("rune_pouch_customquantity")), 50);
  assert.equal(sender.getVarbit(varbit("rune_pouch_selectedquantity")), 3);
  deposit(1);
  assert.deepEqual(varbitSlots(player), [[Items.WATER_RUNE, 56]]);

  deposit(2);
  deposit(3);
  assert.deepEqual(varbitSlots(player), [[Items.WATER_RUNE, 62]], "op2 stores 1, op3 stores 5");

  const withdraw = (op) => clickComponent(player, "rune_pouch:pouch", op, { slot: 0, itemId: Items.WATER_RUNE });
  withdraw(2);
  assert.deepEqual(varbitSlots(player), [[Items.WATER_RUNE, 61]]);
  withdraw(6);
  assert.deepEqual(varbitSlots(player), [], "op6 withdraws all");
  assert.equal(player.getInventory().getAmount(Items.WATER_RUNE), 100);
});

test("op1 on the pouch in the bank shows it, and op9 empties it into the bank", () => {
  const pouch = new Item(Items.RUNE_POUCH, 1);
  const player = createPlayer([pouch]);
  openBank(player);
  const sender = player.getPacketSender();

  const empty = { player, item: pouch, slot: 0, op: 9, handled: false };
  PluginManager.emitCustomEvent(Bank.INVENTORY_OP_EVENT, empty);
  assert.equal(empty.handled, true);
  assert.equal(player.messages.at(-1), "Your pouch is empty.");

  pouchWith(player, [[Items.DEATH_RUNE, 15861], [Items.AIR_RUNE, 16000]]);
  const view = { player, item: pouch, slot: 0, op: 1, handled: false };
  PluginManager.emitCustomEvent(Bank.INVENTORY_OP_EVENT, view);
  assert.equal(view.handled, true);
  assert.equal(sender.getVarbit(Bank.VIEW_CONTAINER_VARBIT), 3);
  assert.equal(sender.getVarp(Bank.VIEW_CONTAINER_OBJ_VARP), Items.RUNE_POUCH);
  assert.ok(player.log.some((line) => line.startsWith("flags 15:26 1-3")));
  assert.ok(player.log.some((line) => line.startsWith("flags 15:95 112-223")));

  const deposit = { player, item: pouch, slot: 0, op: 2, handled: false };
  PluginManager.emitCustomEvent(Bank.INVENTORY_OP_EVENT, deposit);
  assert.equal(deposit.handled, false, "the other ops deposit the pouch");

  PluginManager.emitCustomEvent(Bank.INVENTORY_OP_EVENT, { ...empty, handled: false });
  assert.deepEqual(varbitSlots(player), []);
  assert.equal(player.getBank(0).getAmount(Items.DEATH_RUNE), 15861);

  clickComponent(player, "bankside:runepouch_dismiss", 1);
  assert.equal(sender.getVarbit(Bank.VIEW_CONTAINER_VARBIT), 0);
  assert.equal(sender.getVarp(Bank.VIEW_CONTAINER_OBJ_VARP), -1);
});

test("the divine pouch's bank view is bank_viewcontainer 4, even with a rune pouch carried", () => {
  const divine = new Item(Items.DIVINE_RUNE_POUCH, 1);
  const player = createPlayer([new Item(Items.RUNE_POUCH, 1), divine]);
  openBank(player);
  pouchWith(player, [[Items.AIR_RUNE, 10]]);
  PluginManager.emitCustomEvent(Bank.INVENTORY_OP_EVENT, { player, item: divine, slot: 1, op: 1, handled: false });
  const sender = player.getPacketSender();
  assert.equal(sender.getVarbit(Bank.VIEW_CONTAINER_VARBIT), 4);
  assert.equal(sender.getVarp(Bank.VIEW_CONTAINER_OBJ_VARP), Items.DIVINE_RUNE_POUCH);
  assert.ok(player.log.some((line) => line.startsWith("flags 15:26 1-4")));
  clickComponent(player, "bankside:runepouch_bankall", 1);
  assert.equal(player.getBank(0).getAmount(Items.AIR_RUNE), 10, "the view's buttons work in the divine view");
});

test("a rune's ops in the bank view bank 1, 5, 10, X or all of it", () => {
  const pouch = new Item(Items.RUNE_POUCH, 1);
  const player = createPlayer([pouch]);
  openBank(player);
  pouchWith(player, [[Items.AIR_RUNE, 16000], [Items.FIRE_RUNE, 16000]]);
  PluginManager.emitCustomEvent(Bank.INVENTORY_OP_EVENT, { player, item: pouch, slot: 0, op: 1, handled: false });
  const air = (op, option) => clickComponent(player, "bankside:runepouch_top", op, { slot: 1, itemId: Items.AIR_RUNE, option });

  air(2);
  air(3);
  air(4);
  assert.equal(Pouch.amountOf(player, Items.AIR_RUNE), 15984);
  air(6);
  assert.equal(player.log.at(-1), "prompt Enter amount:");
  player.enteredAmountAction.execute(50);
  assert.equal(player.bankCustomQuantity, 50);
  air(5);
  assert.equal(Pouch.amountOf(player, Items.AIR_RUNE), 15884);
  assert.equal(player.getBank(0).getAmount(Items.AIR_RUNE), 116);

  player.bankQuantityMode = 4;
  clickComponent(player, "bankside:runepouch_top", 1, { slot: 2, itemId: Items.FIRE_RUNE });
  assert.equal(Pouch.amountOf(player, Items.FIRE_RUNE), 0, "op1 follows the bank's All");

  clickComponent(player, "bankside:runepouch_bankall", 1);
  assert.deepEqual(varbitSlots(player), []);
  assert.equal(player.getBank(0).getAmount(Items.AIR_RUNE), 16000);
});

test("a loadout slot takes the picked rune and its limit, packed into the cache's varbits", () => {
  const pouch = new Item(Items.RUNE_POUCH, 1);
  const player = createPlayer([pouch]);
  openBank(player);
  PluginManager.emitCustomEvent(Bank.INVENTORY_OP_EVENT, { player, item: pouch, slot: 0, op: 1, handled: false });
  const sender = player.getPacketSender();

  clickComponent(player, "bankside:runepouch_loadout_a", 1, { slot: 1 });
  player.enteredSyntaxAction.execute(String(Items.AIR_RUNE));
  assert.equal(player.log.at(-1), "prompt Air rune: Set a quantity limit? (1 - 15,999, or 0 for no limit)");
  player.enteredAmountAction.execute(50);
  assert.equal(sender.getVarbit(varbit("rune_pouch_loadout_a_rune1_bitsa")), 1);
  assert.equal(sender.getVarbit(varbit("rune_pouch_loadout_a_cap1")), 50);

  // Soul rune (type 13) spills into a_rune2's second part.
  clickComponent(player, "bankside:runepouch_loadout_a", 1, { slot: 2 });
  player.enteredSyntaxAction.execute(String(Items.SOUL_RUNE));
  player.enteredAmountAction.execute(0);
  player.enteredAmountAction = null;
  assert.equal(sender.getVarbit(varbit("rune_pouch_loadout_a_rune2_bitsa")), 13 & 15);
  assert.equal(sender.getVarbit(varbit("rune_pouch_loadout_a_rune2_bitsb")), 13 >> 4);

  // "Empty slot" in the rune search answers with pattern_lime_dummy and clears the slot.
  clickComponent(player, "bankside:runepouch_loadout_a", 1, { slot: 1 });
  player.enteredSyntaxAction.execute("11526");
  assert.equal(sender.getVarbit(varbit("rune_pouch_loadout_a_rune1_bitsa")), 0);
  assert.equal(sender.getVarbit(varbit("rune_pouch_loadout_a_cap1")), 0);
  assert.equal(player.enteredAmountAction, null, "no limit is asked for an empty slot");
  assert.equal(Loadouts._test.loadouts(player)[0].runes[0], null);
});

test("closing the bank closes a loadout's limit prompt still open in the chatbox", () => {
  const pouch = new Item(Items.RUNE_POUCH, 1);
  const player = createPlayer([pouch]);
  openBank(player);
  PluginManager.emitCustomEvent(Bank.INVENTORY_OP_EVENT, { player, item: pouch, slot: 0, op: 1, handled: false });
  clickComponent(player, "bankside:runepouch_loadout_a", 1, { slot: 1 });
  player.enteredSyntaxAction.execute(String(Items.AIR_RUNE));
  assert.ok(player.enteredAmountAction);

  // As PacketSender.sendInterfaceRemoval does: the prompt's action is dropped before the event.
  player.enteredAmountAction = null;
  PluginManager.emitCustomEvent("interface:closed", { player, interfaceId: Bank.MAIN_INTERFACE_ID });
  assert.equal(player.log.at(-1), "script 101 [7]", "meslayer_close for the count prompt");
});

test("loading a loadout banks the pouch, then fills it from the inventory first and the bank", () => {
  const pouch = new Item(Items.RUNE_POUCH, 1);
  const player = createPlayer(
    [pouch, new Item(Items.WATER_RUNE, 20000), new Item(Items.AIR_RUNE, 100)],
    [new Item(Items.EARTH_RUNE, 20000), new Item(Items.SOUL_RUNE, 1084)],
  );
  openBank(player);
  PluginManager.emitCustomEvent(Bank.INVENTORY_OP_EVENT, { player, item: pouch, slot: 0, op: 1, handled: false });
  pouchWith(player, [[Items.DEATH_RUNE, 10]]);
  player.setAttribute(Loadouts._test.LOADOUTS_ATTRIBUTE, [
    { runes: [[Items.AIR_RUNE, 50], [Items.WATER_RUNE, 0], [Items.EARTH_RUNE, 0]], name: 0 },
    { runes: [[Items.SOUL_RUNE, 5000]], name: 0 },
  ]);

  clickComponent(player, "bankside:runepouch_load_a", 1);
  assert.equal(player.messages.at(-1), "Loading pouch load-out 1...");
  assert.deepEqual(varbitSlots(player), [[Items.AIR_RUNE, 50], [Items.WATER_RUNE, 16000], [Items.EARTH_RUNE, 16000]]);
  assert.equal(player.getInventory().getAmount(Items.AIR_RUNE), 50);
  assert.equal(player.getInventory().getAmount(Items.WATER_RUNE), 4000);
  assert.equal(player.getBank(0).getAmount(Items.EARTH_RUNE), 4000);
  assert.equal(player.getBank(0).getAmount(Items.DEATH_RUNE), 10, "the old runes were banked");

  clickComponent(player, "bankside:runepouch_load_b", 1);
  assert.equal(player.messages.at(-1), "Your pouch could not find sufficient runes.");
  assert.deepEqual(varbitSlots(player), [[Items.SOUL_RUNE, 1084]]);
  assert.equal(player.getBank(0).getAmount(Items.WATER_RUNE), 16000);
});

test("a loadout name is picked from the cache's list", () => {
  const pouch = new Item(Items.RUNE_POUCH, 1);
  const player = createPlayer([pouch]);
  openBank(player);
  PluginManager.emitCustomEvent(Bank.INVENTORY_OP_EVENT, { player, item: pouch, slot: 0, op: 1, handled: false });
  const sender = player.getPacketSender();

  clickComponent(player, "bankside:runepouch_name_a", 1);
  assert.equal(sender.getVarbit(varbit("rune_pouch_loadout_name_selected")), 1);
  // Captured: list rows 132, 130 and 135 named The Fight Caves (18), Duke Sucellus (17) and Giant Mole (21).
  clickComponent(player, "bankside:runepouch_name_select_list", 1, { slot: 132 });
  assert.equal(sender.getVarbit(varbit("rune_pouch_loadout_name_a")), 18);
  clickComponent(player, "bankside:runepouch_name_b", 1);
  clickComponent(player, "bankside:runepouch_name_select_list", 1, { slot: 130 });
  assert.equal(sender.getVarbit(varbit("rune_pouch_loadout_name_b")), 17);
  clickComponent(player, "bankside:runepouch_name_a", 1);
  clickComponent(player, "bankside:runepouch_name_select_list", 1, { slot: 135 });
  assert.equal(sender.getVarbit(varbit("rune_pouch_loadout_name_a")), 21);
});

test("spells take only the shortfall from the pouch", () => {
  const pouch = new Item(Items.RUNE_POUCH, 1);
  const player = createPlayer([pouch, new Item(Items.AIR_RUNE, 1)]);
  pouchWith(player, [[Items.MIND_RUNE, 2]]);
  assert.equal(CombatSpells.WIND_STRIKE.canCast(player, true), true);
  assert.equal(player.getInventory().getAmount(Items.AIR_RUNE), 0);
  assert.deepEqual(varbitSlots(player), [[Items.MIND_RUNE, 1]]);

  const short = createPlayer([pouch]);
  pouchWith(short, [[Items.AIR_RUNE, 10]]);
  assert.equal(CombatSpells.WIND_STRIKE.canCast(short, true), false);
  assert.equal(Pouch.amountOf(short, Items.AIR_RUNE), 10);

  const noPouch = createPlayer([]);
  pouchWith(noPouch, [[Items.AIR_RUNE, 10], [Items.MIND_RUNE, 10]]);
  assert.equal(CombatSpells.WIND_STRIKE.canCast(noPouch, false), false, "the runes need the pouch carried");
});

test("login moves runes from an old pouch's meta onto the player and sends the varbits", () => {
  const pouch = new Item(Items.RUNE_POUCH, 1);
  pouch.setMetaValue(Pouch.LEGACY_META_KEY, { [Items.AIR_RUNE]: 500, [Items.LAW_RUNE]: 3 });
  const player = createPlayer([pouch]);
  Pouch.login(player);
  assert.equal(pouch.getMetaValue(Pouch.LEGACY_META_KEY), undefined);
  assert.deepEqual(varbitSlots(player), [[Items.AIR_RUNE, 500], [Items.LAW_RUNE, 3]]);
});
