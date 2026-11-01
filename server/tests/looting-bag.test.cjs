// Run after `yarn build`: node --test tests/looting-bag.test.cjs
//
// The looting bag against the Wiki (https://oldschool.runescape.wiki/w/Looting_bag) and rsprox
// captures 448-464 (rev 233), 821 (rev 234) and 1541/1545 (rev 224): Check only shows the bag,
// Deposit's Store-1/5/All/X, the use-item quantity menu and Settings, one slot per unstackable item,
// the bank's looting bag view, the destroy prompt, pickups, death and destroy drops.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Location } = require("../dist/game/model/Location");

const KARAMBWAN = 3144;
const COINS = 995;
const FIRE_RUNE = 554;
const MITHRIL_PLATELEGS_NOTE = 1072;
const UNIDENTIFIED_MINERALS = 21341;
const CLOSED_BAG = 11941;
const OPEN_BAG = 22586;
const BAG_INV = 516;
const WILDERNESS = [3100, 3600];
const LUMBRIDGE = [3222, 3218];

let core, LootingBag;
const hooks = { events: {}, actions: {}, clicks: [], itemOnItem: null, pickup: null, dropPolicy: null, death: null, defeated: null };
const dropped = [];
let bankTabs;

before(() => {
  CachePipeline.initialize();
  const real = PluginManager.getCoreApi();
  // The bank's statics the plugin reads, over one fake tab; ground items are recorded.
  core = {
    ...real,
    Bank: {
      VIEW_CONTAINER_VARBIT: real.Bank.VIEW_CONTAINER_VARBIT,
      VIEW_CONTAINER_OBJ_VARP: real.Bank.VIEW_CONTAINER_OBJ_VARP,
      INVENTORY_OP_EVENT: real.Bank.INVENTORY_OP_EVENT,
      BANK_SEARCH_TAB_INDEX: real.Bank.BANK_SEARCH_TAB_INDEX,
      actionAmount: real.Bank.actionAmount,
      isOpen: (player) => player.bankOpen === true,
      getTabForItem: () => 0,
    },
  };
  const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
  ItemOnGroundManager.registerGlobal = (player, item) => dropped.push(item);
  ItemOnGroundManager.registerLocation = (player, item) => dropped.push(item);
  ItemOnGroundManager.deregister = () => {};
  const api = {
    core,
    persistAttribute() {},
    onCustomEvent: (name, fn) => { hooks.events[name] = fn; },
    emitCustomEvent: (name, event) => hooks.events[name]?.(event),
    onGroundItemPickup: (fn) => { hooks.pickup = fn; },
    onItemOnItem: (fn) => { hooks.itemOnItem = fn; },
    onItemAction: (name, actions) => { hooks.actions = actions; },
    onItemDropPolicy: (fn) => { hooks.dropPolicy = fn; },
    onInterfaceActionClick: (fn) => hooks.clicks.push(fn),
    onPlayerDeathItemDrop: (fn) => { hooks.death = fn; },
    onPlayerDefeated: (fn) => { hooks.defeated = fn; },
    sendMultiChatboxPrompt: (player, title, ...pairs) => {
      player.prompt = { title, options: pairs.filter((_, i) => i % 2 === 0), pairs };
      return true;
    },
  };
  // Food names its supplies once registered.
  require("../plugins/items/Food.plugin").register({ core: real, persistAttribute() {}, onPlayerLogin() {}, onItemAction() {} });
  LootingBag = require("../plugins/items/LootingBag.plugin");
  LootingBag.register(api);
});

