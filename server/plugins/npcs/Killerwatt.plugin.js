"use strict";

/**
 * Killerwatts hit hard unless the player wears insulated boots (docs/killerwatt.md): their
 * melee tops out at 6 with the boots on, and both their attacks reach 15 without them
 * (https://oldschool.runescape.wiki/w/Killerwatt). The monster dump holds one max hit (8) for
 * the NPC, so the hit is re-rolled to the wearer's maximum after its accuracy is known and
 * before protection prayers reduce it. Both maxima come from the Wiki's labelled max hits
 * (npc-max-hits.json, read through the NPC definition's getMaxHits()).
 */
const KILLERWATT_NAME = "Killerwatt";
const INSULATED_BOOTS_NAME = "Insulated boots";
const INSULATED_MELEE_LABEL = "Melee";
const UNINSULATED_LABEL_PART = "without insulated boots";
// The Wiki's values, for data from before npc-max-hits.json.
const FALLBACK_INSULATED_MELEE_MAX_HIT = 6;
const FALLBACK_UNINSULATED_MAX_HIT = 15;

let core = null;

function wearsInsulatedBoots(player) {
  const boots = player.getEquipment().get(core.Equipment.FEET_SLOT);
  return boots?.getDefinition?.()?.getName?.() === INSULATED_BOOTS_NAME;
}

function killerwattDefinition(attacker) {
  if (!attacker.isNpc()) return null;
  const definition = attacker.getCurrentDefinition?.();
  return definition?.getName?.() === KILLERWATT_NAME ? definition : null;
}

function listedMaxHit(definition, matches, fallback) {
  const entry = (definition.getMaxHits?.() ?? []).find((hit) => typeof hit.label === "string" && matches(hit.label));
  return Number.isInteger(entry?.maxHit) ? entry.maxHit : fallback;
}

function insulatedMeleeMaxHit(definition) {
  return listedMaxHit(definition, (label) => label === INSULATED_MELEE_LABEL, FALLBACK_INSULATED_MELEE_MAX_HIT);
}

function uninsulatedMaxHit(definition) {
  return listedMaxHit(definition, (label) => label.toLowerCase().includes(UNINSULATED_LABEL_PART), FALLBACK_UNINSULATED_MAX_HIT);
}

function scaleKillerwattHit({ attacker, target, combatType, damage, accurate }) {
  if (!accurate || !target.isPlayer()) return;
  const definition = killerwattDefinition(attacker);
  if (!definition) return;
  const insulated = wearsInsulatedBoots(target.getAsPlayer());
  if (insulated && combatType !== core.CombatType.MELEE) return;
  const maximum = insulated ? insulatedMeleeMaxHit(definition) : uninsulatedMaxHit(definition);
  damage.setDamage(core.Misc.randomInclusive(0, maximum));
}

module.exports = {
  name: "Killerwatt",
  description: "Makes Killerwatts hit hard unless the player wears insulated boots, rerolling their hits to max 6 with the boots on and 15 without.",
  members: true,
  register(api) {
    core = api.core;
    api.onCombatHitDamage(scaleKillerwattHit);
  },
};
