"use strict";

const Data = require("./Data.BirthdayAnniversary");
const Scene = require("./Scene.BirthdayAnniversary");
const FOLLOW_TASK_KEY = "birthday-2026:followers";
const parents = new Map();
const swaps = [];
const followers = new Map();
let task = null;

function live(api, npc) { return npc?.isRegistered?.() && api.core.World.getNpcs().get(npc.getIndex()) === npc; }
function remove(api, npc) { npc.setFollowing(null); npc.setMobileInteraction(null); api.removeNpc(npc); }
function spawn(api, row, extra = {}) {
  const id = Scene.archivedId(api, "npc", row.symbol);
  if (id === null) throw new Error("Missing archived actor " + row.symbol);
  const npc = api.spawnNpc({ id, x: row.x, y: row.y, z: row.z, wanderRadius: row.wander ?? 0, face: api.core.Direction[row.face ?? "SOUTH"].getId(), ...extra });
  if (!npc || !live(api, npc)) throw new Error("No world capacity for 25th Anniversary actor " + row.symbol);
  npc.__skipDefaultRespawn = true;
  return npc;
}
function open(api) {
  if (parents.size) return { handled: true };
  try {
    for (const row of Data.SPAWNS) parents.set(row.role, spawn(api, row, { unique: "birthday-2026:" + row.role }));
    for (const row of Data.NATIVE_SWAPS) swapIn(api, row);
    if (!task) {
      task = new (class FollowerLeash extends api.core.Task {
        constructor() { super(1, FOLLOW_TASK_KEY); }
        execute() { leash(api); }
      })();
      api.getTaskManager().submit(task);
    }
    return { handled: true };
  } catch (error) {
    close(api);
    return { handled: false, error: error.message };
  }
}
function atSwap(location, row) {
  return location.getX() === row.x && location.getY() === row.y && location.getZ() === row.z;
}
/**
 * The native spawn steps aside for the archived event version on the same tile: a loaded
 * one goes back to the spawn loader's pending list, and onCanSpawnNpc keeps it there while
 * the event runs, so it returns through the loader (still tracked) when the window closes.
 */
