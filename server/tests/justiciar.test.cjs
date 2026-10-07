// Run after `yarn build`: node --test tests/justiciar.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { BonusManager } = require("../dist/game/model/equipment/BonusManager");
const { CombatType } = require("../dist/game/content/combat/CombatType");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIds } = require("../dist/util/IdEnums");

const registerJusticiar = require("../plugins/combat/effects/JusticiarArmour");

let modifier;
registerJusticiar({ registerIncomingDamageModifier: (value) => { modifier = value; } });

function hitDamage(damage) {
  return {
    damage,
    getDamage() { return this.damage; },
    setDamage(value) { this.damage = value; },
  };
}

function createPlayer({ bonus = new Array(14).fill(0), fullSet = true } = {}) {
  const equipment = new Array(14).fill(null).map(() => ({ getId: () => 0 }));
  if (fullSet) {
    equipment[Equipment.HEAD_SLOT] = { getId: () => ItemIds.JUSTICIAR_FACEGUARD };
    equipment[Equipment.BODY_SLOT] = { getId: () => ItemIds.JUSTICIAR_CHESTGUARD };
    equipment[Equipment.LEG_SLOT] = { getId: () => ItemIds.JUSTICIAR_LEGGUARDS };
  }
  return {
    isPlayer: () => true,
    getAsPlayer() { return this; },
    getEquipment: () => ({ getItems: () => equipment }),
    getBonusManager: () => ({ getDefenceBonus: () => bonus }),
  };
}

const npcAttacker = { isPlayer: () => false };

test("Justiciar reduces NPC damage by defence bonus / 3000, at least 1", () => {
  const bonus = new Array(14).fill(0);
  bonus[BonusManager.DEFENCE_CRUSH] = 450;
  const hit = hitDamage(100);
  modifier(createPlayer({ bonus }), hit, { type: CombatType.MELEE, attacker: npcAttacker, meleeAttackBonusIndex: 2 });
  assert.equal(hit.getDamage(), 85, "450/3000 is 15%");

  const small = hitDamage(2);
  modifier(createPlayer({ bonus }), small, { type: CombatType.MELEE, attacker: npcAttacker, meleeAttackBonusIndex: 2 });
  assert.equal(small.getDamage(), 1, "with a large bonus and a 2 hit the floor is 1 damage");

  const tinyBonus = new Array(14).fill(0);
  tinyBonus[BonusManager.DEFENCE_CRUSH] = 10;
  const tiny = hitDamage(2);
  modifier(createPlayer({ bonus: tinyBonus }), tiny, { type: CombatType.MELEE, attacker: npcAttacker, meleeAttackBonusIndex: 2 });
  assert.equal(tiny.getDamage(), 1, "the reduction is always at least 1");
});

test("the style picks the matching defence bonus", () => {
  const bonus = new Array(14).fill(0);
  bonus[BonusManager.DEFENCE_MAGIC] = 300;
  bonus[BonusManager.DEFENCE_RANGE] = 600;
  const magic = hitDamage(100);
  modifier(createPlayer({ bonus }), magic, { type: CombatType.MAGIC, attacker: npcAttacker });
  assert.equal(magic.getDamage(), 90);
  const ranged = hitDamage(100);
  modifier(createPlayer({ bonus }), ranged, { type: CombatType.RANGED, attacker: npcAttacker });
  assert.equal(ranged.getDamage(), 80);
});

test("Justiciar does not apply in PvP or without the full set", () => {
  const bonus = new Array(14).fill(450);
  const pvp = hitDamage(100);
  modifier(createPlayer({ bonus }), pvp, { type: CombatType.MELEE, attacker: { isPlayer: () => true } });
  assert.equal(pvp.getDamage(), 100);

  const partial = hitDamage(100);
  modifier(createPlayer({ bonus, fullSet: false }), partial, { type: CombatType.MELEE, attacker: npcAttacker });
  assert.equal(partial.getDamage(), 100);
});
