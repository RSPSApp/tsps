"use strict";

/**
 * Killerwatts hit hard unless the player wears insulated boots (docs/killerwatt.md): their
 * melee tops out at 6 with the boots on, and both their attacks reach 15 without them
 * (https://oldschool.runescape.wiki/w/Killerwatt). The monster dump holds one max hit (8) for
 * the NPC, so the hit is re-rolled to the wearer's maximum after its accuracy is known and
 * before protection prayers reduce it.
 */
const KILLERWATT_NAME = "Killerwatt";
const INSULATED_BOOTS_NAME = "Insulated boots";
const INSULATED_MELEE_MAX_HIT = 6;
const UNINSULATED_MAX_HIT = 15;

let core = null;

function wearsInsulatedBoots(player) {
  const boots = player.getEquipment().get(core.Equipment.FEET_SLOT);
  return boots?.getDefinition?.()?.getName?.() === INSULATED_BOOTS_NAME;
}

function isKillerwatt(attacker) {
  return attacker.isNpc() && attacker.getCurrentDefinition?.()?.getName?.() === KILLERWATT_NAME;
}

function scaleKillerwattHit({ attacker, target, combatType, damage, accurate }) {
  if (!accurate || !target.isPlayer() || !isKillerwatt(attacker)) return;
  const insulated = wearsInsulatedBoots(target.getAsPlayer());
  if (insulated && combatType !== core.CombatType.MELEE) return;
  const maximum = insulated ? INSULATED_MELEE_MAX_HIT : UNINSULATED_MAX_HIT;
  damage.setDamage(core.Misc.randomInclusive(0, maximum));
}

module.exports = {
  name: "Killerwatt",
  members: true,
  register(api) {
    core = api.core;
    api.onCombatHitDamage(scaleKillerwattHit);
  },
};
