/**
 * Sarachnis' Combat Achievements that the fight decides (docs/sarachnis.md). The kill-count
 * tasks (Novice, Champion) finish from kill counts on their own; these three read the fight:
 * Newspaper Enthusiast wants every hit crush (cf. KBD Hide Penetration), while Ready to
 * Pounce and Inspect Repellent read what the boss did, tracked on the NPC by the fight
 * (Fight.Sarachnis.js): two ranged attacks in a row, and any damage she dealt to anyone.
 */
const Common = require("../../../bosses/sarachnis/Common.Sarachnis");

module.exports = function attachSarachnisTasks(_api, Fights) {
  Fights.onKill("Sarachnis", {
    "Newspaper Enthusiast": (fight) => fight.onlyMelee("crush"),
    "Ready to Pounce": (_fight, event) => event.npc.getAttribute(Common.ATTR_RANGED_TWICE) !== true,
    "Inspect Repellent": (_fight, event) => event.npc.getAttribute(Common.ATTR_DEALT_DAMAGE) !== true,
  });
};