function inventory(items) {
  const slots = Array.from({ length: 28 }, (_, slot) => items[slot] ?? null);
  return {
    getItems: () => slots,
    getValidItems: () => slots.filter((item) => item?.isValid?.()),
    capacity: () => 28,
    getFreeSlots: () => slots.filter((item) => !item?.isValid?.()).length,
    deleteAtSlot(slot, amount) {
      const item = slots[slot];
      item.setAmount(item.getAmount() - amount);
      if (item.getAmount() <= 0) slots[slot] = null;
    },
    add(added) {
      const stack = core.ItemDefinition.forId(added.getId()).isStackable() && slots.find((held) => held?.getId() === added.getId());
      if (stack) stack.setAmount(stack.getAmount() + added.getAmount());
      else slots[slots.findIndex((held) => !held?.isValid?.())] = added;
    },
    refreshItems() {},
    count: (id) => slots.filter((item) => item?.getId() === id).reduce((sum, item) => sum + item.getAmount(), 0),
  };
}

function bankTab() {
  const held = new Map();
  return {
    held,
    getAddableAmount: (item) => item.getAmount(),
    add: (item) => held.set(item.getId(), (held.get(item.getId()) ?? 0) + item.getAmount()),
    full() {},
    refreshItems() {},
  };
}

function player({ at = WILDERNESS, items = [] } = {}) {
  const attributes = new Map();
  const varbits = new Map();
  const p = {
    messages: [], spam: [], packets: [], prompt: null, amountAction: null, amountPrompt: null,
    bankOpen: false, bankQuantity: 0,
    location: new Location(at[0], at[1], 0),
    getLocation: () => p.location,
    getInventory: () => p.inv,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (text) => p.messages.push(text),
    setEnteredAmountAction: (action) => { p.amountAction = action; },
    getLastItemPickup: () => ({ reset() {} }),
    getBank: () => bankTabs,
    getCurrentBankTab: () => 0,
    isSearchingBank: () => false,
    getBankCustomQuantity: () => p.bankQuantity,
    setBankCustomQuantity: (amount) => { p.bankQuantity = amount; },
    getBankQuantityMode: () => 0,
    varbits,
  };
  const sender = new Proxy({}, {
    get: (_, name) => {
      if (name === "getVarbit") return (id) => varbits.get(id) ?? 0;
      return (...args) => {
        p.packets.push([name, ...args]);
        if (name === "sendVarbit") varbits.set(args[0], args[1]);
        if (name === "sendTypedMessage") p.spam.push(args[1]);
        if (name === "sendEnterAmountPrompt") p.amountPrompt = args[0];
        return sender;
      };
    },
  });
  p.getPacketSender = () => sender;
  p.inv = inventory(items);
  return p;
}

const item = (id, amount = 1) => new core.Item(id, amount);
const bagWith = (id, entries = []) => { const bag = item(id); bag.setMetaValue("lootingBag", entries); return bag; };
const stored = (bag) => LootingBag._test.bagItems(bag);
const choose = (p, text) => {
  const index = p.prompt.options.indexOf(text);
  assert.ok(index >= 0, `"${text}" not in ${p.prompt.options}`);
  const run = p.prompt.pairs[index * 2 + 1];
  p.prompt = null;
  run();
};
const packets = (p, name) => p.packets.filter(([packet]) => packet === name);
const click = (event) => { for (const fn of hooks.clicks) fn(event); return event; };
const clickBag = (p, slot, action) => click({ player: p, groupId: 81, childId: 5, slot, itemId: p.inv.getItems()[slot]?.getId(), action, handled: false });
const bankside = (name) => core.CacheDefinitions.getComponentId(`bankside:${name}`) & 0xffff;

