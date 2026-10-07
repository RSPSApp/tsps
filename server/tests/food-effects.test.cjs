// Run after `yarn build`: node --test tests/food-effects.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { ItemIds } = require("../dist/util/IdEnums");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { Location } = require("../dist/game/model/Location");
const Food = require("../plugins/items/Food.plugin");

test("food lookup rejects missing and invalid IDs, noted food and non-food items", () => {
  for (const id of [undefined, null, NaN, {}, -1, String(ItemIdentifiers.SHARK), 385.5,
    ItemIdentifiers.SHARK_2, ItemIdentifiers.COINS]) {
    assert.equal(Food.isFoodItem(id), false, `non-edible item ID ${String(id)}`);
  }
  assert.equal(Food.isFoodItem(ItemIdentifiers.SHARK), true);
});

test("strawberries heal 1 + 6% of max hitpoints, capped at six", () => {
  assert.equal(Food._test.getStrawberryHeal(10), 1);
  assert.equal(Food._test.getStrawberryHeal(17), 2);
  assert.equal(Food._test.getStrawberryHeal(50), 4);
  assert.equal(Food._test.getStrawberryHeal(84), 6);
  assert.equal(Food._test.getStrawberryHeal(99), 6);
});

test("sandwich refreshments are edible and meat pie retains both bites and its dish", () => {
  for (const id of [ItemIdentifiers.BAGUETTE, ItemIdentifiers.TRIANGLE_SANDWICH,
    ItemIdentifiers.SQUARE_SANDWICH, ItemIdentifiers.ROLL, ItemIdentifiers.MEAT_PIE,
    ItemIdentifiers.HALF_A_MEAT_PIE]) assert.equal(Food.FOOD.get(id)?.heal, 6);
  assert.equal(Food.FOOD.get(ItemIdentifiers.CHOCOLATE_BAR)?.heal, 3);
  assert.equal(Food.FOOD.get(ItemIdentifiers.SPINACH_ROLL)?.heal, 2);
  assert.equal(Food.FOOD.get(ItemIdentifiers.MEAT_PIE).replacementId, ItemIdentifiers.HALF_A_MEAT_PIE);
  assert.equal(Food.FOOD.get(ItemIdentifiers.HALF_A_MEAT_PIE).replacementId, ItemIdentifiers.PIE_DISH);
  assert.equal(Food.isFoodItem(ItemIdentifiers.STALE_BAGUETTE), false);
});

test("gnome crunchies and battas are combo foods with their Wiki heals", () => {
  const expected = [
    [ItemIds.WORM_CRUNCHIES, 8],
    [ItemIdentifiers.CHOCCHIP_CRUNCHIES, 7],
    [ItemIdentifiers.SPICY_CRUNCHIES, 7],
    [ItemIdentifiers.TOAD_CRUNCHIES, 8],
    [ItemIdentifiers.WORM_BATTA, 11],
    [ItemIdentifiers.TOAD_BATTA, 11],
    [ItemIdentifiers.CHEESE_TOM_BATTA, 11],
    [ItemIdentifiers.FRUIT_BATTA, 11],
    [ItemIdentifiers.VEGETABLE_BATTA, 11],
  ];
  for (const [id, heal] of expected) {
    const food = Food.FOOD.get(id);
    assert.ok(food, `food ${id} registered`);
    assert.equal(food.heal, heal, `food ${id} heal`);
    assert.equal(food.karambwan, true, `food ${id} is combo food`);
  }
});

function inCombatAt(x, y, target = null, attacker = null) {
  return {
    getLocation: () => new Location(x, y, 0),
    getCombat: () => ({ getTarget: () => target, getAttacker: () => attacker }),
  };
}

test("anglerfish cannot over-heal while in combat in a PvP area", () => {
  assert.equal(Food._test.canAnglerfishOverheal(inCombatAt(3200, 3600)), true, "idle in the Wilderness");
  assert.equal(Food._test.canAnglerfishOverheal(inCombatAt(3200, 3600, {})), false, "fighting an NPC");
  assert.equal(Food._test.canAnglerfishOverheal(inCombatAt(3200, 3600, null, {})), false, "being attacked");
  assert.equal(Food._test.canAnglerfishOverheal(inCombatAt(3222, 3222, {})), true, "Edgeville is not a PvP area");
});

test("eating Strange Fruit restores energy, cures poison/venom, preserves overheal and obeys slot/cooldown guards", t => {
  const { TimerKey } = require('../dist/util/timers/TimerKey');
  const { Sounds } = require('../dist/game/Sounds');
  const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
  t.mock.method(Sounds, 'sendSound', () => {});
  t.mock.method(ItemDefinition, 'forId', () => ({ getName: () => 'Strange fruit' }));
  let eat, allowed = true, hp = 115, energy = 85, poisoned = 12, venomed = true, immunity = 0, used = 0;
  const timers = new Set(), slots = [null, { getId: () => ItemIdentifiers.STRANGE_FRUIT }];
  const inventory = { capacity: () => 28, getItems: () => slots, deleteAtSlot(slot) { slots[slot] = null; used++; }, refreshItems() {} };
  const p = { getInventory: () => inventory, getTimers: () => ({ has: key => timers.has(key), extendOrRegister: key => timers.add(key) }),
    getCombat: () => ({ delayAttack() {}, getPoisonImmunityTimer: () => ({ secondsRemaining: () => immunity, start: seconds => { immunity = seconds; } }) }),
    getPacketSender: () => ({ sendInterfaceRemoval() {}, sendRunEnergy() {}, sendPoisonType() {} }),
    getSkillManager: () => ({ stopSkillable() {}, getCurrentLevel: () => hp, getMaxLevel: () => 99 }),
    setHitpoints(value) { hp = value; }, getRunEnergy: () => energy, setRunEnergy: value => { energy = value; },
    setPoisonDamage: value => { poisoned = value; }, setVenomed: value => { venomed = value; },
    performAnimation() {}, sendMessage() {} };
  Food.register({ onItemFirstAction: cb => { eat = cb; }, emitCanEat: () => allowed, emitCustomEvent() {}, log() {} });
  const click = slot => eat({ player: p, itemId: ItemIdentifiers.STRANGE_FRUIT, slot });
  click(0); assert.equal(used, 0); assert.equal(energy, 85);
  allowed = false; click(1); assert.equal(used, 0); allowed = true;
  timers.add(TimerKey.FOOD); click(1); assert.equal(used, 0); timers.clear();
  click(1); click(1);
  assert.equal(used, 1); assert.equal(energy, 100); assert.equal(hp, 115);
  assert.equal(poisoned, 0); assert.equal(venomed, false); assert.equal(immunity, 18);
  timers.clear(); slots[1] = { getId: () => ItemIdentifiers.STRANGE_FRUIT }; immunity = 120; energy = 10;
  click(1); assert.equal(used, 2); assert.equal(energy, 40); assert.equal(immunity, 120);
});
