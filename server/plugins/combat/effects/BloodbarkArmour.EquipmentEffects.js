/**
 * Bloodbark armour (Wiki: Bloodbark armour): "each piece of armour increases the amount that blood
 * spells heal by 2% of the damage dealt. When the full set of armour is equipped, blood spells will
 * heal the caster's Hitpoints for a total of 35% of the amount of damage inflicted." With an Ancient
 * sceptre's 10% the set reaches 38.5%, so the sceptre scales the armour's total too.
 *
 * Rounding (Mod Ash, cited there, 3 February 2023): "The 1/4 calculation rounds down first. After
 * that, the result is scaled up by the bloodbark effect". So a Blood spell heals
 * floor(damage × 0.25 × the Ancient effect multiplier), and the armour scales that by
 * (25 + 2 × pieces) / 25, rounded down: 12 damage with the full set heals floor(3 × 1.4) = 4.
 *
 * Pieces are counted by name ("bloodbark") in the head, body, legs, hands and feet slots. The
 * Sanguinesti staff's spell isn't a Blood spell, so it gets nothing (the Wiki says the same).
 * The heal stops at the caster's Hitpoints level, as the base heal does; the blood ancient
 * sceptre's overheal (AncientSceptre.plugin) uses the same total, so it runs on past the level.
 */
const { asPlayer, wornName } = require("./GearChecks.EquipmentEffects");

/** The Blood spells' base heal, a quarter of the damage (CombatSpells.ts BLOOD_RUSH..BARRAGE). */
const BLOOD_HEAL = 0.25;
/** Each piece adds 2% of the damage to the 25% base: a 25ths scale of the base heal. */
const BASE_PERCENT = 25;
const PERCENT_PER_PIECE = 2;
const BLOOD_SPELLS = ["BLOOD_RUSH", "BLOOD_BURST", "BLOOD_BLITZ", "BLOOD_BARRAGE"];
/** The caster's Hitpoints when a Blood spell hit was calculated, before its base heal. */
const before = new WeakMap();
let core;

function slots() {
  const E = core.Equipment;
  return [E.HEAD_SLOT, E.BODY_SLOT, E.LEG_SLOT, E.HANDS_SLOT, E.FEET_SLOT];
}

/** Worn pieces named Bloodbark. */
function bloodbarkPieces(player) {
  if (!player) return 0;
  return slots().filter((slot) => wornName(player, slot).includes("bloodbark")).length;
}

function isBloodSpell(spell) {
  return spell != null && BLOOD_SPELLS.some((name) => core.CombatSpells[name] === spell);
}

/**
 * What a Blood spell's hit heals the caster, from a magic:hit-effects(-applied) event:
 * the base quarter (with the Ancient effect multiplier) rounded down, then the bloodbark scale.
 */
function bloodSpellHeal(event) {
  const base = Math.floor(event.hit.getTotalDamage() * (BLOOD_HEAL * (event.effectMultiplier ?? 1)));
  const pieces = bloodbarkPieces(asPlayer(event.attacker));
  return Math.floor((base * (BASE_PERCENT + PERCENT_PER_PIECE * pieces)) / BASE_PERCENT);
}

function rememberHitpoints(event) {
  if (!event.allowed || !isBloodSpell(event.spell)) return;
  const player = asPlayer(event.attacker);
  if (bloodbarkPieces(player) > 0) before.set(event, player.getHitpoints());
}

/** After the base heal: tops it up to the scaled heal, up to the Hitpoints level (never lowering a boost). */
function bloodbarkHeal(event) {
  if (!before.has(event)) return;
  const start = before.get(event);
  before.delete(event);
  const player = asPlayer(event.attacker);
  const max = player.getSkillManager().getMaxLevel(core.Skill.HITPOINTS);
  const target = Math.min(start + bloodSpellHeal(event), Math.max(start, max));
  if (target > player.getHitpoints()) player.setHitpoints(target);
}

module.exports = function registerBloodbarkArmourEffects(api) {
  core = api.core;
  api.onCustomEvent("magic:hit-effects", rememberHitpoints);
  api.onCustomEvent("magic:hit-effects-applied", bloodbarkHeal);
};

/** For AncientSceptre.plugin's overheal, with its core API (this module's may not be registered). */
module.exports.bloodSpellHeal = (event, coreApi) => {
  core ??= coreApi;
  return bloodSpellHeal(event);
};
module.exports._test = { bloodSpellHeal, bloodbarkPieces, rememberHitpoints, bloodbarkHeal };
