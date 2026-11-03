/**
 * `::ironman` shows a player's account type; `::ironman <none|ironman|ultimate|hardcore> [player]`
 * sets it (yours without a name). The only way to set one for now: there's no Ironman tutor yet.
 */
const Common = require("./Common.Ironman");

function ironmanCommand({ player, parts }) {
  const { World } = Common.core;
  const mode = String(parts[1] ?? "").toLowerCase();
  const name = parts.slice(2).join(" ").trim();
  const target = name ? World.getPlayerByName(name) : player;
  if (!target) {
    player.sendMessage(`No player called ${name} is online.`);
    return true;
  }
  if (!mode) {
    player.sendMessage(`${target.getDisplayName()}: ${Common.data.modes[Common.modeOf(target)].label}.`);
    return true;
  }
  if (!Common.data.modes[mode]) {
    player.sendMessage(`Use ::ironman <${Object.keys(Common.data.modes).join("|")}> [player].`);
    return true;
  }
  Common.setMode(target, mode);
  player.sendMessage(`${target.getDisplayName()} is now: ${Common.data.modes[mode].label}.`);
  if (target !== player) target.sendMessage(`Your account type is now: ${Common.data.modes[mode].label}.`);
  return true;
}

module.exports = function attach(api) {
  api.registerCommand("ironman", ironmanCommand, api.core.PlayerRights.ADMINISTRATOR, "Show or set an account's Ironman mode: ::ironman [none|ironman|ultimate|hardcore] [player]");
};