test("Check shows the bag's inv 516 with Examine only, and a click takes nothing out (rsprox 1545, 448)", () => {
  const bag = bagWith(OPEN_BAG, [{ id: KARAMBWAN, amount: 1 }, { id: COINS, amount: 7 }]);
  const p = player({ at: LUMBRIDGE, items: [bag] });
  hooks.actions.Check({ player: p, item: bag });
  const [, inventoryId, , contents] = packets(p, "sendInventory")[0];
  assert.equal(inventoryId, BAG_INV);
  assert.deepEqual(contents.map(({ id, amount }) => [id, amount]), [[KARAMBWAN, 1], [COINS, 7]]);
  assert.deepEqual(packets(p, "sendInterfaceFlagsRange")[0].slice(1), [(81 << 16) | 5, 0, 27, 1 << 10]);
  assert.ok(packets(p, "sendInterfaceScript").some(([, id, args]) => id === 495 && args[0] === "Looting bag" && args[1] === 0));
  const prices = packets(p, "sendInterfaceScript").find(([, id]) => id === 1235)[2];
  assert.deepEqual(prices, [BAG_INV, BigInt(core.ItemDefinition.forId(KARAMBWAN).getGrandExchangeValue()), 1n,
    ...Array(26).fill(-1n)], "rev 241 expects one inventory int and 28 long prices");
  const value = core.ItemDefinition.forId(KARAMBWAN).getGrandExchangeValue() + 7;
  assert.ok(packets(p, "sendString").some(([, text]) => text === `Value: ${value.toLocaleString("en-US")} coins`));
});

test("nothing comes out of the bag outside a bank: Check's items take no withdraw ops (Wiki; rsprox 1545, 448)", () => {
  const bag = bagWith(OPEN_BAG, [{ id: KARAMBWAN, amount: 1 }, { id: COINS, amount: 7 }]);
  const p = player({ at: LUMBRIDGE, items: [bag] });
  hooks.actions.Check({ player: p, item: bag });
  for (const action of [0, 1, 2, 3, 4, 5]) {
    click({ player: p, groupId: 81, childId: 5, slot: 0, itemId: KARAMBWAN, action, option: "Withdraw", handled: false });
  }
  assert.equal(stored(bag).length, 2, "the bag's contents only leave at a bank");
  assert.equal(p.inv.count(KARAMBWAN), 0);
});

test("an empty bag's Check total reads 'Value: -' (rsprox 452)", () => {
  assert.equal(LootingBag._test.valueText("Value", []), "Value: -");
  assert.equal(LootingBag._test.valueText("Bag value", []), "Bag value: -");
});

test("Deposit: Store-1/5/All/X and Examine, one bag slot per unstackable item (rsprox 1545, cs2 497)", () => {
  const bag = bagWith(OPEN_BAG);
  const karambwans = Array.from({ length: 12 }, () => item(KARAMBWAN));
  const p = player({ items: [bag, ...karambwans, item(FIRE_RUNE, 13)] });
  hooks.actions.Deposit({ player: p, item: bag });
  assert.deepEqual(packets(p, "sendInterfaceFlagsRange")[0].slice(1), [(81 << 16) | 5, 0, 27, 0b11110 | (1 << 9)]);
  assert.ok(packets(p, "sendInterfaceScript").some(([, id, args]) => id === 495 && args[0] === "Add to bag" && args[1] === 1));
  assert.equal(clickBag(p, 1, 1).handled, true);
  assert.equal(stored(bag).length, 1, "Store-1");
  clickBag(p, 2, 2);
  assert.equal(stored(bag).length, 6, "Store-5 fills five more slots");
  assert.ok(stored(bag).every((entry) => entry.amount === 1));
  clickBag(p, 13, 4);
  assert.equal(p.amountPrompt, "Enter amount:");
  p.amountAction.execute(4);
  assert.deepEqual(stored(bag).at(-1), { id: FIRE_RUNE, amount: 4, meta: null }, "Store-X keeps a stack in one slot");
  clickBag(p, 13, 3);
  assert.deepEqual(stored(bag).at(-1), { id: FIRE_RUNE, amount: 13, meta: null }, "Store-All");
  assert.equal(p.inv.count(FIRE_RUNE), 0);
  assert.ok(packets(p, "sendString").some(([, text]) => /^Bag value: [\d,]+ coins$/.test(text)));
  for (const [, , args] of packets(p, "sendInterfaceScript").filter(([, id]) => id === 1235)) {
    assert.equal(args[0], 93, "Deposit prices the player's inventory");
    assert.equal(args.length, 29);
    assert.ok(args.slice(1).every((price) => typeof price === "bigint"), "opening and updates send 28 longs");
  }
});

