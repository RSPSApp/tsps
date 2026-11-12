const assert = require("node:assert/strict");
const { test } = require("node:test");
const RangingGuild = require("../plugins/areas/RangingGuild.plugin");

function fixture({ tickets = 10000, capacity = 1000, mode = 0 } = {}) {
  const hooks = {};
  const items = new Map();
  const messages = [];
  let isOpen = true;
  let quantityMode = mode;
  const sender = {
    getVarbit: () => quantityMode,
    setVarbit: (_id, value) => { quantityMode = value; return sender; },
    sendVarbit: (_id, value) => { quantityMode = value; return sender; },
    isSubInterfaceOpen: (group) => isOpen && group === 2,
    sendInterface: (group) => { sender.opened = group; return sender; },
    sendInterfaceFlagsRange: (...args) => { sender.flags = args; return sender; },
    sendEnterAmountPrompt: (text) => { sender.prompt = text; return sender; },
  };
  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    getAddableAmount: (item) => item.getId() === 1464 ? Math.max(0, 100000 - (items.get(1464) ?? 0)) : capacity,
    deleteNumber: (id, amount) => items.set(id, Math.max(0, (items.get(id) ?? 0) - amount)),
    adds: (id, amount) => items.set(id, (items.get(id) ?? 0) + amount),
  };
  const player = {
    getPacketSender: () => sender,
    getInventory: () => inventory,
    sendMessage: (message) => messages.push(message),
    setEnteredAmountAction: (action) => { player.amountAction = action; },
  };
  const core = {
    ItemIdentifiers: { ARCHERY_TICKET: 1464, BARB_BOLTTIPS: 47, STUDDED_BODY: 1133, RUNE_ARROW: 892, COIF: 1169, GREEN_DHIDE_BODY: 1135, ADAMANT_JAVELIN: 829 },
    Item: class { constructor(id, amount) { this.id = id; this.amount = amount; } getId() { return this.id; } },
    ItemDefinition: { forId: (id) => ({ getName: () => `item ${id}`, getExamine: () => `Examine ${id}` }) },
  };
  RangingGuild.register({
    core,
    onCustomEvent: () => {},
    onCanShop: (handler) => { hooks.canShop = handler; },
    onInterfaceActionClick: (handler) => { hooks.click = handler; },
  });
  items.set(1464, tickets);
  return { hooks, items, messages, player, sender, close: () => { isOpen = false; } };
}

function click(f, { slot = 0, action = 3, option = "Buy 1", itemId = 47 } = {}) {
  const event = { player: f.player, groupId: 2, childId: 2, slot, action, option, itemId, handled: false };
  f.hooks.click(event);
  return event;
}

test("ticket merchant opens the native exchange and suppresses the generated stock shop", () => {
  const f = fixture();
  const event = { player: f.player, shopId: 1461, allow: null };
  f.hooks.canShop(event);
  assert.equal(event.allow, false);
  assert.equal(f.sender.opened, 2);
  assert.deepEqual(f.sender.flags, [131074, 0, 5, 0x43e]);
});

test("Buy 1 and Buy 5 charge one price per reward set and can be repeated", () => {
  const f = fixture({ tickets: 5000 });
  click(f, { option: "Buy 1", action: 3 });
  click(f, { option: "Buy 5", action: 4 });
  assert.equal(f.items.get(47), 180);
  assert.equal(f.items.get(1464), 4160);
});

test("Buy X prompts with the affordable, inventory-limited number of sets", () => {
  const f = fixture({ tickets: 1500, capacity: 65 });
  click(f, { option: "Buy X", action: 5 });
  assert.match(f.sender.prompt, /0 - 2\)/);
  f.player.amountAction.execute(10);
  assert.equal(f.items.get(47), 60);
  assert.equal(f.items.get(1464), 1220);
});

test("rejects unaffordable and mismatched row clicks without changing inventory", () => {
  const f = fixture({ tickets: 50 });
  const wrongItem = click(f, { itemId: 829 });
  assert.equal(wrongItem.handled, false);
  const buy = click(f);
  assert.equal(buy.handled, true);
  assert.equal(f.items.get(1464), 50);
  assert.equal(f.items.get(47), undefined);
  assert.match(f.messages[0], /don't have enough Archery tickets/);
});

test("rejects purchases when output cannot fit", () => {
  const f = fixture({ tickets: 1000, capacity: 0 });
  click(f);
  assert.equal(f.items.get(1464), 1000);
  assert.equal(f.items.get(47), undefined);
  assert.match(f.messages[0], /couldn't hold/);
});

test("the cache quantity-mode varbit maps reordered options to the right actions", () => {
  const f = fixture({ tickets: 1000, mode: 2 });
  click(f, { option: "", action: 1 }); // Buy 5 in mode 2
  assert.equal(f.items.get(47), 150);
  assert.equal(f.items.get(1464), 300);
});

test("quantity selector op 1 syncs cache children 6-9 to server varbit 6348", () => {
  const f = fixture();
  for (let mode = 0; mode < 4; mode++) {
    const event = { player: f.player, groupId: 2, childId: mode + 6, action: 1, handled: false };
    assert.equal(f.hooks.click(event), true);
    assert.equal(event.handled, true);
    assert.equal(f.sender.getVarbit(6348), mode);
  }
});

test("Examine reports the selected reward's cache text", () => {
  const f = fixture();
  const event = click(f, { action: 10, option: "Examine" });
  assert.equal(event.handled, true);
  assert.deepEqual(f.messages, ["Examine 47"]);
});

test("a Buy-X amount callback cannot spend after the exchange closes", () => {
  const f = fixture({ tickets: 1000 });
  click(f, { option: "Buy X", action: 5 });
  f.close();
  f.player.amountAction.execute(2);
  assert.equal(f.items.get(1464), 1000);
  assert.equal(f.items.get(47), undefined);
});
