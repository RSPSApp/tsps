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
 * The ice ancient sceptre gives "an additional 10% accuracy bonus" to Ice spells "on targets that can
 * be frozen and are not currently frozen" (Wiki: Ice ancient sceptre). Ours: "can be frozen" is the
 * freeze's own rule (CombatFactory.freezeTicks: no freeze or freeze immunity running, a freeze
 * resistance under 100, and a large NPC only when it opts in or has a partial resistance), and the
 * 10% adds to the additive magic accuracy percentage, as Zuriel's staff's Ice accuracy does; the page
 * doesn't say whether it is added or multiplied.
 * Not modelled: the smoke ancient sceptre's 20% healing reduction on poisoned targets, as tsps has no
 * healing-reduction effect yet.
 * The list of ids is Autocasting.ancientSceptres(), which also lets them autocast Ancient Magicks.
 */
let core;
const TIERS = ["RUSH", "BURST", "BLITZ", "BARRAGE"];
const BLOOD_SCEPTRES = ["BLOOD_ANCIENT_SCEPTRE_2", "BLOOD_ANCIENT_SCEPTRE_L_"];
const ICE_SCEPTRES = ["ICE_ANCIENT_SCEPTRE_2", "ICE_ANCIENT_SCEPTRE_L_"];
const ICE_ACCURACY_PERCENT = 10;
/** Large NPCs that can be frozen carry this flag (CombatFactory.freezeTicks). */
const FREEZABLE_FLAG = "combat:freezable";
/** The Blood spell heal, with any bloodbark armour's scale (BloodbarkArmour.EquipmentEffects). */
const { bloodSpellHeal } = require("../combat/effects/BloodbarkArmour.EquipmentEffects");
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

/** Whether a freeze would take hold on `target` now, by CombatFactory.freezeTicks' own checks. */
function canBeFrozenNow(target) {
  const timers = target?.getTimers?.();
  if (!timers || timers.has(core.TimerKey.FREEZE) || timers.has(core.TimerKey.FREEZE_IMMUNITY)) return false;
  const resistance = target.isNpc?.() ? target.getAsNpc().getCurrentDefinition?.()?.getFreezeResistance?.() ?? 0 : 0;
  if (resistance >= 100) return false;
  return target.getSize() <= 2 || target.hasFlag(FREEZABLE_FLAG) || resistance > 0;
}

/** The ice sceptre's +10% Ice spell accuracy against a target that can be frozen and isn't frozen. */
function iceAccuracy(entity, percent, spell) {
  if (spellTier(spell, "ICE") < 0 || !ICE_SCEPTRES.some((name) => core.ItemIdentifiers[name] === weaponId(entity))) return percent;
  return canBeFrozenNow(core.hitTargetOf(entity)) ? percent + ICE_ACCURACY_PERCENT : percent;
}

/** After the base heal (capped at full Hitpoints), lets the same heal run on to 110% of the caster's Hitpoints level. */
function bloodOverheal(event) {
  if (!overheals.has(event)) return;
  const before = overheals.get(event);
  overheals.delete(event);
  const player = event.attacker;
  const max = player.getSkillManager().getMaxLevel(core.Skill.HITPOINTS);
  const heal = bloodSpellHeal(event, core);
  const target = Math.min(before + heal, Math.max(before, Math.floor(max * (1 + OVERHEAL))));
  if (target > player.getHitpoints()) player.setHitpoints(target);
}

module.exports = {
  name: "AncientSceptre",
  description: "Ancient sceptre passive: boosts the Ancient magic smoke, shadow, blood and ice spell effects by 10%, for the quartz sceptres too; the blood ancient sceptre's Blood spells overheal by 10%; the ice ancient sceptre's Ice spells are 10% more accurate against targets that can be frozen.",
  members: true,
  register(api) {
    core = api.core;
    api.onCustomEvent("magic:hit-effects", enhanceAncientEffect);
    api.onCustomEvent("magic:hit-effects-applied", bloodOverheal);
    api.registerMagicAccuracyPercentModifier(iceAccuracy);
  },
  _test: { iceAccuracy, canBeFrozenNow },
};