test("the bag holds 28 slots: 'The bag's too full.' (rsprox 1545)", () => {
  const bag = bagWith(OPEN_BAG, Array.from({ length: 28 }, () => ({ id: KARAMBWAN, amount: 1 })));
  const p = player({ items: [bag, item(KARAMBWAN)] });
  hooks.itemOnItem({ player: p, usedItem: p.inv.getItems()[1], usedWithItem: bag });
  assert.equal(p.messages.at(-1), "The bag's too full.");
  assert.equal(stored(bag).length, 28);
  const runes = bagWith(OPEN_BAG, [{ id: FIRE_RUNE, amount: 5 }, ...Array.from({ length: 27 }, () => ({ id: KARAMBWAN, amount: 1 }))]);
  const q = player({ items: [runes, item(FIRE_RUNE, 10)] });
  hooks.itemOnItem({ player: q, usedItem: q.inv.getItems()[1], usedWithItem: runes });
  choose(q, "All");
  assert.equal(stored(runes)[0].amount, 15, "a stack already in the bag still grows");
});

test("using an item on the bag asks how many, with the captured choices for each count (rsprox 1545, 454, 821)", () => {
  assert.deepEqual(LootingBag._test.depositChoices(2).map(([text]) => text), ["One", "Both"]);
  assert.deepEqual(LootingBag._test.depositChoices(3).map(([text]) => text), ["One", "Two", "All"]);
  assert.deepEqual(LootingBag._test.depositChoices(4).map(([text]) => text), ["One", "All", "X"]);
  assert.deepEqual(LootingBag._test.depositChoices(10).map(([text]) => text), ["One", "Five", "All", "X"]);
  const bag = bagWith(OPEN_BAG);
  const p = player({ items: [bag, item(KARAMBWAN), item(KARAMBWAN), item(KARAMBWAN)] });
  hooks.itemOnItem({ player: p, usedItem: p.inv.getItems()[1], usedWithItem: bag });
  assert.equal(p.prompt.title, "How many do you want to deposit?");
  choose(p, "Two");
  assert.equal(stored(bag).length, 2);
  assert.equal(p.inv.count(KARAMBWAN), 1);
  const coins = player({ items: [bag, item(COINS, 500)] });
  hooks.itemOnItem({ player: coins, usedItem: bag, usedWithItem: coins.inv.getItems()[1] });
  choose(coins, "X");
  coins.amountAction.execute(120);
  assert.equal(coins.inv.count(COINS), 380);
});

test("a stack in the bag stops at the maximum stack; what doesn't fit stays where it was", () => {
  const MAX = 2147483647;
  const exact = bagWith(OPEN_BAG, [{ id: COINS, amount: MAX - 2 }]);
  const p = player({ items: [exact, item(COINS, 2)] });
  hooks.actions.Deposit({ player: p, item: exact });
  clickBag(p, 1, 3);
  assert.equal(stored(exact)[0].amount, MAX, "an exact fit fills the stack");
  assert.equal(p.inv.count(COINS), 0);

  const over = bagWith(OPEN_BAG, [{ id: COINS, amount: MAX - 1 }]);
  const q = player({ items: [over, item(COINS, 5)] });
  hooks.actions.Deposit({ player: q, item: over });
  clickBag(q, 1, 3);
  assert.equal(stored(over)[0].amount, MAX, "only the headroom goes in");
  assert.equal(q.inv.count(COINS), 4, "the rest stays in the inventory");
  clickBag(q, 1, 3);
  assert.equal(q.messages.at(-1), "The bag's too full.");
  assert.equal(stored(over)[0].amount, MAX);
  assert.equal(q.inv.count(COINS), 4);

  const pickup = { player: q, groundItem: { getItem: () => item(COINS, 2) }, handled: false };
  hooks.pickup(pickup);
  assert.equal(pickup.handled, false, "a pickup that would overflow stays on the ground");
  assert.deepEqual(q.spam, ["You don't have space in your looting bag for that."]);
  assert.equal(stored(over)[0].amount, MAX);

  const loot = { player: q, items: [{ id: COINS, amount: 1 }] };
  LootingBag._test.storeLoot(loot);
  assert.equal(loot.result, "full");
  assert.equal(stored(over)[0].amount, MAX);
});

