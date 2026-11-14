/**
 * https://oldschool.runescape.wiki/w/Ancient_sceptre?action=raw#Passive_effect
 * All Ancient effects ×1.1: smoke severity 10/20→11/22, Shadow drain 10%/15%→11%/16.5%,
 * Blood healing 25%→27.5%, Ice floor(8/16/24/32 ×1.1)→8/17/26/35 ticks.
 * Smoke's 1/8 poison chance is unchanged: https://oldschool.runescape.wiki/w/Smoke_spells?action=raw
 * Shadow drains monsters with any weapon (CombatSpells.ts shadowDrainNpc); the sceptre only scales it.
 *
 * The four quartz sceptres keep that passive ("Like its predecessor, it will increase the effects of
 * Ancient Magicks by 10%", Wiki: Blood/Ice/Smoke/Shadow ancient sceptre), as do their locked (l) copies.
 * The blood ancient sceptre also lets Blood spells overheal "up to 10% over the player's base
 * Hitpoints" (Wiki: Blood ancient sceptre; 99 Hitpoints reaches 108, so the cap is floor(max × 1.1)).
 * The list of ids is Autocasting.ancientSceptres(), which also lets them autocast Ancient Magicks.
 */
let core;
const TIERS = ["RUSH", "BURST", "BLITZ", "BARRAGE"];
const BLOOD_SCEPTRES = ["BLOOD_ANCIENT_SCEPTRE_2", "BLOOD_ANCIENT_SCEPTRE_L_"];
const BLOOD_HEAL = 0.25;
const OVERHEAL = 0.1;
/** The caster's Hitpoints when a blood sceptre's Blood spell hit was calculated, before its base heal. */
const overheals = new WeakMap();

function weaponId(cast) {
  if (!cast?.isPlayer?.()) return -1;
  return cast.getEquipment().get(core.Equipment.WEAPON_SLOT)?.getId?.() ?? -1;
}

function hasSceptre(cast) {
  return core.Autocasting.ancientSceptres().includes(weaponId(cast));
}

function spellTier(spell, family) {
  return TIERS.findIndex((name) => core.CombatSpells[`${family}_${name}`] === spell);
}

function enhanceAncientEffect(event) {
  if (!event.allowed || !hasSceptre(event.attacker)) return;
  if (["SMOKE", "SHADOW", "BLOOD", "ICE"].some((family) => spellTier(event.spell, family) >= 0)) {
    event.effectMultiplier *= 1.1;
  }
  if (spellTier(event.spell, "BLOOD") >= 0 && BLOOD_SCEPTRES.some((name) => core.ItemIdentifiers[name] === weaponId(event.attacker))) {
    overheals.set(event, event.attacker.getHitpoints());
  }
}

/** After the base heal (capped at full Hitpoints), lets the same heal run on to 110% of the caster's Hitpoints level. */
function bloodOverheal(event) {
  if (!overheals.has(event)) return;
  const before = overheals.get(event);
  overheals.delete(event);
  const player = event.attacker;
  const max = player.getSkillManager().getMaxLevel(core.Skill.HITPOINTS);
  const heal = Math.floor(event.hit.getTotalDamage() * (BLOOD_HEAL * event.effectMultiplier));
  const target = Math.min(before + heal, Math.max(before, Math.floor(max * (1 + OVERHEAL))));
  if (target > player.getHitpoints()) player.setHitpoints(target);
}

module.exports = {
  name: "AncientSceptre",
  description: "Ancient sceptre passive: boosts the Ancient magic smoke, shadow, blood and ice spell effects by 10%, for the quartz sceptres too; the blood ancient sceptre's Blood spells overheal by 10%.",
  members: true,
  register(api) {
    core = api.core;
    api.onCustomEvent("magic:hit-effects", enhanceAncientEffect);
    api.onCustomEvent("magic:hit-effects-applied", bloodOverheal);
  },
};
