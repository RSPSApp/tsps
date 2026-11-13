// Run after `yarn build`: node --test tests/smoke-staves.test.cjs
// Smoke battlestaff / mystic smoke staff / twinflame staff: +10% magic accuracy and damage on
// standard-spellbook spells (Wiki), added the way the Wiki DPS calculator adds them.
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { World } = require("../dist/game/World");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { FightType } = require("../dist/game/content/combat/FightType");
const { ItemIds } = require("../dist/util/IdEnums");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { CombatSpells } = require("../dist/game/content/combat/magic/CombatSpells");
const { AccuracyFormulasDpsCalc } = require("../dist/game/content/combat/formula/AccuracyFormulasDpsCalc");
const { DamageFormulas } = require("../dist/game/content/combat/formula/DamageFormulas");
const effects = require("../dist/game/content/combat/EquipmentEffects");

const registerSmokeStaves = require("../plugins/combat/effects/SmokeStaves.EquipmentEffects");
const registerSalve = require("../plugins/combat/effects/SalveAmulet.EquipmentEffects");

ItemDefinition.forId = (id) => ({ getName: () => (id === ItemIds.SALVE_AMULET_I_ ? "Salve amulet(i)" : "") });

// The real core stages, so the rolls below are the formulas' own.
const { MagicSpellbook } = require("../dist/game/model/MagicSpellbook");
const api = {
  core: { Equipment, ItemIdentifiers, MagicSpellbook },
  registerMeleeAttackAccuracyModifier: effects.registerMeleeAttackAccuracyModifier,
  registerMeleeHitModifier: effects.registerMeleeHitModifier,
  registerRangedAttackAccuracyModifier: effects.registerRangedAttackAccuracyModifier,
  registerRangedHitModifier: effects.registerRangedHitModifier,
  registerMagicAttackAccuracyModifier: effects.registerMagicAttackAccuracyModifier,
  registerMagicAccuracyPercentModifier: effects.registerMagicAccuracyPercentModifier,
  registerMagicHitModifier: effects.registerMagicHitModifier,
  registerMagicDamageBonusModifier: effects.registerMagicDamageBonusModifier,
  onCustomEvent: () => {},
};
registerSmokeStaves(api);
registerSalve(api);

let cycle = 1;

/** A 99 Magic caster with no prayers or bonuses, wielding `weapon` and casting `spell`. */
function caster({ weapon = -1, amulet = -1, spell = null, undead = false } = {}) {
  World.processCycle = cycle++; // a fresh roll cache per case
  const items = new Array(14).fill(null).map(() => ({ getId: () => -1 }));
  items[Equipment.WEAPON_SLOT] = { getId: () => weapon };
  items[Equipment.AMULET_SLOT] = { getId: () => amulet };
  const target = {
    isNpc: () => true,
    isPlayer: () => false,
    getAsNpc: () => ({ getCurrentDefinition: () => ({ hasAttribute: (a) => undead && a === "undead" }) }),
  };
  const player = {
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer: () => player,
    isSpecialActivated: () => false,
    getAttribute: () => null,
    getInventory: () => ({ getItems: () => [], contains: () => false, getAmount: () => 0 }),
    getPrayerActive: () => new Array(40).fill(false),
    getSkillManager: () => ({ getCurrentLevel: () => 99 }),
    getFightType: () => FightType.STAFF_BASH,
    getCombat: () => ({ getAutocastSpell: () => spell, getSelectedSpell: () => spell, getCastSpell: () => spell, getTarget: () => target }),
    getEquipment: () => ({ getItems: () => items, get: (slot) => items[slot], getWeapon: () => items[Equipment.WEAPON_SLOT] }),
    getBonusManager: () => ({
      getAttackBonus: () => [0, 0, 0, 0, 0],
      getDefenceBonus: () => [0, 0, 0, 0, 0],
      getOtherBonus: () => [0, 0, 0, 0, 0],
    }),
  };
  return player;
}

const BASE_ROLL = (99 + 9) * 64; // effective level 108, +0 attack bonus

test("each smoke staff adds 10% accuracy to a standard-spellbook spell", () => {
  for (const weapon of [ItemIdentifiers.SMOKE_BATTLESTAFF, ItemIdentifiers.MYSTIC_SMOKE_STAFF, ItemIdentifiers.TWINFLAME_STAFF]) {
    assert.equal(AccuracyFormulasDpsCalc.attackMagicRoll(caster({ weapon, spell: CombatSpells.FIRE_WAVE })),
      Math.floor((BASE_ROLL * 110) / 100), String(weapon));
  }
  assert.equal(AccuracyFormulasDpsCalc.attackMagicRoll(caster({ weapon: ItemIdentifiers.STAFF_OF_FIRE, spell: CombatSpells.FIRE_WAVE })),
    BASE_ROLL, "another staff gives nothing");
});

test("curses are boosted too; other spellbooks are not", () => {
  const weapon = ItemIdentifiers.SMOKE_BATTLESTAFF;
  assert.equal(AccuracyFormulasDpsCalc.attackMagicRoll(caster({ weapon, spell: CombatSpells.CONFUSE })),
    Math.floor((BASE_ROLL * 110) / 100), "curse spells (Wiki, Mod Ash)");
  assert.equal(AccuracyFormulasDpsCalc.attackMagicRoll(caster({ weapon, spell: CombatSpells.SMOKE_BARRAGE })),
    BASE_ROLL, "Ancient Magicks");
});

test("smoke staff and salve amulet (i) accuracy add up before scaling the roll", () => {
  const roll = AccuracyFormulasDpsCalc.attackMagicRoll(caster({
    weapon: ItemIdentifiers.SMOKE_BATTLESTAFF, amulet: ItemIds.SALVE_AMULET_I_, spell: CombatSpells.FIRE_WAVE, undead: true,
  }));
  assert.equal(roll, Math.floor((BASE_ROLL * 125) / 100), "15 + 10 points, once (not x1.15 then x1.10)");
  assert.equal(AccuracyFormulasDpsCalc.attackMagicRoll(caster({
    amulet: ItemIds.SALVE_AMULET_I_, spell: CombatSpells.FIRE_WAVE, undead: true,
  })), Math.floor((BASE_ROLL * 115) / 100), "salve alone keeps its 15%");
});

test("the smoke staff adds 10% magic damage on standard spells only", () => {
  const weapon = ItemIdentifiers.MYSTIC_SMOKE_STAFF;
  const base = CombatSpells.FIRE_WAVE.maximumHit();
  assert.equal(DamageFormulas.getMagicMaxhit(caster({ weapon, spell: CombatSpells.FIRE_WAVE })),
    Math.floor((base * 1100) / 1000));
  assert.equal(DamageFormulas.getMagicMaxhit(caster({ spell: CombatSpells.FIRE_WAVE })), base, "no staff");
  const ancient = CombatSpells.SMOKE_BARRAGE.maximumHit();
  assert.equal(DamageFormulas.getMagicMaxhit(caster({ weapon, spell: CombatSpells.SMOKE_BARRAGE })), ancient);
  assert.equal(DamageFormulas.getMagicMaxhit(caster({ weapon, amulet: ItemIds.SALVE_AMULET_I_, spell: CombatSpells.FIRE_WAVE, undead: true })),
    Math.floor((base * 1250) / 1000), "salve (i) +15% and smoke +10% share the magic damage bonus");
});
