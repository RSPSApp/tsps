/**
 * Leagues VI placeholder: the ordinary four-phase Guardians on a private roof, dressed by
 * EchoBosses in the Echo appearance and Wiki combat profiles, not live Echo mechanics.
 * Replace this adapter once Echo Guardians captures are found and examined; ordinary fights share no state.
 */
const Common = require("./Common.GrotesqueGuardians");
const Roof = require("./Roof.GrotesqueGuardians");
const ECHO_SLAYER_LEVEL = 75;

function start(event) {
  if (event.boss !== "grotesque-guardians" || event.handled) return;
  event.handled = true;
  const { player } = event;
  if (Roof.roofOf(player)) return;
  if (player.getAttribute(Common.UNLOCKED_ATTRIBUTE) !== true) { player.sendMessage(Common.message("locked")); return; }
  // No task is needed for the Echo, but the level is (the cache's leagues_echo_grotesque_guardians row: "75 Slayer").
  if (player.getSkillManager().getMaxLevel(Common.core.Skill.SLAYER) < ECHO_SLAYER_LEVEL) {
    player.sendMessage(`You need a Slayer level of ${ECHO_SLAYER_LEVEL} to fight the Echo of the Grotesque Guardians.`);
    return;
  }
  const claim = { player, boss: event.boss, token: null };
  Common.api.emitCustomEvent("echo-boss:claim", claim);
  if (!claim.token) return;
  Roof.goUp(player, { token: claim.token });
}
module.exports = function attach(api) {
  api.onCustomEvent("echo-boss:start", start);
};
Object.assign(module.exports, { start });
