/**
 * The Idle Mode account flag: saved with the account, on for new accounts of an idle world
 * (world.json `"pluginConfig": { "IdleMode:newAccounts": true }`), and switched with `::idle`.
 */
const Common = require("./Common.IdleMode");
const Auto = require("./Auto.IdleMode");
const Progression = require("./Progression.IdleMode");
const Screen = require("./Screen.IdleMode");
const Travel = require("./Travel.IdleMode");
const TravelScreen = require("./TravelScreen.IdleMode");

const ON = ["on", "true", "1", "yes"];
const OFF = ["off", "false", "0", "no"];

/** An idle world makes new accounts idle; every login puts the level-up setting in step. */
function login({ player, isNewAccount }) {
  if (isNewAccount && Common.api.getPluginConfig(Common.NEW_ACCOUNTS_CONFIG, false) === true) Common.setIdle(player, true);
  else Common.syncLevelUps(player);
}

function describe(player) {
  return Common.isIdle(player)
    ? "Idle Mode is on: woodcutting, mining and fishing never stop, and keep going while you are logged out."
    : "Idle Mode is off. Type ::idle on to turn it on.";
}

/**
 * `::idle` opens the Idle screen; `::idle status` says whether it is on; `::idle on|off` sets it; `::idle auto [on|off]` is auto-resume;
 * `::idle points | shop | buy <upgrade>` are the idle points and upgrades; `::idle travel` opens
 * the travel screen, `::idle go <site>` travels and `::idle sites` lists the sites.
 */
function idleCommand({ player, parts }) {
  const choice = String(parts[1] ?? "").toLowerCase();
  if (choice === "auto") {
    const state = String(parts[2] ?? "").toLowerCase();
    Auto.autoCommand(player, ON.includes(state) ? "on" : OFF.includes(state) ? "off" : state);
    return true;
  }
  if (choice === "travel") {
    TravelScreen.open(player);
    return true;
  }
  if (Travel.COMMANDS.includes(choice)) {
    Travel.travelCommand(player, parts);
    return true;
  }
  if (Progression.COMMANDS.includes(choice)) {
    Progression.progressionCommand(player, parts);
    return true;
  }
  if (!choice) {
    Screen.open(player);
    return true;
  }
  if (ON.includes(choice)) Common.setIdle(player, true);
  else if (OFF.includes(choice)) Common.setIdle(player, false);
  else if (choice !== "status") {
    player.sendMessage("Use ::idle, ::idle [on|off|status], ::idle auto [on|off], ::idle travel, ::idle go <site>, ::idle points, ::idle shop or ::idle buy <upgrade>.");
    return true;
  }
  player.sendMessage(describe(player));
  return true;
}

module.exports = function attach(api) {
  api.persistAttribute(Common.ENABLED_ATTRIBUTE, false);
  api.onPlayerLogin(login);
  api.registerCommand("idle", idleCommand, api.core.PlayerRights.NONE, "Idle Mode: ::idle opens its screen; ::idle [on|off|status], ::idle auto [on|off], ::idle travel, ::idle go <site>, ::idle points, ::idle shop, ::idle buy <upgrade>");
};

module.exports.idleCommand = idleCommand;
