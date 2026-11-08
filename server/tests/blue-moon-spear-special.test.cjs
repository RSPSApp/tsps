// node --test tests/blue-moon-spear-special.test.cjs
// Break Shackles (OSRS Wiki Blue_moon_spear): the special removes every binding on the target, hit or miss;
// each tick removed adds 1.5% accuracy and 1.5% damage, the damage bonus capped at 112.5%.
const assert = require("node:assert/strict");
const { test } = require("node:test");

const FREEZE = Symbol("freeze");

function setup() {
  let registered = null;
  const log = { drains: [] };
  class MeleeCombatMethod { start() {} }
  const slot = (id) => ({ getId: () => id });
  const core = {
    Animation: class { constructor(id) { this.id = id; } },
    Graphic: class { constructor(id) { this.id = id; } },
    CombatSpecial: { drain: (c, amount) => log.drains.push(amount) },
    Equipment: { HEAD_SLOT: 0, BODY_SLOT: 1, LEG_SLOT: 2 },
    ItemIdentifiers: {
      BLUE_MOON_SPEAR: 1, BLUE_MOON_SPEAR_4: 2,
      BLUE_MOON_HELM: 10, BLUE_MOON_HELM_4: 11, BLUE_MOON_HELM_BROKEN_: 12, BLUE_MOON_HELM_6: 13,
      BLUE_MOON_CHESTPLATE: 20, BLUE_MOON_CHESTPLATE_4: 21, BLUE_MOON_CHESTPLATE_BROKEN_: 22, BLUE_MOON_CHESTPLATE_6: 23,
      BLUE_MOON_TASSETS: 30, BLUE_MOON_TASSETS_4: 31, BLUE_MOON_TASSETS_BROKEN_: 32, BLUE_MOON_TASSETS_6: 33,
    },
    MeleeCombatMethod,
    TimerKey: { FREEZE },
  };
  require("../plugins/combat/specials/BlueMoonSpear.SpecialAttack")({ core, registerCombatSpecial: (d) => { registered = d; } });
  const player = {
    isPlayer: () => true,
    getAsPlayer() { return this; },
    getEquipment: () => ({ getItems: () => [slot(10), slot(20), slot(30)] }),
    performAnimation() {},
    performGraphic() {},
  };
  const target = (ticks) => {
    const timers = new Map(ticks > 0 ? [[FREEZE, ticks]] : []);
    return { timers, getTimers: () => ({ left: (k) => timers.get(k) ?? 0, cancel: (k) => timers.delete(k) }) };
  };
  const hit = (accurate) => ({ getAttacker: () => player, isAccurate: () => accurate, getTotalDamage: () => (accurate ? 5 : 0) });
  return { special: registered, method: registered.combatMethod, player, target, hit, log };
}

test("each tick of binding removed adds 1.5% accuracy and damage", () => {
  const { special, method, player, target } = setup();
  method.start(player, target(20));
  const traits = special.traitsFor(player);
  assert.ok(Math.abs(traits.accuracyMultiplier - 1.3) < 1e-9);
  assert.ok(Math.abs(traits.damageMultiplier - 1.3) < 1e-9);
});

test("the damage bonus stops at 112.5%, the accuracy bonus does not", () => {
  const { special, method, player, target } = setup();
  method.start(player, target(100));
  const traits = special.traitsFor(player);
  assert.ok(Math.abs(traits.damageMultiplier - 2.125) < 1e-9);
  assert.ok(Math.abs(traits.accuracyMultiplier - 2.5) < 1e-9);
});

test("the binding is removed even when the swing misses, and the bonus ends with the swing", () => {
  const { special, method, player, target, hit } = setup();
  const bound = target(12);
  method.start(player, bound);
  assert.equal(bound.timers.has(FREEZE), false);
  method.handleAfterHitEffects(hit(false));
  assert.equal(special.traitsFor(player).accuracyMultiplier, 1);
  assert.equal(special.traitsFor(player).damageMultiplier, 1);
});

test("an unbound target gets no bonus", () => {
  const { special, method, player, target, log } = setup();
  method.start(player, target(0));
  assert.equal(special.traitsFor(player).accuracyMultiplier, 1);
  assert.equal(special.traitsFor(player).damageMultiplier, 1);
  assert.deepEqual(log.drains, [50]);
});
