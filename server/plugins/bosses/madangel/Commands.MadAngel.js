/**
 * Developer commands for testing the Mad Angel: ::madangelhp <hitpoints> sets the player's
 * own angel's hitpoints (360 to see the enrage, a few to finish it off).
 */
const Instance = require("./Instance.MadAngel");

function setAngelHitpoints({ player, parts }) {
  const angel = Instance.sessionOf(player)?.boss;
  const hitpoints = Number(parts?.[1]);
  if (!angel || angel.getHitpoints() <= 0) {
    player.sendMessage("You are not in a cathedral with the Mad Angel.");
    return true;
  }
  if (!Number.isInteger(hitpoints) || hitpoints < 1) {
    player.sendMessage("Use ::madangelhp <hitpoints>.");
    return true;
  }
  angel.setHitpoints(hitpoints);
  player.sendMessage(`The Mad Angel now has ${hitpoints} hitpoints.`);
  return true;
}

module.exports = function attachCommands(api) {
  api.registerCommand("madangelhp", setAngelHitpoints, api.core.PlayerRights.DEVELOPER, "Set your Mad Angel's hitpoints");
};
