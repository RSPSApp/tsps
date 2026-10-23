// Run after `yarn build`: node --test tests/ring-of-recoil.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");

function createPlayer(ringId = ItemIdentifiers.RING_OF_RECOIL) {
  const attributes = new Map();
  const equipment = new Array(14).fill(null).map(() => ({ getId: () => -1 }));
  equipment[Equipment.RING_SLOT] = { getId: () => ringId };
  return {
    attributes,
    messages: [],
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getEquipment: () => ({
      get: (slot) => equipment[slot],
      set: (slot, item) => { equipment[slot] = item; },
      refreshItems() {},
    }),
    sendMessage(message) { this.messages.push(message); },
  };
}

function attacker() {
  const pending = [];
  return {
    pending,
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => pending.push(...hits) }) }),
  };
}

function land(player, damage) {
  const enemy = attacker();
  CombatFactory.handleRecoil(player, enemy, damage);
  return enemy.pending;
}

test("the ring of recoil reflects 10% + 1 and spends charges per point reflected", () => {
  const player = createPlayer();
  assert.deepEqual(land(player, 100).map((hit) => hit.getDamage()), [11]);
  assert.equal(player.attributes.get(CombatFactory.RECOIL_DAMAGE_ATTRIBUTE), 11);
  assert.deepEqual(land(player, 5).map((hit) => hit.getDamage()), [1]);
  assert.deepEqual(land(player, 0), [], "a zero hit reflects nothing");
  assert.equal(CombatFactory.recoilDamage(0), 0);
});

test("the last recoil deals only the remaining charges and shatters the ring", () => {
  const player = createPlayer();
  player.attributes.set(CombatFactory.RECOIL_DAMAGE_ATTRIBUTE, 39);
  assert.deepEqual(land(player, 100).map((hit) => hit.getDamage()), [1]);
  assert.equal(player.getEquipment().get(Equipment.RING_SLOT).getId(), -1);
  assert.equal(player.attributes.get(CombatFactory.RECOIL_DAMAGE_ATTRIBUTE), 0);
  assert.match(player.messages.at(-1), /Ring of Recoil has shattered/);
});

test("a charged ring of suffering is left to its own plugin", () => {
  const player = createPlayer(ItemIdentifiers.RING_OF_SUFFERING_R_);
  assert.equal(CombatFactory.wearingRecoilRing(player), false);
});
