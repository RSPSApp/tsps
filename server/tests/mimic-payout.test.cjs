const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
CachePipeline.initialize();
const { PluginManager } = require("../dist/plugins/PluginManager");
const core = PluginManager.getCoreApi();
const Shared = require("../plugins/bosses/mimic/Shared.Mimic");
const State = require("../plugins/bosses/mimic/State.Mimic");
const Reward = require("../plugins/bosses/mimic/Reward.Mimic");

test("every imported normal and Mimic reward resolves against the installed cache, including note variants", () => {
  const normal = require("../data/definitions/clue-caskets.json").tables;
  const bonus = require("../plugins/bosses/data/reward-tables.json").tables;
  for (const tier of ["elite", "master"]) {
    for (const row of [...normal[tier].entries, ...bonus[`the_mimic_${tier}`].entries]) {
      const definition = core.ItemDefinition.forId(row.item_id);
      assert.ok(definition?.getName() && definition.getName() !== "null", `${tier}: ${row.name}`);
      if (row.noted) {
        assert.ok(definition.getNoteId() > 0, `Missing note: ${row.name}`);
        assert.ok(core.ItemDefinition.forId(definition.getNoteId()).isStackable(), row.name);
      }
    }
  }
});

function fixture(tier, clueRolls, spent = 0, service = true) {
  const events = new Map(), attributes = new Map(), messages = [], obtained = [];
  const item = new core.Item(core.ItemIdentifiers.MIMIC);
  const items = [item];
  const inventory = { getItems: () => items, getSlotForItemId: id => items.findIndex(item => item?.getId() === id),
    deleteAtSlot(slot) { items[slot] = null; }, refreshItems() {},
    forceAdd(_player, reward) { obtained.push(reward); },
  };
  const player = {getInventory: () => inventory, getAttribute: key => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value), sendMessage: text => messages.push(text),
    isRegistered: () => true, getHitpoints: () => 10, getArea: () => null};
  const api = {core, persistAttribute() {}, onItemAction() {},
    onCustomEvent(name, handler) { if (!events.has(name)) events.set(name, []); events.get(name).push(handler); },
    emitCustomEvent(name, request) { for (const handler of events.get(name) ?? []) handler(request); },
  };
  Shared.bind(api);
  if (service) require("../plugins/treasuretrails/RewardCaskets.plugin").register(api);
  Reward.attach(api);
  State.initialize(item, tier, clueRolls);
  const record = State.ensure(player, item);
  for (let i = 0; i < spent; i++) State.spend(player, item, record.id);
  State.defeat(player, item, record.id);
  return {player, item, items, api, messages, obtained, attributes, events,
    open: () => Reward.openMimic({player, item, slot: 0}),
    amount: id => obtained.filter(item => item.getId() === id).reduce((sum, item) => sum + item.getAmount(), 0)};
}

for (const [tier, clueRolls, normalId, amounts] of [
  ["elite", 4, 1079, [600, 480, 360, 240, 120]],
  ["master", 7, 1434, [600, 500, 400, 300, 200, 100]],
]) {
  for (let spent = 0; spent < amounts.length; spent++) test(`${tier} payout after ${spent} failures keeps base rolls and awards exactly one scaled bonus`, () => {
    const f = fixture(tier, clueRolls, spent);
    const original = Math.random;
    try { Math.random = () => 0.1; f.open(); } finally { Math.random = original; }
    assert.equal(f.items[0], null);
    assert.equal(f.amount(normalId), Math.max(0, clueRolls - spent));
    assert.equal(f.amount(560), amounts[spent]);
    assert.equal(f.amount(8782), 1);
    assert.equal(f.messages.filter(message => message.includes("little extra reward")).length, 1);
  });
}

test("missing reward service preserves the Mimic and its won state", () => {
  const f = fixture("master", 7, 0, false);
  f.open();
  assert.equal(f.items[0], f.item);
  assert.equal(State.forOpen(f.player, f.item).defeated, true);
  assert.equal(f.obtained.length, 0);
});

test("invalid selected reward definition fails before casket consumption", () => {
  const f = fixture("elite", 4);
  const original = core.ItemDefinition.forId, random = Math.random;
  try {
    core.ItemDefinition.forId = id => id === 560 ? null : original(id);
    Math.random = () => 0.1;
    f.open();
  } finally { core.ItemDefinition.forId = original; Math.random = random; }
  assert.equal(f.items[0], f.item);
  assert.equal(f.obtained.length, 0);
  assert.equal(State.forOpen(f.player, f.item).defeated, true);
});

