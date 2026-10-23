"use strict";

/**
 * A player's Slayer state lives where OSRS keeps it, in the client's Slayer varps and varbits:
 * the task (slayer_count, slayer_target, slayer_count_original, slayer_target_bossid,
 * slayer_area), the master and points (slayer_master, slayer_points), the streaks
 * (slayer_tasks_completed, slayer_wilderness_tasks_completed), the unlocks
 * (slayer_rewards_unlocks*) and the block slots (slayer_blocked_*). The cache's own scripts
 * read them (the Rewards interface, the task overlay), so the server only keeps them current.
 *
 * They are saved as one snapshot (VARPS_ATTRIBUTE) and sent again on login. The attributes of
 * the old Slayer plugin (task, points, streak) are cleared on login.
 */
const VARPS_ATTRIBUTE = "slayer:varps";
const OLD_ATTRIBUTES = ["slayer:task", "slayer:points", "slayer:streak"];

/** Every varp a Slayer varbit sits on, plus the task varps (by gameval name). */
const PERSISTED_VARPS = [
  "slayer_count", "slayer_target", "slayer_count_original", "slayer_area",
  "slayer_killerwatt_var", "slayer_tasks_completed_1", "slayer_tasks_completed_2",
  "slayer_rewards_unlocks", "slayer_rewards_unlocks1", "slayer_rewards_unlocks2",
  "slayer_rewards_blocked", "slayer_rewards_blocked_2", "slayer_rewards_blocked_3",
  "slayer_rewards_blocked_4", "slayer_rewards_blocked_5", "slayer_rewards_blocked_6",
  "slayer_rewards_blocked_7", "slayer_rewards_blocked_8", "slayer_rewards_blocked_9",
  "slayer_rewards_blocked_10", "slayer_rewards_blocked_11", "slayer_rewards_blocked_12",
  "slayer_rewards_blocked_13", "slayer_rewards_blocked_14", "slayer_rewards_blocked_diary_1",
  "slayer_rewards_blocked_diary_2", "slayer_stored_varp", "slayer_modifiers",
  "slayer_mortimer_tasks_completed", "slayer_misc", "slayer_misc_perm", "slayer_misc_perm_2",
  "slayer_misc_perm_3",
  // Holds Mortimer's offered tasks (varbits slayer_choose_task_1..3 and _1_boss_id); the cache
  // names the varp after a Leagues relic, but no Leagues varbit sits on it.
  "slayer_league_relic_culling_spree",
];

/** Slayer varbits on varps that aren't Slayer's own (millcheck_multi): saved one by one. */
const PERSISTED_VARBITS = [
  "slayer_toggleoff_longerrevenants", "slayer_toggleoff_fossilwyvernblock", "slayer_toggleoff_superiormobs",
];

let core = null;
let pluginApi = null;
let persistedIds = null;

function init(api) {
  core = api.core;
  pluginApi = api;
}

function varbitId(name) {
  const id = core.CacheDefinitions.getVarbitId(name);
  if (id == null) throw new Error(`Slayer: no varbit named ${name}`);
  return id;
}

function varpId(name) {
  const id = core.CacheDefinitions.getVarpId(name);
  if (id == null) throw new Error(`Slayer: no varp named ${name}`);
  return id;
}

function persisted() {
  persistedIds ??= PERSISTED_VARPS.map((name) => core.CacheDefinitions.getVarpId(name)).filter((id) => id != null);
  return persistedIds;
}

function varbit(player, name) {
  return player.getPacketSender().getVarbit(varbitId(name));
}

function setVarbit(player, name, value) {
  player.getPacketSender().sendVarbit(varbitId(name), value);
  save(player);
  if (name === "slayer_points") pluginApi.emitCustomEvent("persistence:save", { player, reason: "slayer-points" });
}

function varp(player, name) {
  return player.getPacketSender().getVarp(varpId(name));
}

function setVarp(player, name, value) {
  player.getPacketSender().sendConfig(varpId(name), value);
  save(player);
}

/** Several changes, saved once. */
function update(player, varbits = {}, varps = {}) {
  const sender = player.getPacketSender();
  for (const [name, value] of Object.entries(varps)) sender.sendConfig(varpId(name), value);
  for (const [name, value] of Object.entries(varbits)) sender.sendVarbit(varbitId(name), value);
  save(player);
}

function save(player) {
  const sender = player.getPacketSender();
  const snapshot = {};
  for (const id of persisted()) {
    const value = sender.getVarp(id);
    if (value !== 0) snapshot[id] = value;
  }
  const varbits = {};
  for (const name of PERSISTED_VARBITS) {
    const id = core.CacheDefinitions.getVarbitId(name);
    const value = id == null ? 0 : sender.getVarbit(id);
    if (value !== 0) varbits[name] = value;
  }
  if (Object.keys(varbits).length) snapshot.varbits = varbits;
  player.setAttribute(VARPS_ATTRIBUTE, snapshot);
}

/** On login: the saved Slayer varps go back to the client; the old plugin's attributes go. */
function restore({ player }) {
  if (!player || player.isPlayerBot?.() === true) return;
  for (const name of OLD_ATTRIBUTES) {
    if (player.getAttribute(name) != null) player.setAttribute(name, null);
  }
  const snapshot = player.getAttribute(VARPS_ATTRIBUTE);
  if (!snapshot || typeof snapshot !== "object") return;
  const sender = player.getPacketSender();
  for (const [id, value] of Object.entries(snapshot)) {
    if (Number.isInteger(value)) sender.sendConfig(Number(id), value);
  }
  for (const [name, value] of Object.entries(snapshot.varbits ?? {})) {
    const id = core.CacheDefinitions.getVarbitId(name);
    if (id != null && Number.isInteger(value)) sender.sendVarbit(id, value);
  }
}

function attach(api) {
  api.persistAttribute(VARPS_ATTRIBUTE);
  api.onPlayerLogin(restore);
}

module.exports = {
  init,
  attach,
  varbit,
  setVarbit,
  varp,
  setVarp,
  update,
  restore,
  VARPS_ATTRIBUTE,
};
