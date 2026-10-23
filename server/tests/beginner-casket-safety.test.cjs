const assert = require("node:assert/strict");
const {test} = require("node:test");
const {Server} = require("../dist/Server");
Server.installProductionPathResolver();
require("../dist/game/cache/CachePipeline").CachePipeline.initialize();
const core = require("../dist/plugins/PluginManager").PluginManager.getCoreApi();
const {Inventory} = require("../dist/game/model/container/impl/Inventory");
const Rewards = require("../plugins/treasuretrails/Rewards.BeginnerTreasureTrails");
const Runtime = require("../plugins/treasuretrails/Runtime.BeginnerTreasureTrails");

function fixture(completed = 0) {
  const attributes = new Map([[Runtime.COMPLETED_ATTRIBUTE, completed]]), events = new Map(), messages = [], packets = [];
  const sender = new Proxy({}, {get: (_, name) => (...args) => packets.push([name, ...args])});
  const player = {getAttribute: key => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => sender, getLocation: () => new core.Location(3222, 3218),
    getBank: () => ({getItems: () => []}), getUsername: () => "BeginnerCasketSafety",
    sendMessage: message => messages.push(message)};
  const inventory = new Inventory(player); player.getInventory = () => inventory;
  const api = new Proxy({core,
    onCustomEvent(name, fn) { if (!events.has(name)) events.set(name, []); events.get(name).push(fn); },
    emitCustomEvent(name, request) { for (const fn of events.get(name) ?? []) fn(request); },
  }, {get: (target, key) => target[key] ?? (() => {})});
  require("../plugins/treasuretrails/BeginnerTreasureTrails.plugin").register(api);
  require("../plugins/treasuretrails/ClueCapacity.plugin").register(api);
  const casket = new core.Item(core.ItemIdentifiers.REWARD_CASKET_BEGINNER_);
  inventory.setItem(0, casket);
  const event = {player, slot: 0, itemId: casket.getId(), item: casket};
  return {player, inventory, casket, event, api, events, attributes, messages, packets,
    open() { const random = Math.random; try { Math.random = () => 0; return Rewards.open(event); } finally { Math.random = random; } },
    preserved() { assert.equal(inventory.getItems()[0], casket); assert.equal(casket.getAmount(), 1);
      assert.equal(attributes.get(Runtime.COMPLETED_ATTRIBUTE), completed); assert.equal(inventory.getFreeSlots(), 27); },
  };
}

test("an actual DEFAULT fallback in added reward data preserves the beginner casket and completion count", () => {
  const f = fixture(49), invalidId = core.CacheDefinitions.getCounts().items + 1;
  assert.equal(core.ItemDefinition.forId(invalidId), core.ItemDefinition.DEFAULT);
  f.api.onCustomEvent("treasure-trails:milestone-rewards", request => request.drops.push({itemId: invalidId, amount: 1, noted: false}));
  assert.doesNotThrow(() => f.open()); f.preserved();
});

test("missing normal and milestone cache definitions are rejected before consuming anything", () => {
  for (const id of [Rewards.TABLE.entries[0].item_id, core.ItemIdentifiers.MINOR_BEGINNER_SCROLL_CASE]) {
    const f = fixture(49), original = core.ItemDefinition.forId;
    try { core.ItemDefinition.forId = requested => requested === id ? core.ItemDefinition.DEFAULT : original(requested);
      assert.doesNotThrow(() => f.open()); }
    finally { core.ItemDefinition.forId = original; }
    f.preserved();
  }
});

test("a missing credited note definition cannot consume a beginner casket", () => {
  const f = fixture(), invalidId = core.CacheDefinitions.getCounts().items + 1;
  const coal = core.ItemDefinition.forId(core.ItemIdentifiers.COAL), original = coal.getNoteId;
  f.api.onCustomEvent("treasure-trails:milestone-rewards", request => request.drops.push({itemId: coal.getId(), amount: 5, noted: true}));
  try { coal.getNoteId = () => invalidId; assert.doesNotThrow(() => f.open()); }
  finally { coal.getNoteId = original; }
  f.preserved();
});

test("an absent or failing milestone service preserves the casket and progress", () => {
  for (const failure of [false, true]) {
    const f = fixture(49);
    const handlers = f.events.get("treasure-trails:milestone-rewards");
    f.events.set("treasure-trails:milestone-rewards", failure ? [() => { throw new Error("Fixture service failure"); }] : []);
    assert.doesNotThrow(() => f.open()); f.preserved();
    f.events.set("treasure-trails:milestone-rewards", handlers);
    f.open(); assert.equal(f.attributes.get(Runtime.COMPLETED_ATTRIBUTE), 50);
    assert.equal(f.inventory.getAmount(core.ItemIdentifiers.MINOR_BEGINNER_SCROLL_CASE), 1);
  }
});

test("valid noted rewards credit the cache note while collection logging records the base item", () => {
  const f = fixture(), coalId = core.ItemIdentifiers.COAL, noteId = core.ItemDefinition.forId(coalId).getNoteId(), logged = [];
  f.api.onCustomEvent("treasure-trails:milestone-rewards", request => request.drops.push({itemId: coalId, amount: 5, noted: true}));
  f.api.onCustomEvent("collection-log:obtain", request => logged.push(request));
  f.open();
  assert.equal(f.inventory.getAmount(noteId), 5); assert.equal(f.inventory.getAmount(coalId), 0);
  assert.ok(logged.some(row => row.itemId === coalId && row.amount === 5));
  assert.equal(f.attributes.get(Runtime.COMPLETED_ATTRIBUTE), 1);
});

test("moving the source casket during reward preparation cannot delete its replacement", () => {
  const f = fixture();
  f.api.onCustomEvent("treasure-trails:milestone-rewards", () => {
    f.inventory.setItem(1, f.casket); f.inventory.setItem(0, new core.Item(core.ItemIdentifiers.SHARK));
  });
  f.open();
  assert.equal(f.inventory.getItems()[0].getId(), core.ItemIdentifiers.SHARK);
  assert.equal(f.inventory.getItems()[1], f.casket);
  assert.equal(f.attributes.get(Runtime.COMPLETED_ATTRIBUTE), 0);
  assert.equal(f.inventory.getFreeSlots(), 26);
});

test("reentrant preparation opens one casket once and credits its real milestone case", () => {
  const f = fixture(49); let callbacks = 0;
  f.api.onCustomEvent("treasure-trails:milestone-rewards", () => { callbacks++; Rewards.open(f.event); });
  f.open();
  assert.equal(callbacks, 1); assert.equal(f.attributes.get(Runtime.COMPLETED_ATTRIBUTE), 50);
  assert.equal(f.inventory.getAmount(core.ItemIdentifiers.MINOR_BEGINNER_SCROLL_CASE), 1);
  assert.equal(f.inventory.getAmount(core.ItemIdentifiers.REWARD_CASKET_BEGINNER_), 0);
});

test("invalid saved completion counts preserve the casket rather than reset or overflow progress", () => {
  for (const value of [-1, NaN, Number.MAX_SAFE_INTEGER]) {
    const f = fixture(value); assert.doesNotThrow(() => f.open()); f.preserved();
  }
});