test("a reward-service callback cannot open the same casket twice", () => {
  const f = fixture("elite", 4);
  const emit = f.api.emitCustomEvent;
  let reentered = false;
  f.api.emitCustomEvent = (name, request) => {
    if (name === "treasure-trails:roll-casket" && !reentered) { reentered = true; f.open(); }
    emit(name, request);
  };
  const random = Math.random;
  try { Math.random = () => 0.1; f.open(); } finally { Math.random = random; }
  assert.equal(f.amount(1079), 4);
  assert.equal(f.amount(560), 600);
  assert.equal(f.amount(8782), 1);
});

test("a missing noted variant preserves the casket rather than substituting unnoted supplies", () => {
  const f = fixture("elite", 4);
  const original = core.ItemDefinition.forId, random = Math.random;
  try {
    core.ItemDefinition.forId = id => id === 207 ? Object.assign(Object.create(original(id)), {getNoteId: () => -1}) : original(id);
    Math.random = () => 0.5;
    f.open();
  } finally { core.ItemDefinition.forId = original; Math.random = random; }
  assert.equal(f.items[0], f.item);
  assert.equal(f.obtained.length, 0);
});

test("a moved source casket cannot consume another item or award the prepared loot", () => {
  const f = fixture("master", 7);
  const emit = f.api.emitCustomEvent;
  f.api.emitCustomEvent = (name, request) => {
    emit(name, request);
    if (name === "treasure-trails:roll-casket") f.items[0] = new core.Item(995, 123);
  };
  f.open();
  assert.equal(f.items[0].getId(), 995);
  assert.equal(f.items[0].getAmount(), 123);
  assert.equal(f.obtained.length, 0);
  assert.equal(State.forOpen(f.player, f.item).defeated, true);
});

test("the real cache DEFAULT fallback cannot turn an unresolved reward ID into loot", () => {
  const f = fixture("elite", 4);
  const missing = core.CacheDefinitions.getCounts().items + 1;
  assert.equal(core.ItemDefinition.forId(missing), core.ItemDefinition.DEFAULT);
  const emit = f.api.emitCustomEvent;
  f.api.emitCustomEvent = (name, request) => {
    emit(name, request);
    if (name === "treasure-trails:roll-casket") request.drops = [{itemId: missing, amount: 1, noted: false}];
  };
  f.open();
  assert.equal(f.items[0], f.item);
  assert.equal(f.obtained.length, 0);
});

test("a missing note definition using the real DEFAULT fallback preserves the casket", () => {
  const f = fixture("elite", 4);
  const missing = core.CacheDefinitions.getCounts().items + 1;
  const original = core.ItemDefinition.forId, random = Math.random;
  try {
    core.ItemDefinition.forId = id => id === 207 ? Object.assign(Object.create(original(id)), {getNoteId: () => missing}) : original(id);
    Math.random = () => 0.5;
    f.open();
  } finally { core.ItemDefinition.forId = original; Math.random = random; }
  assert.equal(f.items[0], f.item);
  assert.equal(f.obtained.length, 0);
});

test("opening into a nearly capped real Coins stack preserves every coin as inventory or ground loot", () => {
  const { Inventory } = require("../dist/game/model/container/impl/Inventory");
  const { MAX_STACK_AMOUNT } = require("../dist/game/model/container/StackType");
  const f = fixture("elite", 4), ground = [];
  f.player.getPacketSender = () => ({sendItemContainer() {}, sendSubInterface() {}, sendInterfaceScript() {}});
  const inventory = new Inventory(f.player);
  f.player.getInventory = () => inventory;
  inventory.setItem(0, f.item);
  inventory.setItem(1, new core.Item(995, MAX_STACK_AMOUNT - 5));
  for (let slot = 2; slot < 28; slot++) inventory.setItem(slot, new core.Item(385));
  const register = core.ItemOnGroundManager.registers, random = Math.random;
  try {
    core.ItemOnGroundManager.registers = (_player, item) => ground.push(item.clone());
    Math.random = () => 0.8; // Four real normal-pool Coins outcomes, 28,000 each.
    f.open();
  } finally { core.ItemOnGroundManager.registers = register; Math.random = random; }
  assert.equal(inventory.contains(23184), false);
  assert.equal(inventory.getAmount(995), MAX_STACK_AMOUNT);
  assert.equal(ground.filter(item => item.getId() === 995).reduce((sum, item) => sum + item.getAmount(), 0), 111995);
});
