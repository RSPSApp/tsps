// Run after `yarn build`: node --test tests/poison-orb.test.cjs
// The hitpoints orb reads varp 102 (`poison`), encoded as rsprox captures show it.
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CombatPoisonEffect } = require("../dist/game/task/impl/CombatPoisonEffect");

function mobile({ venomed = false, damage = 0, immunitySeconds = 0 } = {}) {
  return {
    isVenomed: () => venomed && damage > 0,
    isPoisoned: () => damage > 0,
    getPoisonDamage: () => damage,
    getCombat: () => ({ getPoisonImmunityTimer: () => ({ secondsRemaining: () => immunitySeconds }) }),
  };
}

test("poison shows its severity, venom 1,000,000 plus its hits, immunity its 18-second steps", () => {
  assert.equal(CombatPoisonEffect.ORB_VARP, 102);
  assert.equal(CombatPoisonEffect.orbValue(mobile()), 0);
  assert.equal(CombatPoisonEffect.orbValue(mobile({ damage: 10 })), 10, "captured: 10, then 9 after a hit");
  assert.equal(CombatPoisonEffect.orbValue(mobile({ venomed: true, damage: 6 })), 1000000, "captured: venom starts at 1,000,000");
  assert.equal(CombatPoisonEffect.orbValue(mobile({ venomed: true, damage: 10 })), 1000002, "two hits in");
  assert.equal(CombatPoisonEffect.orbValue(mobile({ immunitySeconds: 360 })), -20, "captured: a superantipoison dose is -20");
  assert.equal(CombatPoisonEffect.orbValue(mobile({ immunitySeconds: 90 })), -5, "captured: antipoison is -5");
  assert.equal(CombatPoisonEffect.orbValue(mobile({ immunitySeconds: 2 })), 0, "a serpentine helm's refresh is left out");
});

test("the orb's Cure says so when nothing in the pack can cure, and does nothing unpoisoned", () => {
  const Potions = require("../plugins/items/Potions.plugin");
  const messages = [];
  const player = (poisoned) => ({
    isPoisoned: () => poisoned,
    isVenomed: () => false,
    getInventory: () => ({ getItems: () => [{ getId: () => 995 }, null] }),
    sendMessage: (text) => messages.push(text),
  });
  Potions._test.cureFromHealthOrb({ player: player(false) });
  assert.deepEqual(messages, []);
  Potions._test.cureFromHealthOrb({ player: player(true) });
  assert.deepEqual(messages, ["You haven't got anything capable of curing your poison."], "captured");
});
