/**
 * The Chaos Elemental's Combat Achievements that its fight decides. Both fail for everyone in the
 * kill once any player meets the condition (Wiki: Hoarder, The Flincher), so the boss
 * (ChaosElemental.plugin.js) marks itself for the rest of its life:
 * - Hoarder: "Kill the Chaos Elemental without it unequipping any of your items." Madness that
 *   takes nothing (a full inventory, nothing worn) doesn't count.
 * - The Flincher: "Kill the Chaos Elemental without taking any damage from its attacks." A hit
 *   of 0 doesn't count.
 * The Chaos Elemental is one of data/monsters.json's ownRules: the derived "without taking any
 * damage from its attacks" rule reads only the player's own hits.
 * Chaos Elemental Adept and Veteran (10 and 25 kills) finish from the kill count.
 */
const { DISARMED_ATTRIBUTE, DAMAGED_ATTRIBUTE } = require("../../../bosses/ChaosElemental.plugin");

const NPC_NAME = "Chaos Elemental";

const unmarked = (attribute) => (fight) => fight.npc?.getAttribute?.(attribute) !== true;

module.exports = function attachChaosElementalTasks(_api, Fights) {
  Fights.onKill(NPC_NAME, {
    Hoarder: unmarked(DISARMED_ATTRIBUTE),
    "The Flincher": unmarked(DAMAGED_ATTRIBUTE),
  });
};
