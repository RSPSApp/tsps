/**
 * The Idle Mode account flag: saved with the account, on for new accounts of an idle world
 * (world.json `"pluginConfig": { "IdleMode:newAccounts": true }`), and switched with `::idle`.
 */
const Common = require("./Common.IdleMode");
const Auto = require("./Auto.IdleMode");

const ON = ["on", "true", "1", "yes"];
const OFF = ["off", "false", "0", "no"];

function newAccount({ player, isNewAccount }) {
  if (isNewAccount && Common.api.getPluginConfig(Common.NEW_ACCOUNTS_CONFIG, false) === true) Common.setIdle(player, true);
}

function describe(player) {
  return Common.isIdle(player)
    ? "Idle Mode is on: woodcutting, mining and fishing never stop, and keep going while you are logged out."
    : "Idle Mode is off. Type ::idle on to turn it on.";
}

/** `::idle` says whether it is on; `::idle on|off` sets it; `::idle auto [on|off]` is auto-resume. */
function idleCommand({ player, parts }) {
  const choice = String(parts[1] ?? "").toLowerCase();
  if (choice === "auto") {
    const state = String(parts[2] ?? "").toLowerCase();
    Auto.autoCommand(player, ON.includes(state) ? "on" : OFF.includes(state) ? "off" : state);
    return true;
  }
  if (ON.includes(choice)) Common.setIdle(player, true);
  else if (OFF.includes(choice)) Common.setIdle(player, false);
  else if (choice) {
    player.sendMessage("Use ::idle on, ::idle off or ::idle auto [on|off].");
    return true;
  }
  player.sendMessage(describe(player));
  return true;
}

module.exports = function attach(api) {
  api.persistAttribute(Common.ENABLED_ATTRIBUTE, false);
  api.onPlayerLogin(newAccount);
  api.registerCommand("idle", idleCommand, api.core.PlayerRights.NONE, "Show or set Idle Mode: ::idle [on|off], ::idle auto [on|off]");
};

module.exports.idleCommand = idleCommand;
