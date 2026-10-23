const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
CachePipeline.initialize();
const { Item } = require("../dist/game/model/Item");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { MAX_STACK_AMOUNT } = require("../dist/game/model/container/StackType");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
const { World } = require("../dist/game/World");
const { Location } = require("../dist/game/model/Location");

function fixture() {
  const player = {sendMessage() {}, getPacketSender: () => ({sendItemContainer() {}, sendSoundEffect() {}}),
    isPlayerBot: () => false, getLastItemPickup: () => ({reset() {}}),
    getUsername: () => "RewardOverflowTest", getLocation: () => new Location(3222, 3218), getPrivateArea: () => null};
  const inventory = new Inventory(player);
  player.getInventory = () => inventory;
  return {player, inventory};
}

test("forced stack rewards fill the stack and drop its exact overflow without mutating the reward", () => {
  const f = fixture(), ground = [];
  f.inventory.setItem(0, new Item(995, MAX_STACK_AMOUNT - 2));
  for (let slot = 1; slot < 28; slot++) f.inventory.setItem(slot, new Item(385));
  const reward = new Item(995, 10);
  const register = ItemOnGroundManager.registers;
  try {
    ItemOnGroundManager.registers = (_player, item) => { ground.push(item.clone()); item.setAmount(1234); };
    f.inventory.forceAdd(f.player, reward);
  } finally { ItemOnGroundManager.registers = register; }
  assert.equal(f.inventory.getAmount(995), MAX_STACK_AMOUNT);
  assert.deepEqual(ground.map(item => [item.getId(), item.getAmount()]), [[995, 8]]);
  assert.equal(reward.getAmount(), 10);
});

for (const [label, existing, metadata, freeSlots, expectedAdded] of [
  ["capped stack", MAX_STACK_AMOUNT, null, 27, 0],
  ["partially filled stack", MAX_STACK_AMOUNT - 2, null, 27, 2],
  ["different metadata in a full inventory", 100, {source: "other"}, 0, 0],
  ["different metadata with a free slot", MAX_STACK_AMOUNT, {source: "other"}, 1, 10],
]) {
  test(`real ground pickup preserves coins with a ${label}`, () => {
    const f = fixture(), items = World.getItems(), previous = items.splice(0);
    try {
      f.inventory.setItem(0, new Item(995, existing, metadata));
      for (let slot = 1; slot < 28 - freeSlots; slot++) f.inventory.setItem(slot, new Item(385));
      const pile = ItemOnGroundManager.registers(f.player, new Item(995, 10));
      ItemOnGroundManager.pickup(f.player, pile);
      const added = f.inventory.getItems().filter(item => item.getId() === 995 && !item.getMeta())
        .reduce((sum, item) => sum + item.getAmount(), 0) - (metadata ? 0 : existing);
      assert.equal(added, expectedAdded);
      assert.equal(pile.isPendingRemoval(), expectedAdded === 10);
      if (!pile.isPendingRemoval()) assert.equal(pile.getItem().getAmount(), 10 - expectedAdded);
      assert.equal(f.inventory.getAmount(995) + (pile.isPendingRemoval() ? 0 : pile.getItem().getAmount()), existing + 10);
    } finally { items.splice(0, items.length, ...previous); }
  });
}

test("partially fitting nonstackable rewards retain the rest on the ground", () => {
  const f = fixture(), ground = [];
  for (let slot = 0; slot < 25; slot++) f.inventory.setItem(slot, new Item(385));
  const register = ItemOnGroundManager.registers;
  try {
    ItemOnGroundManager.registers = (_player, item) => ground.push(item.clone());
    f.inventory.forceAdd(f.player, new Item(385, 5));
  } finally { ItemOnGroundManager.registers = register; }
  assert.equal(f.inventory.getAmount(385), 28);
  assert.deepEqual(ground.map(item => [item.getId(), item.getAmount()]), [[385, 2]]);
});

test("a full inventory cannot silently discard a reward with different stack metadata", () => {
  const f = fixture(), ground = [];
  f.inventory.setItem(0, new Item(995, 100, {source: "existing"}));
  for (let slot = 1; slot < 28; slot++) f.inventory.setItem(slot, new Item(385));
  const register = ItemOnGroundManager.registers;
  try {
    ItemOnGroundManager.registers = (_player, item) => ground.push(item.clone());
    f.inventory.forceAdd(f.player, new Item(995, 10, {source: "reward"}));
  } finally { ItemOnGroundManager.registers = register; }
  assert.equal(f.inventory.getAmount(995), 100);
  assert.equal(ground[0]?.getAmount(), 10);
  assert.deepEqual(ground[0]?.getMeta(), {source: "reward"});
});

test("real ground registration keeps a second pile when a merge would exceed the stack limit", () => {
  const f = fixture(), items = World.getItems(), previous = items.splice(0);
  try {
    ItemOnGroundManager.registers(f.player, new Item(995, MAX_STACK_AMOUNT - 2));
    ItemOnGroundManager.registers(f.player, new Item(995, 10));
    assert.equal(items.reduce((sum, entry) => sum + entry.getItem().getAmount(), 0), MAX_STACK_AMOUNT + 8);
    assert.ok(items.every(entry => entry.getItem().getAmount() <= MAX_STACK_AMOUNT));
  } finally { items.splice(0, items.length, ...previous); }
});

test("real ground registration does not combine reward stacks with different metadata", () => {
  const f = fixture(), items = World.getItems(), previous = items.splice(0);
  try {
    ItemOnGroundManager.registers(f.player, new Item(995, 10, {source: "first"}));
    ItemOnGroundManager.registers(f.player, new Item(995, 20, {source: "second"}));
    assert.deepEqual(items.map(entry => [entry.getItem().getAmount(), entry.getItem().getMeta()]), [
      [10, {source: "first"}], [20, {source: "second"}],
    ]);
  } finally { items.splice(0, items.length, ...previous); }
});
