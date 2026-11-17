const assert = require("node:assert/strict");
const { test } = require("node:test");

const Retrieval = require("../plugins/minigames/hallowedsepulchre/Retrieval.HallowedSepulchre");

function item(id, amount = 1) {
  return { getId: () => id, getAmount: () => amount, getMeta: () => null };
}

function player(areaName = "Hallowed Sepulchre") {
  const attributes = new Map();
  const state = { areaName };
  const calls = { configs: [], scripts: [], messages: [], strings: [] };
  const sender = {
    sendConfig: (id, value) => calls.configs.push([id, value]),
    sendInventory: () => {},
    sendString: (text) => calls.strings.push(text),
    sendInterfaceScript: (id, args) => calls.scripts.push([id, args]),
    sendInterfaceRemoval: () => {},
    sendSubInterface: () => {},
    sendInterfaceFlagsRange: () => {},
    isSubInterfaceOpen: () => true,
  };
  const p = {
    attributes,
    state,
    calls,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getArea: () => ({ getName: () => state.areaName }),
    getPacketSender: () => sender,
    sendMessage: (message) => calls.messages.push(message),
    getInventory: () => ({ getAddableAmount: () => 1, add: () => {}, refreshItems: () => {} }),
  };
  return p;
}

/** Attach the retrieval module to a minimal API and return the event handlers it registers. */
function attach(source = "bank") {
  const events = new Map();
  const api = {
    core: {
      CacheDefinitions: { getComponentId: () => 100, getVarpId: () => 200 },
      ItemDefinition: { forId: () => ({ getGrandExchangeValue: () => 0 }) },
      Item: class Item { constructor(id, amount, meta) { this.id = id; this.amount = amount; this.meta = meta; } },
      examineItem: () => {},
    },
    persistAttribute: () => {},
    onPlayerDeathDrops: () => {},
    onNpcsInteraction: () => {},
    onInterfaceActionButton: () => {},
    onCustomEvent: (name, handler) => events.set(name, handler),
    emitCustomEvent: (name, request) => { if (name === "gravestones:pay-fee" && source) request.source = source; },
  };
  Retrieval.attachRetrieval(api);
  return events;
}

function lotWith(player) {
  Retrieval.deathDrops({
    player,
    killer: null,
    items: [item(995, 123456), item(1135, 1)],
    untradeables: [item(4151, 1)],
  });
  return Retrieval.held(player);
}

test("a death inside the Sepulchre leaves the lost items with the Mysterious Stranger", () => {
  const p = player();
  const event = {
    player: p,
    killer: null,
    items: [item(995, 5000), item(1135, 1)],
    untradeables: [item(4151, 1)],
  };
  Retrieval.deathDrops(event);
  assert.deepEqual(event.items, []);
  assert.deepEqual(event.untradeables, []);
  assert.deepEqual(Retrieval.held(p).items.map((entry) => [entry.id, entry.amount]), [[995, 5000], [1135, 1], [4151, 1]]);
});

test("Collect charges the Stranger's 25,000-coin fee before taking items", () => {
  attach("bank");
  const p = player();
  const lot = lotWith(p);
  assert.equal(lot.paid, false);
  assert.equal(Retrieval.pay(p, lot), true);
  assert.equal(lot.paid, true, "payment stays on the lot");
  assert.ok(p.calls.configs.some(([id, value]) => id === 200 && value === 30), "if1 uses the Stranger's paid state");
  assert.deepEqual(p.calls.scripts.at(-1), [3478, [25000, 0]]);
});

test("a fee the bank or coffer cannot cover leaves the lot unpaid", () => {
  attach(null);
  const p = player();
  const lot = lotWith(p);
  assert.equal(Retrieval.pay(p, lot), false);
  assert.equal(lot.paid, false);
  assert.deepEqual(p.calls.messages, ["You don't have enough coins with you or in your bank to pay the fee."]);
});

test("the Stranger's lot answers item-retrieval:items for ownership consumers", () => {
  const events = attach();
  const p = player();
  lotWith(p);
  const request = { player: p, items: [] };
  events.get("item-retrieval:items")(request);
  assert.deepEqual(request.items, [
    { itemId: 995, amount: 123456 },
    { itemId: 1135, amount: 1 },
    { itemId: 4151, amount: 1 },
  ]);
});

test("a ranked Group Ironman wipe removes the tradeables the Stranger holds", () => {
  const events = attach();
  const p = player();
  lotWith(p);
  events.get("group-ironman:wipe-tradeables")({
    player: p,
    lost: (id) => id === 995 || id === 4151,
  });
  assert.deepEqual(Retrieval.held(p).items.map((entry) => [entry.id, entry.amount]), [[1135, 1]]);
});

test("a later unsafe death deletes the previous lot", () => {
  const p = player();
  Retrieval.deathDrops({ player: p, killer: null, items: [item(1135, 1)], untradeables: [] });
  assert.ok(Retrieval.held(p));

  p.state.areaName = "Darkmeyer";
  Retrieval.deathDrops({ player: p, killer: null, items: [item(995, 1)], untradeables: [] });
  assert.equal(Retrieval.held(p), null, "an outside death loses the old retrieval lot");
  p.state.areaName = "Hallowed Sepulchre";

  Retrieval.deathDrops({ player: p, killer: null, items: [item(1135, 1)], untradeables: [] });
  Retrieval.deathDrops({ player: p, killer: { getName: () => "killer" }, items: [item(995, 1)], untradeables: [] });
  assert.equal(Retrieval.held(p), null, "a PvP death loses the old retrieval lot");
});
