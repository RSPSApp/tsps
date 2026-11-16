/**
 * Zuriel's staff (bh)'s two passive effects (Wiki: Zuriel's staff (bh), "Passive effects"):
 * - "When casting offensive spells on the standard spellbook or the Ancient Magicks spellbook, the
 *   staff's attack speed is increased to 4, similar to the harmonised Nightmare staff." Unlike the
 *   harmonised staff the page names no autocast-only rule, so hand casts are 4 ticks too.
 * - Ancient Magicks offensive spells: Ice spells "10% increased accuracy", Blood spells "Hitpoints
 *   restoration is increased by 50%", Smoke spells "Poison damage is increased by 100%", Shadow
 *   spells "Attack drain is increased by 100%".
 *
 * Blood, Smoke and Shadow scale the spell's own effect through `magic:hit-effects`'
 * effectMultiplier (CombatSpells.ts: heal `damage × 0.25 × m`, poison `10/20 × m`, drain
 * `10%/15% × m`), the same route as the Ancient sceptre's ×1.1. Ice's freeze is left alone.
 *
 * Ours: the 10% Ice accuracy adds to the additive magic accuracy percentage (the one the smoke
 * battlestaff and salve amulet (i) use); the page doesn't say whether it is added or multiplied.
 * Only the activated staff (27920) has the passive; the inactive one can't be wielded (cache).
 */
let core;
const TIERS = ["RUSH", "BURST", "BLITZ", "BARRAGE"];
const SPEED = 4;
const ICE_ACCURACY_PERCENT = 10;
const EFFECT_MULTIPLIER = { BLOOD: 1.5, SMOKE: 2, SHADOW: 2 };

function wieldsStaff(entity) {
  if (!entity?.isPlayer?.()) return false;
  const weapon = entity.getAsPlayer().getEquipment().get(core.Equipment.WEAPON_SLOT);
  return weapon?.getId?.() === core.ItemIdentifiers.ZURIELS_STAFF_BH_;
}

/** The Ancient Magicks family ("ICE", "BLOOD", ...) `spell` belongs to, or null. */
function ancientFamily(spell) {
  if (spell == null) return null;
  for (const family of ["SMOKE", "SHADOW", "BLOOD", "ICE"]) {
    if (TIERS.some((tier) => core.CombatSpells[`${family}_${tier}`] === spell)) return family;
  }
  return null;
}

function attackSpeed(event) {
  if (event.combatType !== core.CombatType.MAGIC || !wieldsStaff(event.attacker)) return;
  const combat = event.attacker.getCombat();
  const spell = combat.getCastSpell() ?? combat.getPreviousCast();
  const book = spell?.getSpellbook?.();
  if (book !== core.MagicSpellbook.NORMAL && book !== core.MagicSpellbook.ANCIENT) return;
  event.speed = Math.min(event.speed, SPEED);
}

function iceAccuracy(entity, percent, spell) {
  return wieldsStaff(entity) && ancientFamily(spell) === "ICE" ? percent + ICE_ACCURACY_PERCENT : percent;
}

function ancientEffect(event) {
  if (!event.allowed || !wieldsStaff(event.attacker)) return;
  const multiplier = EFFECT_MULTIPLIER[ancientFamily(event.spell)];
  if (multiplier != null) event.effectMultiplier *= multiplier;
}

module.exports = {
  name: "ZurielsStaff",
  description: "Zuriel's staff (bh): standard and Ancient offensive spells cast in 4 ticks; Ice spells +10% accuracy, Blood spells heal 50% more, Smoke poison and Shadow Attack drain doubled.",
  members: true,
  register(api) {
    core = api.core;
    api.onAttackSpeed(attackSpeed);
    api.registerMagicAccuracyPercentModifier(iceAccuracy);
    api.onCustomEvent("magic:hit-effects", ancientEffect);
  },
  _test: { attackSpeed, iceAccuracy, ancientEffect, ancientFamily, wieldsStaff },
};
