"use strict";

/**
 * The Bounty Hunter target overlay: pvp_icons (interface 90), mounted permanently by
 * Wilderness.plugin.js. Its cache scripts draw everything from varbits, so this only feeds them:
 *
 * - script 386 shows the target block (90:5) while map_flags_cached has bit 5, the
 *   Bounty Hunter world flag (script 3), and bh_in_bh is 1;
 * - script 3144 (on target_transmit, varp 1130) writes "---" without target_exists, "Lobby"
 *   while target_wildernesslevel is 0, else "Crater (Nearby!)" / "Crater (<bh_target_distance
 *   x 10>m)", and shows the Skip button; the name (90:15) is the only text the server sends;
 * - script 3148 counts "Lobby time remaining:" down from bh_lobby_timer (ticks of a 200-tick
 *   allowance) while in the lobby with a target, else "Pile-jumping immunity:" from
 *   target_pj_countdown ((value - 2) x 2 ticks).
 *
 * This server isn't a Bounty Hunter world, so the world flag is only raised inside the crater.
 * Every send is skipped when the client already has the value, so syncing each tick is cheap.
 */

const PVP_ICONS = 90;
const TARGET_NAME_UID = (PVP_ICONS << 16) | 15;
const PVP_LAYOUT_SCRIPT = 386;
const VARP_MAP_FLAGS_CACHED = "map_flags_cached";
const MAP_FLAG_BH_WORLD = 1 << 5;
const VARBIT_PVP_OR_BH_WORLD = "this_is_a_pvp_or_bh_world";
const VARBIT_TARGET_EXISTS = "target_exists";
const VARBIT_TARGET_WILDERNESS_LEVEL = "target_wildernesslevel";
const VARBIT_TARGET_DISTANCE = "bh_target_distance";
const VARBIT_IN_BH = "bh_in_bh";
const VARBIT_IN_LOBBY = "bh_in_lobby";
const VARBIT_LOBBY_TIMER = "bh_lobby_timer";
const VARBIT_PJ_COUNTDOWN = "target_pj_countdown";
const DISTANCE_MAX = 63; // 6 bits
const METRES_PER_STEP = 10;
const PJ_COUNTDOWN_OFFSET = 2;

let core;
let bh;
/** player -> last hint key, so moving distant targets update without repeating stationary hints. */
const hinted = new WeakMap();

function varbit(name) {
  return core.CacheDefinitions.getVarbitId(name);
}

function setVarbit(sender, name, value) {
  const id = varbit(name);
  if (sender.getVarbit(id) !== value) sender.sendVarbit(id, value);
}

function distanceStep(player, target) {
  const a = player.getLocation();
  const b = target.getLocation();
  const tiles = Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY()));
  return Math.min(DISTANCE_MAX, Math.floor(tiles / METRES_PER_STEP));
}

/** Brings the overlay in line with the player's state; leaving the crater clears it. */
function sync(player) {
  if (!player || player.isPlayerBot?.() === true) return;
  const sender = player.getPacketSender();
  const inCrater = bh.inCrater(player);
  const target = inCrater ? bh.targetOf(player) : null;

  const flagsVarp = core.CacheDefinitions.getVarpId(VARP_MAP_FLAGS_CACHED);
  const flags = sender.getVarp(flagsVarp);
  const wanted = inCrater ? flags | MAP_FLAG_BH_WORLD : flags & ~MAP_FLAG_BH_WORLD;
  const relayout = wanted !== flags || sender.getVarbit(varbit(VARBIT_IN_BH)) !== (inCrater ? 1 : 0);
  // Wilderness.plugin.js rewrites this varp on login; the next tick here puts the flag back.
  if (wanted !== flags) sender.sendConfig(flagsVarp, wanted);
  setVarbit(sender, VARBIT_PVP_OR_BH_WORLD, inCrater ? 1 : 0);
  setVarbit(sender, VARBIT_IN_BH, inCrater ? 1 : 0);
  setVarbit(sender, VARBIT_IN_LOBBY, bh.inLobby(player) ? 1 : 0);
  sender.sendString(target ? target.getDisplayName() : "", TARGET_NAME_UID);
  setVarbit(sender, VARBIT_TARGET_WILDERNESS_LEVEL, target && bh.inArena(target) ? 1 : 0);
  setVarbit(sender, VARBIT_TARGET_DISTANCE, target ? distanceStep(player, target) : 0);
  setVarbit(sender, VARBIT_TARGET_EXISTS, target ? 1 : 0);
  if (relayout) sender.sendClientScript(PVP_LAYOUT_SCRIPT);

  const at = target?.getLocation();
  const local = target && player.getLocalPlayers().includes(target);
  const hint = !target ? null : local ? `p:${target.getIndex()}` : `t:${at.getX()},${at.getY()},${at.getZ()}`;
  if (hinted.get(player) !== hint) {
    if (local) sender.sendPlayerHint(target);
    else if (target) sender.sendPositionalHint(at, 2, 0, at.getZ());
    else if (hinted.has(player)) sender.clearHintArrow();
    hinted.set(player, hint);
  }
}

/** Ticks already spent in the lobby with this target; the client counts on from there. */
function sendLobbyTimer(player, ticks) {
  if (player.isPlayerBot?.() !== true) player.getPacketSender().sendVarbit(varbit(VARBIT_LOBBY_TIMER), ticks);
}

/** The "Pile-jumping immunity:" countdown, for the rogue immunity after entering the arena. */
function sendImmunity(player, ticks) {
  if (player.isPlayerBot?.() === true) return;
  const value = ticks > 0 ? PJ_COUNTDOWN_OFFSET + Math.ceil(ticks / 2) : 0;
  player.getPacketSender().sendVarbit(varbit(VARBIT_PJ_COUNTDOWN), value);
}

module.exports = function attachHud(api, state) {
  core = api.core;
  bh = state;
};

Object.assign(module.exports, { sync, sendLobbyTimer, sendImmunity, _test: { distanceStep } });
