// Run after `yarn build`: node --test tests/ring-of-suffering.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIds } = require("../dist/util/IdEnums");

const RingOfSuffering = require("../plugins/items/RingOfSuffering.plugin");

let hitResolved;
RingOfSuffering.register({
  core: { ItemIdentifiers: ItemIds },
  onCombatHitResolved: (handler) => { hitResolved = handler; },
  onItemAction() {},
  onItemOnItem() {},
  persistAttribute() {},
});

function item(id, meta = {}) {
  return {
    id,
    meta: { ...meta },
    getId() { return this.id; },
    setId(next) { this.id = next; },
    getMetaValue(key) { return this.meta[key]; },
    setMetaValue(key, next) {
      if (next === undefined) delete this.meta[key];
      else this.meta[key] = next;
    },
  };
}

function createPlayer({ ring = null, disabled = false } = {}) {
  const equipment = new Array(14).fill(null).map(() => item(0));
  if (ring) equipment[Equipment.RING_SLOT] = ring;
  const attributes = new Map();
  if (disabled) attributes.set("ring-of-suffering:recoil-disabled", true);
  const messages = [];
  return {
    attributes,
    messages,
    getEquipment: () => ({ get: (slot) => equipment[slot], refreshItems: () => {} }),
    getInventory: () => ({ deleteNumber: () => {}, refreshItems: () => {} }),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => { this.pending = hits; } }), getTarget: () => null }),
    sendMessage: (message) => messages.push(message),
    isPlayer: () => true,
    getAsPlayer() { return this; },
  };
}

function attacker() {
  const pending = [];
  return { pending, getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => pending.push(...hits) }) }) };
}

test("rings of recoil charge the ring and switch it to (r)", () => {
  const ring = item(ItemIds.RING_OF_SUFFERING);
  const player = createPlayer({ ring });
  RingOfSuffering._test.chargeRing({
    player,
    usedItem: ring,
    usedWithItem: item(ItemIds.RING_OF_RECOIL),
    usedItemId: ItemIds.RING_OF_SUFFERING,
    usedWithItemId: ItemIds.RING_OF_RECOIL,
    handled: false,
  });
  assert.equal(ring.getId(), ItemIds.RING_OF_SUFFERING_R_);
  assert.equal(RingOfSuffering._test.charges(ring), 40);
});

/** A hit of `damage` from `from` landing on `player`. */
function land(player, damage, from = attacker()) {
  hitResolved({ attacker: from, target: player, hit: { getTotalDamage: () => damage } });
  return from;
}

test("every damaging hit recoils 10% + 1, spending a charge per point of recoil", () => {
  const ring = item(ItemIds.RING_OF_SUFFERING_R_, { "ring-of-suffering": 40 });
  const player = createPlayer({ ring });
  for (let i = 0; i < 3; i++) {
    const enemy = land(player, 100);
    assert.equal(enemy.pending.length, 1, "no random fizzle");
    assert.equal(enemy.pending[0].getDamage(), 11);
    assert.ok(enemy.pending[0].isReflected());
    assert.equal(enemy.pending[0].getSource(), player);
  }
  assert.equal(RingOfSuffering._test.charges(ring), 40 - 33);
  assert.equal(land(player, 0).pending.length, 0, "a 0 recoils nothing");
});

test("the last recoil deals only the charges left and reverts the ring", () => {
  const ring = item(ItemIds.RING_OF_SUFFERING_R_, { "ring-of-suffering": 3 });
  const player = createPlayer({ ring });
  const enemy = land(player, 100);
  assert.equal(enemy.pending[0].getDamage(), 3);
  assert.equal(ring.getId(), ItemIds.RING_OF_SUFFERING, "the last charge reverts the ring");
  assert.match(player.messages.at(-1), /run out of charges/);
});

test("the toggle disables the effect without spending charges", () => {
  const ring = item(ItemIds.RING_OF_SUFFERING_R_, { "ring-of-suffering": 5 });
  const disabled = createPlayer({ ring, disabled: true });
  assert.equal(land(disabled, 100).pending.length, 0);
  assert.equal(RingOfSuffering._test.charges(ring), 5, "disabled spends nothing");
});