test("Settings: store everything without asking, and keep picked-up supplies out (rsprox 1545)", () => {
  const bag = bagWith(OPEN_BAG);
  const p = player({ items: [bag, item(KARAMBWAN), item(KARAMBWAN), item(KARAMBWAN)] });
  hooks.actions.Settings({ player: p, item: bag });
  assert.deepEqual(p.prompt.options, ["Store everything when using items on the bag.", "Don't put supplies into the looting bag."]);
  choose(p, "Store everything when using items on the bag.");
  assert.equal(p.messages.at(-1), "When using items on the bag, you will immediately store as many of that item as possible in the bag.");
  hooks.itemOnItem({ player: p, usedItem: p.inv.getItems()[1], usedWithItem: bag });
  assert.equal(p.prompt, null, "no quantity menu");
  assert.equal(stored(bag).length, 3);
  hooks.actions.Settings({ player: p, item: bag });
  assert.deepEqual(p.prompt.options, ["Ask how many items to store when using items on the bag.", "Don't put supplies into the looting bag."]);
  choose(p, "Don't put supplies into the looting bag.");
  assert.equal(p.messages.at(-1), "Food and potions will not go into an open looting bag when picked up.");
  const food = { player: p, groundItem: { getItem: () => item(KARAMBWAN) }, handled: false };
  hooks.pickup(food);
  assert.equal(food.handled, false, "the karambwan goes to the inventory");
  const runes = { player: p, groundItem: { getItem: () => item(FIRE_RUNE, 3) }, handled: false };
  hooks.pickup(runes);
  assert.equal(runes.handled, true);
  hooks.actions.Settings({ player: p, item: bag });
  choose(p, "Put supplies into the looting bag.");
  assert.equal(p.messages.at(-1), "Food and potions will automatically go into an open looting bag when picked up.");
  hooks.actions.Settings({ player: p, item: bag });
  choose(p, "Ask how many items to store when using items on the bag.");
  assert.equal(p.messages.at(-1), "When using items on the bag, you will be asked how many of that item you wish to store in the bag.");
});

test("a full open bag leaves a pickup in the inventory with the captured spam line (rsprox 1545)", () => {
  const bag = bagWith(OPEN_BAG, Array.from({ length: 28 }, () => ({ id: KARAMBWAN, amount: 1 })));
  const p = player({ items: [bag] });
  const pickup = { player: p, groundItem: { getItem: () => item(KARAMBWAN) }, handled: false };
  hooks.pickup(pickup);
  assert.equal(pickup.handled, false);
  assert.deepEqual(p.spam, ["You don't have space in your looting bag for that."]);
});

test("refusals: outside the Wilderness, untradeables and the bag itself (rsprox 1545)", () => {
  const bag = bagWith(OPEN_BAG);
  const outside = player({ at: LUMBRIDGE, items: [bag, item(KARAMBWAN)] });
  hooks.itemOnItem({ player: outside, usedItem: outside.inv.getItems()[1], usedWithItem: bag });
  assert.equal(outside.messages.at(-1), "You can't put items in the looting bag unless you're in the Wilderness.");
  hooks.actions.Deposit({ player: outside, item: bag });
  assert.equal(outside.messages.at(-1), "You can't put items in the looting bag unless you're in the Wilderness.");
  const p = player({ items: [bag, item(UNIDENTIFIED_MINERALS, 5), bagWith(CLOSED_BAG)] });
  hooks.actions.Deposit({ player: p, item: bag });
  clickBag(p, 1, 1);
  assert.equal(p.messages.at(-1), "Only tradeable items can be put in the bag.");
  clickBag(p, 2, 1);
  assert.equal(p.messages.at(-1), "You may be surprised to learn that bagception is not permitted.");
  assert.equal(stored(bag).length, 0);
});

