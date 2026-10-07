// Run after `yarn build`: node --test tests/crystal-armour.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Skill } = require("../dist/game/model/Skill");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIds } = require("../dist/util/IdEnums");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");

const CrystalArmour = require("../plugins/items/CrystalArmour.plugin");

CrystalArmour.register({
  core: { Equipment, ItemIdentifiers },
  registerRangedAttackAccuracyModifier() {},
  registerRangedHitModifier() {},
  registerIncomingDamageModifier() {},
  onItemAction() {},
  onItemOnItem() {},
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

function createPlayer(worn = {}, weapon = ItemIds.CRYSTAL_BOW, meta = {}) {
  const equipment = new Array(14).fill(null).map(() => item(0));
  for (const [slot, id] of Object.entries(worn)) {
    equipment[Number(slot)] = item(id, meta[Number(slot)]);
  }
  if (weapon) equipment[Equipment.WEAPON_SLOT] = item(weapon);
  const messages = [];
  const player = {
    messages,
    isPlayer: () => true,
    getAsPlayer() { return this; },
    getEquipment: () => ({ getItems: () => equipment, refreshItems: () => {} }),
    getInventory: () => ({ refreshItems: () => {} }),
    sendMessage: (message) => messages.push(message),
  };
  return player;
}

const FULL_SET = {
  [Equipment.HEAD_SLOT]: ItemIds.CRYSTAL_HELM,
  [Equipment.BODY_SLOT]: ItemIds.CRYSTAL_BODY,
  [Equipment.LEG_SLOT]: ItemIds.CRYSTAL_LEGS,
};

test("a full charged crystal armour set gives 30% accuracy and 15% damage to crystal bows", () => {
  const player = createPlayer(FULL_SET);
  const bonus = CrystalArmour._test.bonus(player);
  assert.ok(Math.abs(bonus.accuracy - 0.30) < 1e-9);
  assert.ok(Math.abs(bonus.damage - 0.15) < 1e-9);
  assert.ok(Math.abs(CrystalArmour._test.applyCrystalAccuracy(player, 100) - 130) < 1e-9);
  assert.ok(Math.abs(CrystalArmour._test.applyCrystalDamage(player, 100) - 115) < 1e-9);
});

test("per-piece bonuses only count while charged, and only for crystal weapons", () => {
  const helmOnly = createPlayer({ [Equipment.HEAD_SLOT]: ItemIds.CRYSTAL_HELM });
  const helmBonus = CrystalArmour._test.bonus(helmOnly);
  assert.ok(Math.abs(helmBonus.accuracy - 0.05) < 1e-9);
  assert.ok(Math.abs(helmBonus.damage - 0.025) < 1e-9);

  const inactiveBody = createPlayer({
    [Equipment.HEAD_SLOT]: ItemIds.CRYSTAL_HELM,
    [Equipment.BODY_SLOT]: ItemIds.CRYSTAL_HELM_INACTIVE_,
  });
  assert.deepEqual(CrystalArmour._test.bonus(inactiveBody), helmBonus, "an inactive piece gives nothing");

  const wrongWeapon = createPlayer(FULL_SET, ItemIds.DRAGON_SCIMITAR);
  assert.deepEqual(CrystalArmour._test.bonus(wrongWeapon), { accuracy: 0, damage: 0 });
});

test("pieces start at 2,500 charges, lose one per hit and deactivate at zero", () => {
  const helm = item(ItemIds.CRYSTAL_HELM);
  const player = createPlayer({ [Equipment.HEAD_SLOT]: ItemIds.CRYSTAL_HELM });
  player.getEquipment().getItems()[Equipment.HEAD_SLOT] = helm;
  assert.equal(CrystalArmour._test.charges(helm), 2500);

  CrystalArmour._test.onIncomingDamage(player, { getDamage: () => 0 });
  assert.equal(CrystalArmour._test.charges(helm), 2500, "a fully reduced hit spends nothing");

  CrystalArmour._test.onIncomingDamage(player, { getDamage: () => 5 });
  assert.equal(CrystalArmour._test.charges(helm), 2499);

  helm.setMetaValue("crystal-armour", { charges: 1 });
  CrystalArmour._test.onIncomingDamage(player, { getDamage: () => 5 });
  assert.equal(helm.getId(), ItemIds.CRYSTAL_HELM_INACTIVE_);
  assert.match(player.messages.at(-1), /run out of charges/);
});

test("ranged hit modifiers now reach the ranged max-hit formula", () => {
  const { registerRangedHitModifier } = require("../dist/game/content/combat/EquipmentEffects");
  const { DamageFormulas } = require("../dist/game/content/combat/formula/DamageFormulas");
  const { FightStyle } = require("../dist/game/content/combat/FightStyle");
  const { CombatType } = require("../dist/game/content/combat/CombatType");

  const player = {
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer() { return this; },
    getSkillManager: () => ({ getCurrentLevel: (skill) => (skill === Skill.RANGED ? 99 : 1) }),
    getFightType: () => ({ getStyle: () => FightStyle.ACCURATE }),
    getBonusManager: () => ({ getOtherBonus: () => [0, 0, 0, 0] }),
    getEquipment: () => ({ getItems: () => new Array(14).fill(null).map(() => ({ getId: () => 0 })) }),
    isSpecialActivated: () => false,
    getCombatSpecial: () => null,
    getPrayerActive: () => new Array(30).fill(false),
  };
  const base = DamageFormulas.calculateMaxRangedHit(player);
  assert.equal(base, 11, "Ranged 99 accurate with no bonus");
  registerRangedHitModifier((_entity, hit) => hit * 2);
  assert.equal(DamageFormulas.calculateMaxRangedHit(player), 22, "the registered modifier applies");
  void CombatType;
});
