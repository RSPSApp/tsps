// Run after `yarn build`: node --test tests/amulet-of-the-damned.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Barrows } = require("../dist/game/content/combat/Barrows");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const BarrowsEquipment = require("../plugins/items/BarrowsEquipment.plugin");

let dropPolicy;
let deathDrop;
BarrowsEquipment.register({
  getBonusManager: () => ({ update() {} }),
  getTaskManager: () => ({ submit() {} }),
  getCombatFactory: () => ({ inCombat: () => false }),
  registerBonusProvider() {},
  registerMeleeDefenseModifier() {},
  registerRangedDefenseModifier() {},
  registerMagicDefenseModifier() {},
  registerMeleeHitModifier() {},
  onCombatHitRoll() {},
  onPlayerDealtDamage() {},
  onCombatHitResolved() {},
  onPlayerLogin() {},
  onPlayerLogout() {},
  onCanEquip() {},
  onItemDropPolicy(handler) { dropPolicy = handler; },
  onPlayerDeathItemDrop(handler) { deathDrop = handler; },
  onNpcInteraction() {},
  onCustomEvent() {},
  sendMultiChatboxPrompt() {},
});

function item(id) {
  return {
    id,
    getId() { return this.id; },
    setId(next) { this.id = next; return this; },
    getMetaValue() { return undefined; },
    setMetaValue() {},
  };
}

function playerWearing(ids) {
  const items = new Array(14).fill(null).map(() => item(-1));
  for (const [slot, id] of Object.entries(ids)) items[slot] = item(id);
  return { getEquipment: () => ({ getItems: () => items, get: (slot) => items[slot] }) };
}

const DHAROKS_SET = {
  [Equipment.HEAD_SLOT]: 4716,
  [Equipment.WEAPON_SLOT]: 4718,
  [Equipment.BODY_SLOT]: 4720,
  [Equipment.LEG_SLOT]: 4722,
};

test("the amulet of the damned only empowers a complete, unbroken Barrows set", () => {
  const full = playerWearing({ ...DHAROKS_SET, [Equipment.AMULET_SLOT]: Barrows.AMULET_OF_THE_DAMNED_FULL });
  assert.equal(Barrows.hasDamnedSet(full, "dharoks"), true);
  assert.equal(Barrows.hasDamnedSet(playerWearing(DHAROKS_SET), "dharoks"), false, "no amulet, no bonus");

  const broken = playerWearing({
    ...DHAROKS_SET,
    [Equipment.HEAD_SLOT]: Barrows.stageItemId(4716, 4),
    [Equipment.AMULET_SLOT]: Barrows.AMULET_OF_THE_DAMNED,
  });
  assert.equal(Barrows.hasDamnedSet(broken, "dharoks"), false, "a broken piece breaks the set");
});

test("an intact amulet drops on death while a used one crumbles", () => {
  const full = item(Barrows.AMULET_OF_THE_DAMNED_FULL);
  const fullEvent = { player: {}, item: full, handled: false };
  deathDrop(fullEvent);
  assert.equal(full.getId(), Barrows.AMULET_OF_THE_DAMNED_FULL, "the tradeable full amulet is kept");
  assert.equal(fullEvent.handled, false);

  const used = item(Barrows.AMULET_OF_THE_DAMNED);
  const usedEvent = { player: {}, item: used, handled: false };
  deathDrop(usedEvent);
  assert.equal(used.getId(), -1);
  assert.equal(usedEvent.handled, true);
});

test("an intact amulet can be dropped while a used one is destroyed", () => {
  const full = item(Barrows.AMULET_OF_THE_DAMNED_FULL);
  assert.equal(dropPolicy({ player: {}, item: full, handled: false }), undefined);
  assert.equal(full.getId(), Barrows.AMULET_OF_THE_DAMNED_FULL);

  const used = item(Barrows.AMULET_OF_THE_DAMNED);
  assert.equal(dropPolicy({ player: {}, item: used, handled: false }), undefined);
  assert.equal(used.getId(), -1);
});
