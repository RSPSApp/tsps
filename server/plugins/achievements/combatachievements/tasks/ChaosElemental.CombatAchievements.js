/**
 * The Chaos Elemental's Combat Achievements that its fight decides. Both fail for everyone involved
 * in the kill once any of them meets the condition (Wiki: Hoarder, The Flincher), so the boss
 * (ChaosElemental.plugin.js) keeps, for the rest of its life, the players it did it to:
 * - Hoarder: "Kill the Chaos Elemental without it unequipping any of your items." Madness that
 *   takes nothing (a full inventory, nothing worn) doesn't count.
 * - The Flincher: "Kill the Chaos Elemental without taking any damage from its attacks." A hit
 *   of 0 doesn't count.
 * Involved: the player and everyone who damaged it. Ours: a passer-by it disarmed or hit, who
 * took no part in the kill, fails neither.
 * The Chaos Elemental is one of data/monsters.json's ownRules: the derived "without taking any
 * damage from its attacks" rule reads only the player's own hits.
 * Chaos Elemental Adept and Veteran (10 and 25 kills) finish from the kill count.
 */
const { DISARMED_ATTRIBUTE, DAMAGED_ATTRIBUTE } = require("../../../bosses/ChaosElemental.plugin");

const NPC_NAME = "Chaos Elemental";

/** Nobody involved in the kill is among the players the boss marked so. */
const noneInvolved = (attribute) => (fight, event) => {
  const marked = fight.npc?.getAttribute?.(attribute);
  if (!marked?.size) return true;
  const involved = new Set([fight.player, ...(event?.damagers ?? [])]);
  return ![...involved].some((player) => marked.has(player));
};

module.exports = function attachChaosElementalTasks(_api, Fights) {
  Fights.onKill(NPC_NAME, {
    Hoarder: noneInvolved(DISARMED_ATTRIBUTE),
    "The Flincher": noneInvolved(DAMAGED_ATTRIBUTE),
  });
};
