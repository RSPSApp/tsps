// Run after `yarn build`: node --test tests/abyssal-tentacle.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIds } = require("../dist/util/IdEnums");

const AbyssalTentacle = require("../plugins/items/AbyssalTentacle.plugin");

const poisoned = [];
const itemActions = {};
const CombatType = { MELEE: "melee", MAGIC: "magic" };
AbyssalTentacle.register({
  core: {
    CombatType,
    Equipment,
    Flag: { APPEARANCE: "appearance" },
    Item: class { constructor(id, amount) { this.id = id; this.amount = amount; } },
    ItemIdentifiers: ItemIds,
    WeaponInterfaceManager: { assign() {} },
    CombatFactory: { poisonEntity: (target, severity, orb) => poisoned.push({ target, severity, orb }) },
  },
  emitCustomEvent() {},
  onCombatHitResolved() {},
  onItemAction(name, actions) { itemActions[name] = actions; },
});

function item(id, meta = {}) {
  return {
    id,
    meta,
    getId() { return this.id; },
    setId(next) { this.id = next; },
    getMetaValue(key) { return this.meta[key]; },
    setMetaValue(key, value) { this.meta[key] = value; },
  };
}

function createPlayer(weapon = null) {
  const equipment = new Array(14).fill(null).map(() => item(0));
  if (weapon) equipment[Equipment.WEAPON_SLOT] = weapon;
  const messages = [];
  const added = [];
  return {
    messages,
    added,
    getEquipment: () => ({ getItems: () => equipment, refreshItems() {} }),
    getInventory: () => ({ forceAdd: (_player, given) => added.push(given) }),
    getUpdateFlag: () => ({ flag() {} }),
    sendMessage: (message) => messages.push(message),
    isPlayer: () => true,
    getAsPlayer() { return this; },
  };
}

function strike(player, { accurate = true, damage = 5, type = CombatType.MELEE } = {}) {
  AbyssalTentacle._test.onHitResolved({
    attacker: player,
    target: {},
    hit: { isAccurate: () => accurate, getTotalDamage: () => damage, getCombatType: () => type },
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

test("Check reports the attacks left, full for a tentacle with no saved count", () => {
  assert.equal(typeof itemActions["Abyssal tentacle"].Check, "function");
  assert.equal(typeof itemActions["Abyssal tentacle (or)"].Check, "function");
  const player = createPlayer();
  AbyssalTentacle._test.check({ player, item: item(ItemIds.ABYSSAL_TENTACLE, { "abyssal-tentacle": 955 }) });
  AbyssalTentacle._test.check({ player, item: item(ItemIds.ABYSSAL_TENTACLE) });
  assert.deepEqual(player.messages, [
    "Your abyssal tentacle can perform 955 more attacks.",
    "Your abyssal tentacle can perform 10,000 more attacks.",
  ]);
});

test("every melee attack, hit or miss, uses a charge; other attacks do not", () => {
  const tentacle = item(ItemIds.ABYSSAL_TENTACLE, { "abyssal-tentacle": 10 });
  const player = createPlayer(tentacle);
  const original = Math.random;
  try {
    Math.random = () => 0.9;
    strike(player);
    strike(player, { accurate: false, damage: 0 });
    strike(player, { type: CombatType.MAGIC });
  } finally {
    Math.random = original;
  }
  assert.equal(AbyssalTentacle._test.charges(tentacle), 8);
});

test("the last charge leaves the kraken tentacle, and an (or) tentacle returns its kit", () => {
  const plain = item(ItemIds.ABYSSAL_TENTACLE, { "abyssal-tentacle": 1 });
  const ornamented = item(ItemIds.ABYSSAL_TENTACLE_OR_, { "abyssal-tentacle": 1 });
  const plainOwner = createPlayer(plain);
  const ornamentedOwner = createPlayer(ornamented);
  const original = Math.random;
  try {
    Math.random = () => 0.9;
    strike(plainOwner);
    strike(ornamentedOwner);
  } finally {
    Math.random = original;
  }
  assert.equal(plain.getId(), ItemIds.KRAKEN_TENTACLE);
  assert.equal(plainOwner.added.length, 0);
  assert.equal(ornamented.getId(), ItemIds.KRAKEN_TENTACLE);
  assert.equal(ornamentedOwner.added[0].id, ItemIds.SHATTERED_RELICS_VARIETY_ORNAMENT_KIT);
});
