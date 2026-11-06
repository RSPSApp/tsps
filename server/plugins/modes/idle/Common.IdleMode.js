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
/** Saved: what idle production makes ({ skill, kind, ..., productId, loadout, anchor }, Production). */
const PRODUCTION_TARGET_ATTRIBUTE = "idle-mode:production-target";
/** The three activities' targets: one at a time, so setting one clears the others. */
const ACTIVITY_ATTRIBUTES = [GATHER_TARGET_ATTRIBUTE, COMBAT_TARGET_ATTRIBUTE, PRODUCTION_TARGET_ATTRIBUTE];
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
/** Called with a player whenever something the Idle screen shows changed (Screen). */
const changeListeners = [];
let combatSkills = null;
let productionSkills = null;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "idle-mode.json"), "utf8"));
  skills = null;
  combatSkills = null;
  productionSkills = null;
}

function isIdle(player) {
  return player?.getAttribute?.(ENABLED_ATTRIBUTE) === true;
}

function setIdle(player, enabled) {
  player.setAttribute(ENABLED_ATTRIBUTE, enabled === true);
  syncLevelUps(player);
  changed(player);
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

/** Whether `skill` (a core Skill) is one idle production makes with ("production" "skills"). */
function idleProductionSkill(skill) {
  if (!productionSkills) productionSkills = new Set(data.production.skills.map((name) => core.Skill[name]).filter((value) => value !== undefined));
  return productionSkills.has(skill);
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

/** Idle Mode's own screens (Screen, TravelScreen add theirs): they don't stand in the way of work. */
const IDLE_SCREENS = new Set();

function registerScreen(groupId) {
  IDLE_SCREENS.add(groupId);
  // Being hit closes the player's interfaces (CombatFactory). These screens are what the player
  // watches while the character fights, so they are exempt; everything else still closes.
  core?.CombatInterfacePolicy?.keepOpenInCombat?.(groupId);
}

/** Free to go back to work, or only an Idle screen in the way (checked before anything is done). */
function mayWork(player) {
  return free(player) || IDLE_SCREENS.has(player.getInterfaceId?.());
}

/** What stands in the way of work besides an open Idle screen. */
function blockedBesidesScreen(player) {
  if (player.getMovementQueue().size() > 0) return true;
  const combat = player.getCombat?.();
  return Boolean(combat?.getTarget?.() || combat?.getAttacker?.());
}

/**
 * Free to go back to work, as `free`, except that an open Idle screen is closed for it: the player
 * may leave it open to watch, and a click on the world needs no interface open. Called right
 * before acting, so the screen only closes when there is work to do.
 *
 * Closing it only ever helps when the screen is the one thing in the way. Mid-fight it is not, so
 * closing it there bought nothing and shut the screen every time the next monster was picked.
 */
function readyToWork(player) {
  if (free(player)) return true;
  if (!IDLE_SCREENS.has(player.getInterfaceId?.())) return false;
  if (blockedBesidesScreen(player)) return false;
  player.getPacketSender().sendInterfaceRemoval();
  return free(player);
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

/** How many of an item the bank holds (the tab it is in). */
function bankAmount(player, itemId) {
  return player.getBank(core.Bank.getTabForItem(player, itemId)).getAmount(itemId);
}

/** Takes up to `amount` of an item out of the bank; how many it took. */
function bankTake(player, itemId, amount) {
  const taken = Math.min(Math.max(0, amount), bankAmount(player, itemId));
  if (taken > 0) player.getBank(core.Bank.getTabForItem(player, itemId)).deleteNumber(itemId, taken);
  return taken;
}

/** Sets one activity's target and clears the other two (one activity at a time). */
function setActivity(player, attribute, target) {
  for (const other of ACTIVITY_ATTRIBUTES) if (other !== attribute) player.setAttribute(other, null);
  player.setAttribute(attribute, target);
}

/** Players whose click Idle Mode itself is making right now (`act`). */
const acting = new Set();

/**
 * Runs `action`, a click Idle Mode makes for the player (an option on an object or NPC): what
 * listens for the player's own clicks (`isActing`) leaves it be, so it pauses nothing.
 */
function act(player, action) {
  acting.add(player);
  try {
    return action();
  } finally {
    acting.delete(player);
  }
}

function isActing(player) {
  return acting.has(player);
}

function onChange(listener) {
  changeListeners.push(listener);
}

/** Something the player's Idle screen shows changed: points, upgrades, a switch, the activity. */
function changed(player) {
  for (const listener of changeListeners) listener(player);
}

/** The Skill's key in core.Skill ("WOODCUTTING"): what a save keeps, as a Skill is an object. */
function skillKey(skill) {
  return Object.keys(core.Skill).find((key) => core.Skill[key] === skill) ?? null;
}

function skillName(skill) {
  const key = typeof skill === "string" ? skill : skillKey(skill);
  return key ? key.charAt(0) + key.slice(1).toLowerCase() : "Skill";
}

/**
 * The best food in the inventory, by its value (a shark before a shrimp), the first of equals:
 * its slot, id and the "Eat" option's click.
 */
function findFood(player) {
  const items = player.getInventory().getItems();
  let best = null;
  for (let slot = 0; slot < items.length; slot++) {
    const itemId = items[slot]?.getId?.();
    if (!Number.isInteger(itemId) || itemId < 0) continue;
    const actions = core.CacheDefinitions.getItem(itemId)?.inventoryActions ?? [];
    const index = actions.findIndex((action) => typeof action === "string" && action.toLowerCase() === "eat");
    if (index < 0) continue;
    const value = Number(core.ItemDefinition.forId(itemId)?.getValue?.()) || 0;
    if (!best || value > best.value) best = { slot, itemId, clickType: index + 1, value };
  }
  if (!best) return null;
  const { value, ...food } = best;
  return food;
}

/** Eats `food` (from `findFood`) as its click would. */
function eat(player, food) {
  core.ItemActionPacketListener.handleAction(player, core.Inventory.INTERFACE_ID, food.itemId, food.slot, food.clickType, "Eat");
}

function hitpointsPercent(player) {
  const max = player.getSkillManager().getMaxLevel(core.Skill.HITPOINTS);
  return max > 0 ? (player.getHitpoints() * 100) / max : 100;
}

function itemName(itemId) {
  return core.ItemDefinition.forId(itemId)?.getName?.() ?? `item ${itemId}`;
}

module.exports = {
  ENABLED_ATTRIBUTE,
  GATHER_TARGET_ATTRIBUTE,
  COMBAT_TARGET_ATTRIBUTE,
  PRODUCTION_TARGET_ATTRIBUTE,
  setActivity,
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
  idleProductionSkill,
  autoOn,
  chebyshev,
  free,
  registerScreen,
  readyToWork,
  mayWork,
  bank,
  bankHasRoom,
  bankAmount,
  bankTake,
  skillKey,
  onChange,
  changed,
  act,
  isActing,
  skillName,
  itemName,
  findFood,
  eat,
  hitpointsPercent,
  get api() { return api; },
  get core() { return core; },
  get data() { return data; },
};
