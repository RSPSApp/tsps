/**
 * Shared by the Ironman units: the data, a player's mode, and setting it (the attribute, the
 * `ironman` varbit and the chat icon together).
 */
const fs = require("fs");
const path = require("path");

const MODE_ATTRIBUTE = "ironman:mode";
/** Set once a Hardcore Ironman has died and become a standard Ironman. */
const HARDCORE_DEAD_ATTRIBUTE = "ironman:hardcore-dead";

let api = null;
let core = null;
let data = null;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "ironman.json"), "utf8"));
}

function modeOf(player) {
  const mode = player?.getAttribute?.(MODE_ATTRIBUTE);
  return data.modes[mode] ? mode : "none";
}

/** Any Ironman (standard, Ultimate or Hardcore). */
function isIron(player) {
  return modeOf(player) !== "none";
}

function message(key, values = {}) {
  return data.messages[key].text.replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match);
}

/** The varbits the client reads for the account type (and a fallen Hardcore's record). */
function sendVarbits(player) {
  const sender = player.getPacketSender();
  sender.sendVarbit(data.varbits.mode, data.modes[modeOf(player)].varbit);
  if (player.getAttribute(HARDCORE_DEAD_ATTRIBUTE)) {
    sender.sendVarbit(data.varbits.hardcoreDead, 1);
    sender.sendVarbit(data.varbits.downgradePermitted, 1);
    sender.sendVarbit(data.varbits.hardcoreDowngradeDate, Number(player.getAttribute(HARDCORE_DEAD_ATTRIBUTE)) || 0);
  }
}

function setMode(player, mode) {
  player.setAttribute(MODE_ATTRIBUTE, mode === "none" ? null : mode);
  sendVarbits(player);
  api.emitCustomEvent("account:refresh-chat-icons", { player });
  api.emitCustomEvent("ironman:mode-changed", { player, mode: modeOf(player) });
}

module.exports = {
  init, modeOf, isIron, message, sendVarbits, setMode, MODE_ATTRIBUTE, HARDCORE_DEAD_ATTRIBUTE,
  get data() { return data; },
  get api() { return api; },
  get core() { return core; },
};
