// Run after `yarn build`: node --test tests/abyssal-tentacle.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIds } = require("../dist/util/IdEnums");

const AbyssalTentacle = require("../plugins/items/AbyssalTentacle.plugin");

const poisoned = [];
AbyssalTentacle.register({
  core: {
    Equipment,
    ItemIdentifiers: ItemIds,
    CombatFactory: { poisonEntity: (target, severity, orb) => poisoned.push({ target, severity, orb }) },
  },
  onCombatHitResolved() {},
});

function item(id) {
  return {
    id,
    getId() { return this.id; },
    setId(next) { this.id = next; },
  };
}

function createPlayer(weapon = null) {
  const equipment = new Array(14).fill(null).map(() => item(0));
  if (weapon) equipment[Equipment.WEAPON_SLOT] = weapon;
  return {
    getEquipment: () => ({ getItems: () => equipment }),
    isPlayer: () => true,
    getAsPlayer() { return this; },
  };
}

function strike(player, { accurate = true, damage = 5 } = {}) {
  AbyssalTentacle._test.onHitResolved({
    attacker: player,
    target: {},
    hit: { isAccurate: () => accurate, getTotalDamage: () => damage },
  });
}

test("a successful hit has a 25% chance to poison for 4 damage", () => {
  poisoned.length = 0;
  const player = createPlayer(item(ItemIds.ABYSSAL_TENTACLE));
  const original = Math.random;
  try {
    Math.random = () => 0.24;
    strike(player);
    assert.equal(poisoned.length, 1);
    assert.equal(poisoned[0].severity, 4);
    assert.equal(poisoned[0].orb, 1);
    Math.random = () => 0.9;
    strike(player);
    assert.equal(poisoned.length, 1, "outside the 25% roll");
  } finally {
    Math.random = original;
  }
});

test("the abyssal tentacle (or) also poisons", () => {
  poisoned.length = 0;
  const player = createPlayer(item(ItemIds.ABYSSAL_TENTACLE_OR_));
  const original = Math.random;
  try {
    Math.random = () => 0.01;
    strike(player);
    assert.equal(poisoned.length, 1);
    assert.equal(poisoned[0].severity, 4);
    assert.equal(poisoned[0].orb, 1);
  } finally {
    Math.random = original;
  }
});

test("misses and zero-damage hits do not roll, and an unwielded tentacle never poisons", () => {
  poisoned.length = 0;
  const player = createPlayer(item(ItemIds.ABYSSAL_TENTACLE));
  const original = Math.random;
  try {
    Math.random = () => 0;
    strike(player, { accurate: false });
    strike(player, { damage: 0 });
    strike(createPlayer());
    assert.equal(poisoned.length, 0);
  } finally {
    Math.random = original;
  }
});
