"use strict";

/**
 * The Kraken's Combat Achievements (plugins/achievements/combatachievements/) that its fight
 * decides. Kraken Adept (20 kills) finishes from the kill count.
 *
 * - Unnecessary Optimisation: "Kill the Kraken after killing all four tentacles." When the Kraken
 *   dies, the player was the last to kill each of the four tentacles, and none of them has come
 *   back since. The tentacles may die before the Kraken is woken (the Wiki allows it), but one
 *   killed while the Kraken is down respawns as its whirlpool on its own timer
 *   (Respawn.Kraken.js), and its credit goes once it is back on its tile. The tentacles that die
 *   with the Kraken respawn with it before the next fight, so they never carry into it.
 * - Krakan't Hurt Me, Ten-tacles, One Hundred Tentacles: "Kill the Kraken 25 / 50 / 100 times in
 *   a privately rented instance without leaving the room." Kills are counted per room, and a
 *   room lasts one stay: leaving (walking out, teleporting, dying or logging out) closes it
 *   (Instance.Kraken.js), and renting again opens a new one at 0.
 */

const Shared = require("./Shared.Kraken");

const UNNECESSARY_OPTIMISATION = "Unnecessary Optimisation";
const TENTACLES = 4;
const STREAKS = [["Krakan't Hurt Me", 25], ["Ten-tacles", 50], ["One Hundred Tentacles", 100]];

/** Private room -> Map(player -> Kraken kills in it). */
const roomKills = new WeakMap();
/** Private room -> Map(tentacle spawn tile -> the player who last killed the tentacle there). */
const roomTentacleKills = new WeakMap();
/** The same, for the open cove. */
let publicTentacleKills = new Map();

/** The tentacle kills of the fight `npc` is in. */
function tentacleKillsOf(npc) {
  const room = npc?.getPrivateArea?.();
  if (!room) return publicTentacleKills;
  if (!roomTentacleKills.has(room)) roomTentacleKills.set(room, new Map());
  return roomTentacleKills.get(room);
}

/** Whether a tentacle, or its whirlpool, is back on `tile` in `area`. */
function respawned(area, tile) {
  const { TENTACLE, TENTACLE_WHIRLPOOL } = Shared.ids();
  for (const other of Shared.core().World.getNpcs() ?? []) {
    if (!other?.isNpc?.() || !Shared.alive(other)) continue;
    if (other.getId?.() !== TENTACLE && other.getId?.() !== TENTACLE_WHIRLPOOL) continue;
    if ((other.getPrivateArea?.() ?? null) === area && tileKey(other) === tile) return true;
  }
  return false;
}

/** The next Kraken there is a new fight. */
function resetTentacleKills(npc) {
  const room = npc?.getPrivateArea?.();
  if (room) roomTentacleKills.delete(room);
  else publicTentacleKills = new Map();
}

const complete = (player, task) => Shared.api().emitCustomEvent("combat-achievements:complete", { player, task });

function playerKiller(event) {
  const killer = event?.killer;
  return killer?.isPlayer?.() ? killer.getAsPlayer?.() ?? killer : null;
}

function tileKey(npc) {
  const at = npc.getSpawnPosition?.() ?? npc.getLocation?.();
  return at ? `${at.getX()},${at.getY()},${at.getZ()}` : String(npc.getIndex?.());
}

/** A tentacle's death, whether the Kraken is up or still a whirlpool: its tile is the killer's. */
function tentacleDied(event) {
  const { npc } = event;
  const player = playerKiller(event);
  if (!player || npc?.getId?.() !== Shared.ids().TENTACLE) return;
  tentacleKillsOf(npc).set(tileKey(npc), player);
}

/** How many tentacles `player` killed that are still dead. */
function deadTentaclesKilledBy(player, kills, area) {
  let count = 0;
  for (const [tile, killer] of kills) if (killer === player && !respawned(area, tile)) count++;
  return count;
}

function bossDied(event) {
  const { npc } = event;
  if (npc?.getId?.() !== Shared.ids().BOSS) return;
  const player = playerKiller(event);
  const killed = tentacleKillsOf(npc);
  resetTentacleKills(npc);
  if (!player) return;
  if (deadTentaclesKilledBy(player, killed, npc.getPrivateArea?.() ?? null) >= TENTACLES) complete(player, UNNECESSARY_OPTIMISATION);

  const room = npc.getPrivateArea?.();
  if (room?.isKrakenInstance !== true || room.isDestroyed?.() || player.getPrivateArea?.() !== room) return;
  if (!roomKills.has(room)) roomKills.set(room, new Map());
  const counts = roomKills.get(room);
  const kills = (counts.get(player) ?? 0) + 1;
  counts.set(player, kills);
  for (const [task, needed] of STREAKS) if (kills >= needed) complete(player, task);
}

function attach(api) {
  api.onNpcDeath(tentacleDied);
  api.onNpcDeath(bossDied);
}

module.exports = {
  attach, tentacleDied, bossDied,
  _test: { roomKills, STREAKS, UNNECESSARY_OPTIMISATION, TENTACLES },
};
