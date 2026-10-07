// Run after `yarn build`: node --test tests/toxic-staff.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIds } = require("../dist/util/IdEnums");

const ToxicStaff = require("../plugins/items/ToxicStaffOfTheDead.plugin");

const poisoned = [];
ToxicStaff.register({
  core: {
    ItemIdentifiers: ItemIds,
    CombatFactory: { poisonEntity: (target, severity, orb) => poisoned.push({ target, severity, orb }) },
  },
  persistAttribute() {},
  onItemAction() {},
  onItemOnItem() {},
  onCombatHitResolved() {},
  onPlayerProcess() {},
});

function item(id, meta = {}) {
  const value = {
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
  return value;
}

function createPlayer({ weapon = null, head = -1, inCombat = true, scales = 0, inventorySlots = 10 } = {}) {
  const equipment = new Array(14).fill(null).map(() => item(0));
  if (weapon) equipment[Equipment.WEAPON_SLOT] = weapon;
  if (head > 0) equipment[Equipment.HEAD_SLOT] = item(head);
  const attributes = new Map();
  const inventoryItems = scales > 0 ? [item(ItemIds.ZULRAHS_SCALES)] : [];
  const messages = [];
  return {
    attributes,
    messages,
    equipment,
    getEquipment: () => ({ get: (slot) => equipment[slot], refreshItems: () => {} }),
    getInventory: () => ({
      getAmount: () => scales,
      deleteNumber: (id, amount) => { scales = Math.max(0, scales - (amount ?? 1)); },
      getFreeSlots: () => inventorySlots,
      addItem: () => {},
      refreshItems: () => {},
    }),
    getCombat: () => ({ getTarget: () => (inCombat ? {} : null) }),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (message) => messages.push(message),
    isPlayer: () => true,
    getAsPlayer() { return this; },
    inventoryItems,
  };
}

test("the staff uses ten scales on entering combat and ten more per minute", () => {
  const staff = item(ItemIds.TOXIC_STAFF_OF_THE_DEAD, { "toxic-staff-charges": 100 });
  const player = createPlayer({ weapon: staff });
  ToxicStaff._test.processCombatUpkeep(player);
  assert.equal(ToxicStaff._test.charges(staff), 90, "combat entry spends ten");
  ToxicStaff._test.processCombatUpkeep(player);
  assert.equal(ToxicStaff._test.charges(staff), 90, "under a minute spends nothing");
  player.attributes.set("toxic-staff:combat-charge-at", Date.now() - 61 * 1000);
  ToxicStaff._test.processCombatUpkeep(player);
  assert.equal(ToxicStaff._test.charges(staff), 80);

  const idle = createPlayer({ weapon: staff, inCombat: false });
  idle.attributes.set("toxic-staff:combat-charge-at", Date.now());
  ToxicStaff._test.processCombatUpkeep(idle);
  assert.equal(idle.attributes.get("toxic-staff:combat-charge-at"), null, "leaving combat resets the timer");
});

test("charged hits have a 25% venom chance, guaranteed with a serpentine helm on NPCs", () => {
  poisoned.length = 0;
  const staff = item(ItemIds.TOXIC_STAFF_OF_THE_DEAD, { "toxic-staff-charges": 100 });
  const player = createPlayer({ weapon: staff });
  const npc = { isNpc: () => true, isVenomed: () => false };
  const hit = { isAccurate: () => true, getTotalDamage: () => 5 };
  const original = Math.random;
  try {
    Math.random = () => 0.9;
    ToxicStaff._test.onHitResolved({ attacker: player, target: npc, hit });
    assert.equal(poisoned.length, 0, "outside the roll");
    Math.random = () => 0.1;
    ToxicStaff._test.onHitResolved({ attacker: player, target: npc, hit });
    assert.deepEqual(poisoned.at(-1), { target: npc, severity: 6, orb: 2 });

    const helmed = createPlayer({ weapon: staff, head: ItemIds.SERPENTINE_HELM });
    Math.random = () => 0.9;
    ToxicStaff._test.onHitResolved({ attacker: helmed, target: npc, hit });
    assert.equal(poisoned.length, 2, "the helm guarantees the proc on an NPC");
  } finally {
    Math.random = original;
  }
});

test("scales charge the staff and uncharging returns them", () => {
  const staff = item(ItemIds.TOXIC_STAFF_UNCHARGED_);
  const player = createPlayer({ weapon: staff, scales: 500 });
  ToxicStaff._test.chargeStaff({
    player,
    usedItem: staff,
    usedWithItem: item(ItemIds.ZULRAHS_SCALES),
    usedItemId: ItemIds.TOXIC_STAFF_UNCHARGED_,
    usedWithItemId: ItemIds.ZULRAHS_SCALES,
    handled: false,
  });
  assert.equal(staff.getId(), ItemIds.TOXIC_STAFF_OF_THE_DEAD);
  assert.equal(ToxicStaff._test.charges(staff), 500);

  const topUp = createPlayer({ weapon: staff, scales: 500 });
  ToxicStaff._test.chargeStaff({
    player: topUp,
    usedItem: staff,
    usedWithItem: item(ItemIds.ZULRAHS_SCALES),
    usedItemId: ItemIds.TOXIC_STAFF_OF_THE_DEAD,
    usedWithItemId: ItemIds.ZULRAHS_SCALES,
    handled: false,
  });
  assert.equal(ToxicStaff._test.charges(staff), 1000);

  const uncharged = createPlayer({ weapon: staff });
  ToxicStaff._test.uncharge({ player: uncharged, item: staff });
  assert.equal(staff.getId(), ItemIds.TOXIC_STAFF_UNCHARGED_);
  assert.equal(ToxicStaff._test.charges(staff), 0);
});
