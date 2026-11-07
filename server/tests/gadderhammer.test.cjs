// Run after `yarn build`: node --test tests/gadderhammer.test.cjs
// The gadderhammer against shades: +25% damage, or double damage 1 time in 20 (Wiki: Gadderhammer).
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { Misc } = require("../dist/util/Misc");
const EquipmentEffects = require("../plugins/combat/EquipmentEffects.plugin");

const NAMES = new Map([
  [ItemIdentifiers.GADDERHAMMER, "Gadderhammer"],
  [ItemIdentifiers.SALVE_AMULET_E_, "Salve amulet (e)"],
  [ItemIdentifiers.GRANITE_MAUL, "Granite maul"],
]);
ItemDefinition.forId = (id) => ({ getName: () => NAMES.get(id) ?? "" });

function target(attributes) {
  return {
    isNpc: () => true,
    getAsNpc: () => ({
      getCurrentDefinition: () => ({ isUndead: () => attributes.includes("undead"), hasAttribute: (a) => attributes.includes(a) }),
    }),
  };
}

function createPlayer({ weapon = ItemIdentifiers.GADDERHAMMER, amulet = -1, attributes = ["shade"] } = {}) {
  const items = new Array(14).fill(null).map(() => ({ getId: () => -1 }));
  items[Equipment.WEAPON_SLOT] = { getId: () => weapon };
  items[Equipment.AMULET_SLOT] = { getId: () => amulet };
  return {
    isPlayer: () => true,
    getAsPlayer() { return this; },
    getEquipment: () => ({ getItems: () => items, get: (slot) => items[slot] }),
    getCombat: () => ({ getTarget: () => target(attributes) }),
  };
}

// Registers the real EquipmentEffects plugin and chains every melee hit modifier it attaches.
const meleeHitModifiers = [];
const noop = () => {};
EquipmentEffects.register(new Proxy({
  registerMeleeHitModifier: (fn) => meleeHitModifiers.push(fn),
  onCustomEvent: noop,
  emitCustomEvent: noop,
}, { get: (api, name) => api[name] ?? noop }));
const meleeHit = (player, maxHit) => meleeHitModifiers.reduce((hit, modifier) => modifier(player, hit), maxHit);

function withRoll(t, roll) {
  t.mock.method(Misc, "randomInclusive", (min, max) => {
    assert.deepEqual([min, max], [1, 20], "a 1 in 20 chance");
    return roll;
  });
}

test("a gadderhammer deals 25% more against a shade", (t) => {
  withRoll(t, 2);
  assert.equal(meleeHit(createPlayer(), 40), 50);
  assert.equal(meleeHit(createPlayer(), 11), 13, "rounded down");
});

test("a gadderhammer doubles the damage on a 1 in 20 roll instead of adding 25%", (t) => {
  withRoll(t, 1);
  assert.equal(meleeHit(createPlayer(), 40), 80);
});

test("no bonus against other monsters, other weapons or without the hammer", (t) => {
  withRoll(t, 1);
  assert.equal(meleeHit(createPlayer({ attributes: ["undead"] }), 40), 40, "a catacombs shade has no shade attribute");
  assert.equal(meleeHit(createPlayer({ attributes: [] }), 40), 40);
  assert.equal(meleeHit(createPlayer({ weapon: ItemIdentifiers.GRANITE_MAUL }), 40), 40);
});

test("the bonus stacks with a salve amulet (e) against an undead shade", (t) => {
  withRoll(t, 2);
  const player = createPlayer({ amulet: ItemIdentifiers.SALVE_AMULET_E_, attributes: ["shade", "undead"] });
  assert.equal(meleeHit(player, 40), 60, "40 x 6/5 x 5/4");
});
