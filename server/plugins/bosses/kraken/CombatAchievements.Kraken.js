"use strict";

/**
 * The Kraken's Combat Achievements (plugins/achievements/combatachievements/) that its fight
 * decides. Kraken Adept (20 kills) finishes from the kill count.
 *
 * - Unnecessary Optimisation: "Kill the Kraken after killing all four tentacles." The player
 *   killed four different tentacles while this Kraken was up. A tentacle killed while the Kraken
 *   is down comes back as its whirlpool (Respawn.Kraken.js), and the Kraken can't be disturbed
 *   until all four are up again, so only kills while it is up stay dead for the fight. The
 *   tentacles that die with the Kraken don't count; the Kraken is already dead.
 * - Krakan't Hurt Me, Ten-tacles, One Hundred Tentacles: "Kill the Kraken 25 / 50 / 100 times in
 *   a privately rented instance without leaving the room." Kills are counted per room, and a
 *   room lasts one stay: leaving (walking out, teleporting, dying or logging out) closes it
 *   (Instance.Kraken.js), and renting again opens a new one at 0.
 */

const Shared = require("./Shared.Kraken");
const Respawn = require("./Respawn.Kraken");

const UNNECESSARY_OPTIMISATION = "Unnecessary Optimisation";
const TENTACLES = 4;
const STREAKS = [["Krakan't Hurt Me", 25], ["Ten-tacles", 50], ["One Hundred Tentacles", 100]];

/** Private room -> Map(player -> Kraken kills in it). */
const roomKills = new WeakMap();
/** Private room -> Map(player -> spawn tiles of tentacles killed while its Kraken was up). */
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

function tentacleDied(event) {
  const { npc } = event;
  const player = playerKiller(event);
  if (!player || npc?.getId?.() !== Shared.ids().TENTACLE) return;
  const area = npc.getPrivateArea?.() ?? null;
  if (!Respawn.bossUp(area)) return;
  const byPlayer = tentacleKillsOf(npc);
  if (!byPlayer.has(player)) byPlayer.set(player, new Set());
  byPlayer.get(player).add(tileKey(npc));
}

function bossDied(event) {
  const { npc } = event;
  if (npc?.getId?.() !== Shared.ids().BOSS) return;
  const player = playerKiller(event);
  const killed = tentacleKillsOf(npc);
  resetTentacleKills(npc);
  if (!player) return;
  if ((killed.get(player)?.size ?? 0) >= TENTACLES) complete(player, UNNECESSARY_OPTIMISATION);

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
