"use strict";

/**
 * The escape crystal (22517, tob_teleport): what the units share. Its settings (Auto-afk, the
 * inactivity timer, ring of life, use on party members) are the Theatre of Blood unit's, asked
 * with `escape-crystal:settings`, so one configuration serves every activity.
 */
const CRYSTAL_OBJ = "tob_teleport";
const DEFAULT_DELAY = 30;
const SECONDS_PER_TICK = 0.6;
/** Wiki: right after logging in the first hit fires it; how long that lasts is an estimate. */
const LOGIN_GRACE_TICKS = 10;
const RING_OF_LIFE_FRACTION = 0.1;
/** Wiki: it works in the Wilderness up to level 30. */
const WILDERNESS_LIMIT = 30;

let api = null;
let crystal = null;
const loginCycles = new WeakMap();

function bind(pluginApi) {
  api = pluginApi;
  crystal = api.core.CacheDefinitions.getObjId(CRYSTAL_OBJ);
}

function core() {
  return api.core;
}

function pluginApi() {
  return api;
}

function crystalId() {
  return crystal;
}

function cycle() {
  return core().World.getProcessCycle();
}

function wears(player) {
  const { Equipment } = core();
  return player.getEquipment().getItems()[Equipment.RING_SLOT]?.getId() === crystal;
}

function carries(player) {
  return player.getInventory().contains(crystal) || wears(player);
}

/** One crystal gone: the inventory's first, else the worn one. */
function useUp(player) {
  const { Equipment, Item } = core();
  if (player.getInventory().contains(crystal)) {
    player.getInventory().delete(crystal, 1);
    return true;
  }
  if (!wears(player)) return false;
  const equipment = player.getEquipment();
  const worn = equipment.getItems()[Equipment.RING_SLOT];
  if (worn.getAmount() > 1) worn.setAmount(worn.getAmount() - 1);
  else equipment.setItem(Equipment.RING_SLOT, new Item(-1, 0));
  equipment.refreshItems();
  return true;
}

/** Auto-afk, its delay, ring of life and use on party members, as Configure left them. */
function settingsOf(player) {
  const request = { player, afk: false, delay: DEFAULT_DELAY, ring: false, teammates: false };
  api.emitCustomEvent("escape-crystal:settings", request);
  return request;
}

function loggedIn(player) {
  loginCycles.set(player, cycle());
}

/** Armed and idle past its timer (or just logged in), and standing still. */
function afkFires(player, settings = settingsOf(player)) {
  if (!settings.afk || !carries(player)) return false;
  if (player.getMovementQueue().isMovings()) return false;
  const now = cycle();
  if (now - (loginCycles.get(player) ?? -LOGIN_GRACE_TICKS - 1) <= LOGIN_GRACE_TICKS) return true;
  return (now - (player.lastInputCycle ?? 0)) * SECONDS_PER_TICK >= settings.delay;
}

/** Worn, set to act as a ring of life, and this hit leaves the player at 10% or less. */
function ringFires(player, damage, settings = settingsOf(player)) {
  if (!settings.ring || !wears(player)) return false;
  const max = player.getSkillManager().getMaxLevel(core().Skill.HITPOINTS);
  const after = player.getHitpoints() - damage;
  return after > 0 && after <= max * RING_OF_LIFE_FRACTION;
}

module.exports = {
  WILDERNESS_LIMIT, bind, core, api: pluginApi, crystalId, cycle, wears, carries, useUp, settingsOf,
  loggedIn, afkFires, ringFires,
};