function swapIn(api, row) {
  const c = api.core, nativeId = c.CacheDefinitions.getNpcId(row.native);
  const record = { row, nativeId };
  swaps.push(record);
  for (const native of [...c.World.getNpcs()]) {
    if (!native || native.getId() !== nativeId || native.getOwner?.() || !atSwap(native.getSpawnPosition(), row)) continue;
    if (!c.NpcSpawnDefinitionLoader.requeue(native)) throw new Error("The native " + row.native + " is not a world spawn");
  }
  const id = Scene.archivedId(api, "npc", row.symbol);
  // npc-spawns stands BigRedJapan facing south (direction 6).
  record.npc = api.spawnNpc({ id, x: row.x, y: row.y, z: row.z, wanderRadius: 0, face: c.Direction.SOUTH.getId(), unique: "birthday-2026:swap:" + row.symbol });
  if (!record.npc) throw new Error("No world capacity for the event " + row.symbol);
  record.npc.__skipDefaultRespawn = true;
  parents.set("swap:" + row.symbol, record.npc);
}
/** onCanSpawnNpc: while the event runs, the native copy stays pending underneath. */
function vetoNative(api, event) {
  if (swaps.some(row => row.nativeId === event.npcId && event.location && atSwap(event.location, row.row))) event.allow = false;
}
function swapOut(api) {
  const records = swaps.splice(0);
  for (const record of records) if (record.npc && live(api, record.npc)) remove(api, record.npc);
  // The veto is gone: the loader spawns the native again for anyone already nearby.
  if (records.length) for (const player of api.core.World.getPlayers()) {
    if (player?.isRegistered()) api.core.NpcSpawnDefinitionLoader.activateNear(player.getLocation(), player.getNpcViewDistance());
  }
}
function close(api) {
  swapOut(api);
  for (const player of [...followers.keys()]) dismiss(api, player, false);
  for (const npc of parents.values()) if (live(api, npc)) remove(api, npc);
  parents.clear();
  if (task) { task.stop(); task = null; }
  api.core.TaskManager.cancelTasks(FOLLOW_TASK_KEY);
  return { handled: true };
}
function role(api, npc) {
  for (const [name, parent] of parents) if (parent === npc && live(api, npc)) return name.startsWith("swap:") ? null : name;
  for (const [, follower] of followers) if (follower === npc && live(api, npc)) return "follower";
  return null;
}
function follower(player) { return followers.get(player) ?? null; }
function parentFor(api, name) { const npc = parents.get(name); return live(api, npc) ? npc : null; }
function following(player) { return followers.has(player); }
function gap(npc, player) {
  const a = npc.getLocation(), b = player.getLocation();
  return { plane: a.getZ() !== b.getZ(), tiles: Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY())) };
}
/** Gary is "with the player" while his follower is near the owner on the same plane. */
function withPlayer(api, player) {
  const npc = followers.get(player);
  if (!npc || !live(api, npc)) return false;
  const distance = gap(npc, player);
  return !distance.plane && distance.tiles <= Data.FOLLOW_CATCH_UP;
}
function summon(api, player) {
  if (followers.has(player) || !Scene.active()) return false;
  const location = player.getLocation();
  const npc = spawn(api, { symbol: Data.FOLLOWER, x: location.getX(), y: location.getY(), z: location.getZ() }, { owner: player });
  npc.setOwner(player);
  npc.setArea(player.getArea());
  npc.setFollowing(player);
  npc.setMobileInteraction(player);
  followers.set(player, npc);
  api.emitCustomEvent("birthday-2026:changed", { player });
  return true;
}
/** Gary goes back to his spot outside the house (the transcript's "teleports back"). */
function dismiss(api, player, notify = true) {
  const npc = followers.get(player);
  if (!npc) return false;
  followers.delete(player);
  if (live(api, npc)) remove(api, npc);
  if (notify) api.emitCustomEvent("birthday-2026:changed", { player });
  return true;
}
const strayed = new WeakSet();
/** 0 inside the event's Varrock squares, 1 in a square bordering them, 2 further away. */
function distanceFromVarrock(location) {
  const x = location.getX() >> 6, y = location.getY() >> 6;
  if (Data.VARROCK_SQUARES.has(x + "_" + y)) return 0;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (Data.VARROCK_SQUARES.has((x + dx) + "_" + (y + dy))) return 1;
  return 2;
}
function inHouse(location) {
  const h = Data.HOUSE, x = location.getX(), y = location.getY();
  return location.getZ() === h.z && x >= h.minX && x <= h.maxX && y >= h.minY && y <= h.maxY;
}
/** One task visits only active followers: teleports, a lost leash and the return to the house. */
function leash(api) {
  for (const [player, npc] of [...followers]) {
    if (!player.isRegistered() || !live(api, npc)) { dismiss(api, player, player.isRegistered()); continue; }
    const location = player.getLocation();
    // A teleport loses Gary; a ladder or a lead he can't keep up with only makes him catch up.
    const distance = gap(npc, player);
    if (distance.tiles > Data.FOLLOW_LEASH) { dismiss(api, player); continue; }
    if (distance.plane || distance.tiles > Data.FOLLOW_CATCH_UP) npc.moveTo(location.clone());
    const course = distanceFromVarrock(location);
    if (course === 0) strayed.delete(player);
    else if (course === 2) { dismiss(api, player); continue; }
    else if (!strayed.has(player)) {
      strayed.add(player);
      api.emitCustomEvent("birthday-2026:strayed", { player, npc });
    }
    // Once the player stops upstairs: a conversation opened mid-walk would close at the next step.
    if (inHouse(location) && player.getMovementQueue().size() === 0) api.emitCustomEvent("birthday-2026:arrived", { player });
  }
}

module.exports = { open, close, vetoNative, role, follower, parentFor, following, withPlayer, summon, dismiss, inHouse, live };
