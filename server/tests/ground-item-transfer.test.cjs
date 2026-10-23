const assert = require("node:assert/strict");
const {test} = require("node:test");
const {Server} = require("../dist/Server");
Server.installProductionPathResolver();
require("../dist/game/cache/CachePipeline").CachePipeline.initialize();
const {Item} = require("../dist/game/model/Item");
const {Inventory} = require("../dist/game/model/container/impl/Inventory");
const {MAX_STACK_AMOUNT} = require("../dist/game/model/container/StackType");
const {ItemOnGroundManager} = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
const {State} = require("../dist/game/entity/impl/grounditem/ItemOnGround");
const {MagicOnItemPacketListener} = require("../dist/net/packet/impl/MagicOnItemPacketListener");
const {PluginManager} = require("../dist/plugins/PluginManager");
const {World} = require("../dist/game/World");
const {Location} = require("../dist/game/model/Location");

function fixture() {
  const messages = [], xp = [], player = {getUsername: () => "GroundTransferTest", getPrivateArea: () => null,
    getLocation: () => new Location(3222, 3218), isRegistered: () => true, getHitpoints: () => 10,
    getPacketSender: () => ({sendItemContainer() {}, sendSoundEffect() {}}),
    getSkillManager: () => ({addExperiences: (...args) => xp.push(args)}),
    sendMessage: message => messages.push(message), isPlayerBot: () => false,
    getLastItemPickup: () => ({reset() {}})};
  const inventory = new Inventory(player); player.getInventory = () => inventory;
  const listener = new MagicOnItemPacketListener();
  return {player, inventory, listener, messages, xp,
    grab: pile => listener.landGroundItemGrab(player, pile.getItem().getId(), pile.getPosition())};
}

for (const [label, existing, metadata, freeSlots, expectedAdded] of [
  ["capped stack", MAX_STACK_AMOUNT, null, 27, 0],
  ["partially filled stack", MAX_STACK_AMOUNT - 2, null, 27, 2],
  ["different metadata with a full inventory", 100, {source: "old"}, 0, 0],
  ["different metadata with a free slot", MAX_STACK_AMOUNT, {source: "old"}, 1, 10],
]) test(`real Telegrab preserves a ${label}`, () => {
  const f = fixture(), items = World.getItems(), previous = items.splice(0), observed = [];
  const emit = PluginManager.emitCustomEvent;
  try {
    PluginManager.emitCustomEvent = (name, event) => { if (name === "magic:telekinetic-grab") observed.push(event); };
    f.inventory.setItem(0, new Item(995, existing, metadata));
    for (let slot = 1; slot < 28 - freeSlots; slot++) f.inventory.setItem(slot, new Item(385));
    const pile = ItemOnGroundManager.registers(f.player, new Item(995, 10));
    f.grab(pile);
    assert.equal(f.inventory.getAmount(995) - existing, expectedAdded);
    assert.equal(pile.isPendingRemoval(), expectedAdded === 10);
    const left = pile.isPendingRemoval() ? 0 : pile.getItem().getAmount();
    assert.equal(left, 10 - expectedAdded);
    assert.equal(f.inventory.getAmount(995) + left, existing + 10);
    assert.equal(observed.length, expectedAdded > 0 ? 1 : 0);
    assert.equal(f.listener.canReceiveGroundItem(f.player, new Item(995, 1)), expectedAdded === 10);
  } finally { PluginManager.emitCustomEvent = emit; items.splice(0, items.length, ...previous); }
});

test("Telegrab leaves a partially fitting nonstackable ground batch behind", () => {
  const f = fixture(), items = World.getItems(), previous = items.splice(0);
  try {
    for (let slot = 0; slot < 25; slot++) f.inventory.setItem(slot, new Item(385));
    const pile = ItemOnGroundManager.registers(f.player, new Item(385, 5));
    f.grab(pile);
    assert.equal(f.inventory.getAmount(385), 28); assert.equal(pile.getItem().getAmount(), 2);
    assert.equal(pile.isPendingRemoval(), false);
  } finally { items.splice(0, items.length, ...previous); }
});

for (const method of ["pickup", "telegrab"]) test(`${method} cannot take another owner's invisible untradeable item`, () => {
  const f = fixture(), items = World.getItems(), previous = items.splice(0);
  try {
    const pile = ItemOnGroundManager.registers(f.player, new Item(23182));
    pile.owner = "OtherPlayer"; pile.setState(State.SEEN_BY_EVERYONE);
    if (method === "telegrab") f.grab(pile); else ItemOnGroundManager.pickup(f.player, pile);
    assert.equal(f.inventory.getAmount(23182), 0); assert.equal(pile.isPendingRemoval(), false);
  } finally { items.splice(0, items.length, ...previous); }
});

test("invisible walking requests cannot invoke handled pickup hooks", t => {
  const f = fixture(), items = World.getItems(), previous = items.splice(0);
  let calls = 0;
  t.mock.method(PluginManager, "emitGroundItemPickup", () => { calls++; return true; });
  try {
    const pile = ItemOnGroundManager.registers(f.player, new Item(23182));
    pile.owner = "OtherPlayer"; pile.setState(State.SEEN_BY_EVERYONE);
    ItemOnGroundManager.pickup(f.player, pile);
    assert.equal(calls, 0, "an invisible item cannot trigger quest or other pickup effects");
    assert.equal(pile.isPendingRemoval(), false);
    assert.equal(f.inventory.getAmount(23182), 0);
  } finally { items.splice(0, items.length, ...previous); }
});
