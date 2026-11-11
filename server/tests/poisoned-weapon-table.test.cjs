// Run after `yarn build`: node --test tests/poisoned-weapon-table.test.cjs
// Wiki (Poison): melee severity 20 / 25 / 30 for (p) / (p+) / (p++); Karambwan paste: (kp) "the same damage as
// poison(++)". The dragon knife and hasta, the abyssal dagger (bh) and the (kp) spears and hastae were missing.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CombatPoisonData, PoisonType } = require('../dist/game/task/impl/CombatPoisonEffect');
const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');
const { Item } = require('../dist/game/model/Item');
before(() => CombatPoisonData.init());

const melee = (id) => {
  const type = CombatPoisonData.getPoisonType(new Item(id, 1));
  assert.notEqual(type, undefined, `item ${id} poisons`);
  return CombatPoisonData.getMeleeSeverity(type);
};

test('dragon hasta and abyssal dagger (bh) tiers poison at 20 / 25 / 30', () => {
  assert.deepEqual([I.DRAGON_HASTA_P_, I.DRAGON_HASTA_P_PLUS_, I.DRAGON_HASTA_P_PLUS_PLUS_].map(melee), [20, 25, 30]);
  assert.deepEqual([I.ABYSSAL_DAGGER_BH_P_, I.ABYSSAL_DAGGER_BH_P_PLUS_, I.ABYSSAL_DAGGER_BH_P_PLUS_PLUS_].map(melee), [20, 25, 30]);
});

test('every (kp) spear and hasta poisons as (p++)', () => {
  for (const id of [I.BRONZE_SPEAR_KP_, I.BLACK_SPEAR_KP_, I.DRAGON_SPEAR_KP_, I.RUNE_HASTA_KP_, I.DRAGON_HASTA_KP_]) {
    assert.equal(melee(id), 30, String(id));
  }
});

test('dragon knives (p) / (p+) / (p++) take the other knives\' tiers', () => {
  assert.deepEqual([I.DRAGON_KNIFE_P_, I.DRAGON_KNIFE_P_PLUS_, I.DRAGON_KNIFE_P_PLUS_PLUS_]
    .map((id) => CombatPoisonData.getPoisonType(new Item(id, 1))),
  [I.RUNE_KNIFE_P_, I.RUNE_KNIFE_P_PLUS_, I.RUNE_KNIFE_P_PLUS_PLUS_].map((id) => CombatPoisonData.getPoisonType(new Item(id, 1))));
  assert.equal(CombatPoisonData.getPoisonType(new Item(I.DRAGON_KNIFE_P_, 1)), PoisonType.VERY_WEAK);
});
