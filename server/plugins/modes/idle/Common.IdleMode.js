/**
 * Shared by the Idle Mode units: the data, whether an account is idle, and the bank helpers the
 * gathering and the offline progress both use.
 */
const fs = require("fs");
const path = require("path");

/** The account flag: on, the listed skills gather endlessly and keep going while logged out. */
const ENABLED_ATTRIBUTE = "idle-mode:enabled";
/** Saved: what auto-resume gathers ({ skill, kind, name, option, anchor }, Auto). */
const GATHER_TARGET_ATTRIBUTE = "idle-mode:auto-target";
/** Saved: what idle combat fights ({ name, anchor }, Combat). One of the two at a time. */
const COMBAT_TARGET_ATTRIBUTE = "idle-mode:combat-target";
/** Saved: false when the player turned auto-resume (gathering and combat) off. */
const AUTO_ATTRIBUTE = "idle-mode:auto";
/** Read by SkillLevelUp: true carries the player's actions on through a level-up, with no pop-up. */
const KEEP_ACTIONS_ATTRIBUTE = "level-up:keep-actions";
/** world.json pluginConfig: new accounts start idle (an idle world). */
const NEW_ACCOUNTS_CONFIG = "IdleMode:newAccounts";

let api = null;
let core = null;
let data = null;
let skills = null;
let combatSkills = null;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "idle-mode.json"), "utf8"));
  skills = null;
  combatSkills = null;
}

function isIdle(player) {
  return player?.getAttribute?.(ENABLED_ATTRIBUTE) === true;
}

function setIdle(player, enabled) {
  player.setAttribute(ENABLED_ATTRIBUTE, enabled === true);
  syncLevelUps(player);
}

/** An idle account's level-up pop-up does not hold its work ("gathering" `levelUpPopups`). */
function syncLevelUps(player) {
  player.setAttribute(KEEP_ACTIONS_ATTRIBUTE, isIdle(player) && !data.gathering.levelUpPopups);
}

/** Whether `skill` (a core Skill) is one Idle Mode gathers. */
function idleSkill(skill) {
  if (!skills) skills = new Set(data.skills.map((name) => core.Skill[name]).filter((value) => value !== undefined));
  return skills.has(skill);
}

/** The core Skills idle combat trains. */
function combatSkillList() {
  if (!combatSkills) combatSkills = data.combat.skills.map((name) => core.Skill[name]).filter((value) => value !== undefined);
  return combatSkills;
}

function idleCombatSkill(skill) {
  return combatSkillList().includes(skill);
}

/** Auto-resume is on: Idle Mode, its data switch and the player's own (`::idle auto`). */
function autoOn(player) {
  return isIdle(player) && player.getAttribute(AUTO_ATTRIBUTE) !== false;
}

function chebyshev(location, point) {
  return Math.max(Math.abs(location.getX() - point.x), Math.abs(location.getY() - point.y));
}

/** Whether the player is free for the character to go back to work. */
function free(player) {
  if (player.busy?.() || player.getMovementQueue().size() > 0) return false;
  const combat = player.getCombat?.();
  return !combat?.getTarget?.() && !combat?.getAttacker?.();
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
  GATHER_TARGET_ATTRIBUTE,
  COMBAT_TARGET_ATTRIBUTE,
  AUTO_ATTRIBUTE,
  NEW_ACCOUNTS_CONFIG,
  init,
  isIdle,
  setIdle,
  syncLevelUps,
  idleSkill,
  idleGather,
  combatSkillList,
  idleCombatSkill,
  autoOn,
  chebyshev,
  free,
  bank,
  bankHasRoom,
  skillKey,
  skillName,
  itemName,
  get api() { return api; },
  get core() { return core; },
  get data() { return data; },
};
