"use strict";

/**
 * Shared data for the Knight Waves Training Ground.
 *
 * Waves (Wiki): Sir Bedivere, Sir Pelleas, Sir Tristram, Sir Palomedes, Sir Lucan, Sir Gawain,
 * Sir Kay, Sir Lancelot. Their cache NPC ids are 4361 down to 4354, the reverse of the numeric
 * order, and every one carries a full combat definition in monsters-complete.json.
 *
 * The room's walkable floor was read from the cache collision at plane 2: the large doors at
 * 2751,3507-3508 open onto it from the west, the dummies stand on its north edge at y 3514, and
 * the walls close it at x 2748/2768 and y 3497/3517.
 */

const WAVE_ATTRIBUTE = "knight-waves:wave";
const COMPLETE = 8;
const KNIGHT_WAVES_STATE_VARBIT = 3909;
const KINGS_RANSOM_KEY = "kings_ransom";

/** The training room on Camelot Castle's top floor (plane 2), east of the large doors. */
const ROOM = Object.freeze({ minX: 2754, maxX: 2766, minY: 3498, maxY: 3516, z: 2 });
/** West of the large doors, beside the squire: where refusals and deaths put the player. */
const OUTSIDE = Object.freeze({ x: 2750, y: 3507, z: 2 });
/** The first free floor tile north of the room's centre. */
const SPAWN = Object.freeze({ x: 2759, y: 3510, z: 2 });
/** Wiki infobox music: Camelot (track 104). */
const MUSIC = 104;

/**
 * Wiki wave table in fight order. `drains` combines the activity page's table with the
 * individual knights' pages (which also name Ranged and Magic); the amount is Wiki-documented
 * only for Sir Lancelot ("by 5 each"), and is applied to every knight.
 */
const KNIGHTS = Object.freeze([
  { id: 4361, name: "Sir Bedivere", drains: ["STRENGTH", "RANGED", "MAGIC"] },
  { id: 4360, name: "Sir Pelleas", drains: ["DEFENCE"] },
  { id: 4359, name: "Sir Tristram", drains: ["STRENGTH", "RANGED", "MAGIC"] },
  { id: 4358, name: "Sir Palomedes", drains: ["ATTACK", "RANGED", "MAGIC"] },
  { id: 4357, name: "Sir Lucan", drains: ["DEFENCE", "ATTACK"] },
  { id: 4356, name: "Sir Gawain", drains: ["ATTACK"] },
  { id: 4355, name: "Sir Kay", drains: ["DEFENCE"] },
  { id: 4354, name: "Sir Lancelot", drains: ["DEFENCE", "STRENGTH"] },
]);

/** Wiki only gives Sir Lancelot's amount; the same five is used for every knight. */
const DRAIN_PER_HIT = 5;
/** Wiki: a knight despawns if the fight takes too long. The duration is not published; ours is five minutes. */
const TIMEOUT_TICKS = 500;
/** Wiki rewards: 20,000 XP in each of the four combat stats. */
const REWARD_XP = 20_000;
const REWARD_ATTRIBUTE = "knight-waves:rewards";
const CAMELOT_RESPAWN = "camelot";

const MESSAGES = Object.freeze({
  needKingsRansom: "You need to have completed the King's Ransom quest to enter the Knight Waves.",
  complete: "I'm afraid not, my liege. Once you have won, you cannot re-enter.",
  meleeOnly: "Only melee combat is allowed in the Knight Waves Training Ground.",
  noPrayer: "You can't use Prayer in the Knight Waves Training Ground.",
  wave: (n, name) => `${name} steps forward. (Wave ${n} of ${COMPLETE})`,
  finished: "You have defeated all eight knights of the Round Table.",
  timeout: "The knight has waited long enough and returns to his post.",
  reward: "You gain 20,000 experience in Attack, Strength, Defence and Hitpoints.",
});

let api;
let core;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

/** `quest:is-complete` for King's Ransom, as the other plugins ask it. */
function kingsRansomComplete(player) {
  const request = { player, key: KINGS_RANSOM_KEY, complete: null };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

/** How many knights this player has already beaten (0-8). */
function completed(player) {
  return Math.max(0, Math.min(COMPLETE, Number(player.getAttribute(WAVE_ATTRIBUTE) ?? 0)));
}

/** Persist the new count and mirror it to the client's KR_KNIGHTWAVES_STATE varbit. */
function setCompleted(player, value) {
  const count = Math.max(0, Math.min(COMPLETE, value));
  player.setAttribute(WAVE_ATTRIBUTE, count);
  player.getPacketSender?.().sendVarbit?.(KNIGHT_WAVES_STATE_VARBIT, count);
  return count;
}

/** The knight for a zero-based wave index. */
function knightAt(index) {
  return KNIGHTS[index] ?? null;
}

/** A tile in the room. */
function roomLocation(x, y) {
  return new core.Location(x, y, ROOM.z);
}

function outsideLocation() {
  return new core.Location(OUTSIDE.x, OUTSIDE.y, OUTSIDE.z);
}

/** Whether the player is standing in the training room. */
function inRoom(player) {
  const location = player?.getLocation?.();
  return !!location && location.getZ() === ROOM.z
    && location.getX() >= ROOM.minX && location.getX() <= ROOM.maxX
    && location.getY() >= ROOM.minY && location.getY() <= ROOM.maxY;
}

/** Answers `knight-waves:is-complete` for the prayer unlock gate. */
function answerComplete(event) {
  if (event?.player) event.complete = completed(event.player) >= COMPLETE;
}

/** Answers `knight-waves:progress`, the varbit value 0-8. */
function answerProgress(event) {
  if (event?.player) event.progress = completed(event.player);
}

/** Submit a one-shot task, as the other minigames' `later` helpers do. */
function later(ticks, action) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() { super(Math.max(1, ticks), null, false); }
    execute() { this.stop(); action(); }
  })());
}

module.exports = {
  WAVE_ATTRIBUTE,
  COMPLETE,
  KNIGHT_WAVES_STATE_VARBIT,
  KINGS_RANSOM_KEY,
  ROOM,
  OUTSIDE,
  SPAWN,
  MUSIC,
  KNIGHTS,
  DRAIN_PER_HIT,
  TIMEOUT_TICKS,
  REWARD_XP,
  REWARD_ATTRIBUTE,
  CAMELOT_RESPAWN,
  MESSAGES,
  init,
  kingsRansomComplete,
  completed,
  setCompleted,
  knightAt,
  roomLocation,
  outsideLocation,
  inRoom,
  answerComplete,
  answerProgress,
  later,
  get api() { return api; },
  get core() { return core; },
};
