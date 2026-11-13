/**
 * Shared by the Ironman units: the data, a player's mode, and setting it (the attribute, the
 * `ironman` varbit and the chat icon together), and whether two Group Ironmen share a group.
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

/** Any Ironman (standard, Ultimate, Hardcore or Group). */
function isIron(player) {
  return modeOf(player) !== "none";
}

/** Any of the three Group Ironman modes (Group, Hardcore Group, Unranked Group). */
function isGroup(player) {
  return data.groupModes.includes(modeOf(player));
}

/**
 * A Group Ironman and `other` (a player, or a login name such as a ground item's owner) in the same
 * Group Ironman group, by the Grouping plugin ("grouping:same-group"). Members in their leaving
 * period still count (Wiki: they can still trade with the group).
 */
function groupMate(player, other) {
  if (!isGroup(player) || other == null || other === player) return false;
  if (typeof other !== "string" && !isGroup(other)) return false;
  const query = { player, other, same: false, ironman: false };
  api.emitCustomEvent("grouping:same-group", query);
  return query.same === true && query.ironman === true;
}

/** "As an Ironman", "As a Group Ironman", ...: the player's own mode, for the lines that name it. */
function asMode(player) {
  const label = data.modes[modeOf(player)]?.label ?? "Ironman";
  return `As ${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}`;
}

function message(key, values = {}) {
  return data.messages[key].text.replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match);
}

/** The varbits the client reads for the account type (and a fallen Hardcore's record). */
function sendVarbits(player) {
  const sender = player.getPacketSender();
  sender.sendVarbit(data.varbits.mode, data.modes[modeOf(player)].varbit);
  sender.sendVarbit(data.varbits.bankChestAccess, data.modes[modeOf(player)].chests ?? 0);
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
  init, modeOf, isIron, isGroup, groupMate, asMode, message, sendVarbits, setMode, MODE_ATTRIBUTE, HARDCORE_DEAD_ATTRIBUTE,
  get data() { return data; },
  get api() { return api; },
  get core() { return core; },
};
