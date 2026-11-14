// Run after `yarn build`: node --test tests/virtus-robes.test.cjs
// Virtus robes: +3% magic damage per worn piece on Ancient Magicks combat spells, on top of
// each piece's own 2% (Wiki: Virtus robes), added the way the Wiki DPS calculator adds it.
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { World } = require("../dist/game/World");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { FightType } = require("../dist/game/content/combat/FightType");
const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { CombatSpells } = require("../dist/game/content/combat/magic/CombatSpells");
const { DamageFormulas } = require("../dist/game/content/combat/formula/DamageFormulas");
const { MagicSpellbook } = require("../dist/game/model/MagicSpellbook");
const effects = require("../dist/game/content/combat/EquipmentEffects");

const registerVirtus = require("../plugins/combat/effects/VirtusRobes.EquipmentEffects");

const NAMES = new Map([
  [I.VIRTUS_MASK, "Virtus mask"],
  [I.VIRTUS_ROBE_TOP, "Virtus robe top"],
  [I.VIRTUS_ROBE_BOTTOM, "Virtus robe bottom"],
  [I.ECHO_VIRTUS_ROBE_TOP, "Echo virtus robe top"],
  [I.ANCESTRAL_HAT, "Ancestral hat"],
]);
ItemDefinition.forId = (id) => ({ getName: () => NAMES.get(id) ?? "" });

const listeners = [];
registerVirtus({
  core: { Equipment, MagicSpellbook },
  registerMagicDamageBonusModifier: effects.registerMagicDamageBonusModifier,
  onCustomEvent: (name, fn) => name === "equipment:effects" && listeners.push(fn),
});

let cycle = 1;

/** A 99 Magic caster with no prayers, `magicDamage`% equipment magic damage, wearing `worn` (slot -> id). */
function caster({ worn = {}, spell = null, magicDamage = 0 } = {}) {
  World.processCycle = cycle++;
  const items = new Array(14).fill(null).map(() => ({ getId: () => -1 }));
  for (const [slot, id] of Object.entries(worn)) items[slot] = { getId: () => id };
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
    getCombat: () => ({ getAutocastSpell: () => spell, getSelectedSpell: () => spell, getCastSpell: () => spell, getTarget: () => null }),
    getEquipment: () => ({ getItems: () => items, get: (slot) => items[slot], getWeapon: () => items[Equipment.WEAPON_SLOT] }),
    getBonusManager: () => ({
      getAttackBonus: () => [0, 0, 0, 0, 0],
      getDefenceBonus: () => [0, 0, 0, 0, 0],
      getOtherBonus: () => [0, 0, magicDamage, 0, 0],
    }),
  };
  return player;
}

const FULL = { [Equipment.HEAD_SLOT]: I.VIRTUS_MASK, [Equipment.BODY_SLOT]: I.VIRTUS_ROBE_TOP, [Equipment.LEG_SLOT]: I.VIRTUS_ROBE_BOTTOM };
const scaled = (base, permille) => Math.floor((base * (1000 + permille)) / 1000);

test("each Virtus piece adds 3% to an Ancient Magicks spell's max hit", () => {
  const spell = CombatSpells.ICE_BARRAGE;
  const base = spell.maximumHit();
  assert.equal(DamageFormulas.getMagicMaxhit(caster({ spell })), base, "no robes");
  // With its own 2%: 30 -> floor(30 x 1.05) = 31, where the 2% alone stays at 30.
  assert.equal(DamageFormulas.getMagicMaxhit(caster({ spell, magicDamage: 2, worn: { [Equipment.BODY_SLOT]: I.VIRTUS_ROBE_TOP } })), scaled(base, 50));
  assert.equal(DamageFormulas.getMagicMaxhit(caster({
    spell, worn: { [Equipment.BODY_SLOT]: I.VIRTUS_ROBE_TOP, [Equipment.LEG_SLOT]: I.VIRTUS_ROBE_BOTTOM },
  })), scaled(base, 60));
  assert.equal(DamageFormulas.getMagicMaxhit(caster({ spell, worn: FULL })), scaled(base, 90));
});

test("the 3% adds to the robes' own 2% magic damage bonus: 15% for the set", () => {
  const spell = CombatSpells.BLOOD_BARRAGE;
  const base = spell.maximumHit();
  // The three pieces' cache bonuses, 2% each.
  assert.equal(DamageFormulas.getMagicMaxhit(caster({ spell, worn: FULL, magicDamage: 6 })), scaled(base, 150));
  assert.equal(DamageFormulas.getMagicMaxhit(caster({ spell: CombatSpells.SMOKE_RUSH, worn: FULL, magicDamage: 6 })),
    scaled(CombatSpells.SMOKE_RUSH.maximumHit(), 150), "every Ancient Magicks combat spell");
});

test("standard spells and powered staves get only the 2%", () => {
  const spell = CombatSpells.FIRE_WAVE;
  assert.equal(DamageFormulas.getMagicMaxhit(caster({ spell, worn: FULL, magicDamage: 6 })), scaled(spell.maximumHit(), 60));
  assert.equal(DamageFormulas.applyMagicDamageBonus(caster({ worn: FULL, magicDamage: 6 }), 40, null), scaled(40, 60), "no spell");
});

test("Echo virtus pieces count; other robes do not", () => {
  const spell = CombatSpells.ICE_BARRAGE;
  const base = spell.maximumHit();
  assert.equal(DamageFormulas.getMagicMaxhit(caster({
    spell, worn: { ...FULL, [Equipment.BODY_SLOT]: I.ECHO_VIRTUS_ROBE_TOP },
  })), scaled(base, 90));
  assert.equal(DamageFormulas.getMagicMaxhit(caster({
    spell, worn: { ...FULL, [Equipment.HEAD_SLOT]: I.ANCESTRAL_HAT },
  })), scaled(base, 60));
});

test("the full plain set reports Equipment effects text 29", () => {
  const texts = (worn) => {
    const request = { player: caster({ worn }), setTexts: [] };
    for (const fn of listeners) fn(request);
    return request.setTexts;
  };
  assert.deepEqual(texts(FULL), [29]);
  assert.deepEqual(texts({ ...FULL, [Equipment.HEAD_SLOT]: -1 }), []);
  assert.deepEqual(texts({ ...FULL, [Equipment.BODY_SLOT]: I.ECHO_VIRTUS_ROBE_TOP }), [], "Ours: echo pieces show no text");
});