test("Open and Close lines (rsprox 449, 452, 1545)", () => {
  const bag = bagWith(CLOSED_BAG);
  const p = player({ items: [bag] });
  hooks.actions.Open({ player: p, item: bag });
  assert.equal(bag.getId(), OPEN_BAG);
  assert.equal(p.messages.at(-1), "You open your looting bag, ready to fill it.");
  hooks.actions.Close({ player: p, item: bag });
  assert.equal(bag.getId(), CLOSED_BAG);
  assert.equal(p.messages.at(-1), "You close your looting bag.");
});

test("the bank's looting bag view: View, Deposit-1/5/10/X/All, Deposit loot, Dismiss (rsprox 454, 457, 464, 1545)", () => {
  bankTabs = bankTab();
  const bag = bagWith(OPEN_BAG, [
    ...Array.from({ length: 12 }, () => ({ id: KARAMBWAN, amount: 1 })),
    { id: FIRE_RUNE, amount: 13 }, { id: MITHRIL_PLATELEGS_NOTE, amount: 1 },
  ]);
  const p = player({ at: LUMBRIDGE, items: [bag] });
  p.bankOpen = true;
  const view = { player: p, item: bag, slot: 0, op: 1, handled: false };
  hooks.events[core.Bank.INVENTORY_OP_EVENT](view);
  assert.equal(view.handled, true);
  assert.equal(p.varbits.get(core.Bank.VIEW_CONTAINER_VARBIT), 1);
  assert.ok(packets(p, "sendConfig").some(([, varp, value]) => varp === core.Bank.VIEW_CONTAINER_OBJ_VARP && value === OPEN_BAG));
  assert.equal(packets(p, "sendInventory").at(-1)[1], BAG_INV);
  const items = bankside("lootingbag_items");
  const op = (slot, action, option) => click({ player: p, groupId: 15, childId: items, slot, action, option, handled: false });
  op(0, 2);
  assert.equal(bankTabs.held.get(KARAMBWAN), 1, "Deposit-1");
  op(0, 3);
  assert.equal(bankTabs.held.get(KARAMBWAN), 6, "Deposit-5 takes five single slots");
  op(0, 4);
  assert.equal(bankTabs.held.get(KARAMBWAN), 12, "Deposit-10 takes what is left");
  op(0, 6);
  assert.equal(p.amountPrompt, "Enter amount:");
  p.amountAction.execute(3);
  assert.equal(bankTabs.held.get(FIRE_RUNE), 3, "Deposit-X");
  p.amountPrompt = null;
  op(0, 6, "Deposit-X");
  assert.equal(p.amountPrompt, "Enter amount:", "the option's own name asks too");
  p.amountAction.execute(2);
  assert.equal(bankTabs.held.get(FIRE_RUNE), 5, "Deposit-X");
  op(0, 7);
  assert.equal(bankTabs.held.get(FIRE_RUNE), 13, "Deposit-All");
  click({ player: p, groupId: 15, childId: bankside("lootingbag_bankall"), handled: false });
  assert.equal(bankTabs.held.get(MITHRIL_PLATELEGS_NOTE), 1, "Deposit loot");
  assert.equal(stored(bag).length, 0);
  click({ player: p, groupId: 15, childId: bankside("lootingbag_dismiss"), handled: false });
  assert.equal(p.varbits.get(core.Bank.VIEW_CONTAINER_VARBIT), 0);
});

