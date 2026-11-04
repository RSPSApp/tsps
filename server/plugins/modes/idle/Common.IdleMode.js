/**
 * Shared by the Idle Mode units: the data, whether an account is idle, and the bank helpers the
 * gathering and the offline progress both use.
 */
const fs = require("fs");
const path = require("path");

/** The account flag: on, the listed skills gather endlessly and keep going while logged out. */
const ENABLED_ATTRIBUTE = "idle-mode:enabled";
/** world.json pluginConfig: new accounts start idle (an idle world). */
const NEW_ACCOUNTS_CONFIG = "IdleMode:newAccounts";

let api = null;
let core = null;
let data = null;
let skills = null;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "idle-mode.json"), "utf8"));
  skills = null;
}

function isIdle(player) {
  return player?.getAttribute?.(ENABLED_ATTRIBUTE) === true;
}

function setIdle(player, enabled) {
  player.setAttribute(ENABLED_ATTRIBUTE, enabled === true);
}

/** Whether `skill` (a core Skill) is one Idle Mode gathers. */
function idleSkill(skill) {
  if (!skills) skills = new Set(data.skills.map((name) => core.Skill[name]).filter((value) => value !== undefined));
  return skills.has(skill);
}

/** An idle player gathering one of the idle skills. */
function idleGather(player, skill) {
  return isIdle(player) && idleSkill(skill);
}

function bankHasRoom(player, itemId) {
  const container = player.getBank(core.Bank.getTabForItem(player, itemId));
  return container.getFreeSlots() > 0 || container.contains(itemId);
}

/** Puts `amount` of an item in the bank when it has room; false leaves it with the caller. */
function bank(player, itemId, amount) {
  if (amount <= 0 || !bankHasRoom(player, itemId)) return false;
  player.getBank(core.Bank.getTabForItem(player, itemId)).add(new core.Item(itemId, amount), true);
  return true;
}

/** The Skill's key in core.Skill ("WOODCUTTING"): what a save keeps, as a Skill is an object. */
function skillKey(skill) {
  return Object.keys(core.Skill).find((key) => core.Skill[key] === skill) ?? null;
}

function skillName(skill) {
  const key = typeof skill === "string" ? skill : skillKey(skill);
  return key ? key.charAt(0) + key.slice(1).toLowerCase() : "Skill";
}

function itemName(itemId) {
  return core.ItemDefinition.forId(itemId)?.getName?.() ?? `item ${itemId}`;
}

module.exports = {
  ENABLED_ATTRIBUTE,
  NEW_ACCOUNTS_CONFIG,
  init,
  isIdle,
  setIdle,
  idleSkill,
  idleGather,
  bank,
  bankHasRoom,
  skillKey,
  skillName,
  itemName,
  get api() { return api; },
  get core() { return core; },
  get data() { return data; },
};
