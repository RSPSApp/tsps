"use strict";

/**
 * Task Storage (https://oldschool.runescape.wiki/w/Slayer_Rewards), bought on the Rewards
 * screen's Unlock tab (slayer_unlock_storage) and used from its Tasks tab:
 *
 * - Store (no task stored yet): the current task goes into storage and the player has none.
 * - Swap (a task stored and one current): the two change places.
 * - Unstore (a task stored, none current): the stored task becomes the current one.
 *
 * All three are free. A stored task keeps its master, boss, Mortimer modifier, count, area and
 * the Slayer XP its kills have given so far. The master, boss and modifier sit in the cache's
 * stored varbits (on slayer_stored_varp, saved with the other Slayer varps); the rest has no
 * varp of its own and is saved in STORED_ATTRIBUTE. The Tasks tab shows the stored task from
 * varps if4-if6 (count, task id, boss id), as it shows the current one from if1-if3.
 */
const State = require("./State.Slayer");
const Tasks = require("./Tasks.Slayer");

/** { target, count, original, area, xp } of the stored task, or null. */
const STORED_ATTRIBUTE = "slayer:stored-task";

/** The varbits a task's master, boss and modifier live in, current and stored. */
const STORED_VARBITS = [
  ["slayer_master", "slayer_master_stored"],
  ["slayer_target_bossid", "slayer_target_bossid_stored"],
  ["slayer_modifier_id", "slayer_modifier_id_stored"],
  ["slayer_modifier_value", "slayer_modifier_value_stored"],
  ["slayer_modifier_negative", "slayer_modifier_negative_stored"],
];

/** The stored task's own state, or null when nothing is stored. */
function stored(player) {
  const value = player.getAttribute(STORED_ATTRIBUTE);
  return value && typeof value === "object" && Number.isInteger(value.count) && value.count > 0 ? value : null;
}

function unlocked(player) {
  return State.varbit(player, "slayer_unlock_storage") === 1;
}

/** The current task's state: its varbits and varps, and the XP its kills gave. */
function takeCurrent(player) {
  const varbits = Object.fromEntries(STORED_VARBITS.map(([name]) => [name, State.varbit(player, name)]));
  const varps = {
    target: State.varp(player, "slayer_target"),
    count: State.varp(player, "slayer_count"),
    original: State.varp(player, "slayer_count_original"),
    area: State.varp(player, "slayer_area"),
  };
  const xp = Number(player.getAttribute(Tasks.TASK_XP_ATTRIBUTE)) || 0;
  return { varbits, ...varps, xp };
}

function takeStored(player) {
  const value = stored(player);
  if (!value) return null;
  const varbits = Object.fromEntries(STORED_VARBITS.map(([name, storedName]) => [name, State.varbit(player, storedName)]));
  return { varbits, target: value.target, count: value.count, original: value.original, area: value.area, xp: value.xp ?? 0 };
}

function putStored(player, task) {
  const varbits = task ? Object.fromEntries(STORED_VARBITS.map(([name, storedName]) => [storedName, task.varbits[name]])) :
    Object.fromEntries(STORED_VARBITS.map(([, storedName]) => [storedName, 0]));
  player.setAttribute(STORED_ATTRIBUTE, task
    ? { target: task.target, count: task.count, original: task.original, area: task.area, xp: task.xp }
    : null);
  State.update(player, varbits);
}

function putCurrent(player, task) {
  player.setAttribute(Tasks.TASK_XP_ATTRIBUTE, task.xp || null);
  State.update(player, task.varbits,
    { slayer_target: task.target, slayer_count: task.count, slayer_count_original: task.original, slayer_area: task.area });
}

/** Store, or swap with the stored task: the Tasks tab's Store/Swap button. */
function store(player) {
  if (!unlocked(player) || !Tasks.current(player)) return false;
  const current = takeCurrent(player);
  const previous = takeStored(player);
  if (previous) putCurrent(player, previous);
  else Tasks.clear(player);
  putStored(player, current);
  return true;
}

/** The stored task becomes the current one; only while the player has none. */
function unstore(player) {
  if (!unlocked(player) || Tasks.current(player)) return false;
  const task = takeStored(player);
  if (!task) return false;
  putCurrent(player, task);
  putStored(player, null);
  return true;
}

function attach(api) {
  api.persistAttribute(STORED_ATTRIBUTE, null);
}

module.exports = {
  attach,
  stored,
  store,
  unstore,
  STORED_ATTRIBUTE,
};