test("Destroy goes through the shared confirmation, worded as live (rsprox 448, 1541, 1545)", () => {
  const empty = { player: player(), item: bagWith(OPEN_BAG), question: "", warning: "" };
  hooks.events["destroy-item:prompt"](empty);
  assert.equal(empty.question, "Are you sure you want to destroy the bag?");
  assert.equal(empty.warning, "The bag is empty. Are you sure you want to destroy it?");
  const filled = { player: player(), item: bagWith(OPEN_BAG, [{ id: COINS, amount: 1 }]), question: "", warning: "" };
  hooks.events["destroy-item:prompt"](filled);
  assert.equal(filled.warning, "If you destroy it, the contents will be lost.");
  assert.equal(hooks.actions.Destroy, undefined, "the click falls through to the drop path, which asks first");
  const bag = bagWith(OPEN_BAG, [{ id: COINS, amount: 5 }]);
  const p = player({ items: [bag] });
  const click = { player: p, item: bag, itemId: OPEN_BAG, slot: 0, dropToGround: true, handled: false };
  hooks.dropPolicy(click);
  assert.equal(click.handled, false, "the click itself only opens the prompt");
  assert.equal(p.inv.getItems()[0], bag);
});

test("the shared destroy prompt shows the lines the bag gives it, and its own for other items", () => {
  const strings = [];
  const sender = new Proxy({}, { get: (_, name) => (...args) => { if (name === "sendString") strings.push(args[0]); return sender; } });
  let policy;
  delete require.cache[require.resolve("../plugins/interface/DestroyItem.plugin")];
  require("../plugins/interface/DestroyItem.plugin").register({
    core, registerCustomInterface() {}, onInterfaceActionButton() {},
    onItemDropPolicy: (fn) => { policy = fn; },
    emitCustomEvent: (name, event) => hooks.events[name]?.(event),
  });
  const p = player();
  p.getPacketSender = () => sender;
  const bag = bagWith(OPEN_BAG);
  policy({ player: p, item: bag, itemId: OPEN_BAG, slot: 0, dropToGround: true, handled: false });
  assert.deepEqual(strings.slice(-2), ["Are you sure you want to destroy the bag?", "The bag is empty. Are you sure you want to destroy it?"]);
  const untradeable = item(UNIDENTIFIED_MINERALS);
  untradeable.isDropable = () => false;
  policy({ player: p, item: untradeable, itemId: UNIDENTIFIED_MINERALS, slot: 1, dropToGround: true, handled: false });
  assert.deepEqual(strings.slice(-2), ["Are you sure you want to destroy this item?", "This item will be destroyed permanently."]);
});

test("a confirmed Destroy in the Wilderness drops coins and noted items, not food or vials of water; elsewhere all is lost (Wiki)", () => {
  const NOTED_BANANA = core.ItemDefinition.forId(1963).getNoteId?.() ?? 1964;
  const contents = [{ id: COINS, amount: 5 }, { id: 1963, amount: 2 }, { id: NOTED_BANANA, amount: 1 }, { id: 227, amount: 3 }];
  const bag = bagWith(OPEN_BAG, contents);
  const p = player({ items: [bag] });
  const before = dropped.length;
  const confirmed = { player: p, item: bag, itemId: OPEN_BAG, slot: 0, dropToGround: false, handled: false };
  hooks.dropPolicy(confirmed);
  assert.equal(confirmed.handled, true);
  assert.equal(p.inv.getItems()[0], null);
  assert.deepEqual(dropped.slice(before).map((entry) => entry.getId()).sort((a, b) => a - b), [COINS, NOTED_BANANA].sort((a, b) => a - b));
  const outside = player({ at: LUMBRIDGE, items: [bagWith(OPEN_BAG, contents)] });
  const after = dropped.length;
  hooks.dropPolicy({ player: outside, item: outside.inv.getItems()[0], dropToGround: false, handled: false });
  assert.equal(outside.inv.getItems()[0], null);
  assert.equal(dropped.length, after);
});

test("on death the killer gets everything but food and potions (Wiki)", () => {
  const bag = bagWith(OPEN_BAG, [{ id: COINS, amount: 5 }, { id: 1963, amount: 2 }]);
  const victim = player({ items: [bag] });
  const death = { player: victim, item: bag, location: victim.location, handled: false };
  hooks.death(death);
  assert.equal(death.handled, true);
  const before = dropped.length;
  hooks.defeated({ killer: player(), victim });
  assert.deepEqual(dropped.slice(before).map((entry) => entry.getId()), [COINS]);
});
