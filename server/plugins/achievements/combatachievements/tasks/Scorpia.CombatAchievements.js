/**
 * Scorpia's Combat Achievement that the fight decides. Guardians No More (Wiki: "Kill Scorpia
 * without killing her guardians"): the fight (Scorpia.WildernessBosses.js) marks her when one of
 * the guardians she calls is killed; a guardian that despawns idle does not count.
 */
const { GUARDIAN_KILLED_ATTRIBUTE } = require("../../../bosses/wildernessbosses/Scorpia.WildernessBosses");

module.exports = function attachScorpiaTasks(_api, Fights) {
  Fights.onKill("Scorpia", {
    "Guardians No More": (_fight, event) => event.npc.getAttribute(GUARDIAN_KILLED_ATTRIBUTE) !== true,
  });
};
