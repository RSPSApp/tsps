"use strict";

/**
 * Tentacle/boss respawn cycle (see ../Kraken.plugin.js for behaviour and sources).
 *
 * Wiki-mirroring shared-fight rules (estimates where the Wiki is silent):
 * - A tentacle killed while the Kraken is up stays dead: no mid-fight trickle respawn.
 * - Killing the Kraken kills its remaining tentacles with it (they drop nothing — they
 *   have no drop table), then boss + tentacles respawn together as whirlpools once the
 *   boss's own respawn timer elapses.
 * - A tentacle killed while the Kraken is down respawns normally as its whirlpool.
 * Deaths respawn as whirlpools because the engine clears the transformation first.
 *
 * State is keyed by private area (open world included). Private rooms retain their
 * own independent standalone and joint timers and discard them on room closure.
 * A server restart clears memory; public whirlpools come from npc-spawns.json.
 */

const Shared = require("./Shared.Kraken");

/** Areas with a joint respawn scheduled: their deaths join it instead of respawning. */
const simultaneousPending = new Set();
/** Area -> whirlpools to respawn together: [{ id, at }]. */
const deadByArea = new Map();
const privatePending = new Map();
const privateJointTentacles = new WeakSet();

function later(ticks, action, key = null) {
  const { Task, TaskManager } = Shared.core();
  const task = new (class extends Task {
      constructor() {
      super(Math.max(1, ticks), key, false);
      }
      execute() {
        this.stop();
        action();
      }
    })();
  TaskManager.submit(task);
  return task;
}

function schedulePrivate(area, delay, entries = null) {
  if (area.isDestroyed()) return;
  // TSPS backpressure: retry at the existing respawn delay when world capacity
  // temporarily prevents an atomic private batch; this is not a retail timer.
  const nextDelay = Math.max(1, delay);
  const task = later(nextDelay, () => {
    const tasks = privatePending.get(area);
    tasks?.delete(task);
    if (tasks?.size === 0) privatePending.delete(area);
    respawnPrivate(area, nextDelay, entries);
  }, area);
  let tasks = privatePending.get(area);
  if (!tasks) { tasks = new Set(); privatePending.set(area, tasks); }
  tasks.add(task);
}

function respawnPrivate(area, delay, entries) {
  if (area.isDestroyed()) { releaseArea(area); return; }
  // null is the boss's joint batch. Standalone tentacles each retain their own
  // timer and never pull deaths that must wait until the boss dies.
  const list = entries ?? deadByArea.get(area) ?? [];
  if (list.some(entry => entry.previous?.isDyingFunction?.() || entry.previous?.isRegistered?.())
    || (list.length && !area.spawnBatch(list))) {
    schedulePrivate(area, delay, entries);
    return;
  }
  if (entries === null) {
    deadByArea.delete(area);
    simultaneousPending.delete(area);
  }
}

function areaOf(npc) {
  return npc?.getPrivateArea?.() ?? null;
}

function deadList(area) {
  let list = deadByArea.get(area);
  if (!list) {
    list = [];
    deadByArea.set(area, list);
  }
  return list;
}

function livingIn(area, npcId) {
  let World = null;
  try {
    World = Shared.core().World;
  } catch {
    return [];
  }
  const found = [];
  for (const other of World?.getNpcs?.() ?? []) {
    if (!other?.isNpc?.()) continue;
    if (other.getId?.() !== npcId) continue;
    if (!Shared.alive(other)) continue;
    if (other.getPrivateArea?.() !== area) continue;
    found.push(other);
  }
  return found;
}

/** Whether the Kraken is currently up in `area`. */
function bossUp(area) {
  return livingIn(area, Shared.ids().BOSS).length > 0;
}

function tentacleDied({ npc }) {
  if (!npc || npc.getId?.() !== Shared.ids().TENTACLE) return;
  const area = areaOf(npc);
  if (privateJointTentacles.has(npc)) {
    npc.__skipDefaultRespawn = true;
    return;
  }
  if (area?.isKrakenInstance === true && area.isDestroyed()) {
    npc.__skipDefaultRespawn = true;
    return;
  }
  if (simultaneousPending.has(area) || bossUp(area)) {
    // Mid-fight (or fight cleanup): stay dead, come back with the rest after the fight.
    npc.__skipDefaultRespawn = true;
    if (area?.isKrakenInstance === true) {
      privateJointTentacles.add(npc);
      deadList(area).push({ id: Shared.ids().TENTACLE_WHIRLPOOL, at: npc.getSpawnPosition(), previous: npc });
    } else {
      deadList(area).push({ id: Shared.ids().TENTACLE_WHIRLPOOL, at: npc.getSpawnPosition() });
    }
    return;
  }
  if (area?.isKrakenInstance === true) {
    npc.__skipDefaultRespawn = true;
    const entries = [{ id: Shared.ids().TENTACLE_WHIRLPOOL, at: npc.getSpawnPosition(), previous: npc }];
    const delay = npc.getDefinition?.()?.getRespawn?.() ?? 25;
    schedulePrivate(area, delay, entries);
    return;
  }
  // Boss is down: a normal respawn as the whirlpool.
  npc.__skipDefaultRespawn = false;
}

function respawnAll(area) {
  const { NPC, World } = Shared.core();
  for (const { id, at } of (deadByArea.get(area) ?? []).splice(0)) {
    try {
      World.getAddNPCQueue().push(NPC.create(id, at));
    } catch {
      // One failed spawn must not block the rest.
    }
  }
  deadByArea.delete(area);
  simultaneousPending.delete(area);
}

function bossDied({ npc }) {
  if (!npc || npc.getId?.() !== Shared.ids().BOSS) return;
  const area = areaOf(npc);
  if (area?.isKrakenInstance === true && area.isDestroyed()) {
    npc.__skipDefaultRespawn = true;
    return;
  }
  simultaneousPending.add(area);
  npc.__skipDefaultRespawn = true;
  deadList(area).push({ id: Shared.ids().BOSS_WHIRLPOOL, at: npc.getSpawnPosition(),
    ...(area?.isKrakenInstance === true ? { previous: npc } : {}) });
  // NPCDeathTask emits a death event only when it found a player killer. In a
  // private room a tentacle killed by the boss cleanup may have no such event,
  // including one already dying; capture it before scheduling the joint batch.
  const tentacles = area?.isKrakenInstance === true
    ? [...Shared.core().World.getNpcs()].filter(other => other?.isNpc?.() && other.isRegistered?.()
      && other.getId?.() === Shared.ids().TENTACLE && other.getPrivateArea?.() === area)
    : livingIn(area, Shared.ids().TENTACLE);
  for (const tentacle of tentacles) {
    try {
      if (area?.isKrakenInstance === true && !privateJointTentacles.has(tentacle)) {
        privateJointTentacles.add(tentacle);
        tentacle.__skipDefaultRespawn = true;
        deadList(area).push({ id: Shared.ids().TENTACLE_WHIRLPOOL, at: tentacle.getSpawnPosition(), previous: tentacle });
      }
      if ((tentacle.getHitpoints?.() ?? 0) > 0) tentacle.setHitpoints(0);
    } catch {
      // Already dying; its death event still joins the respawn.
    }
  }
  const delay = npc.getDefinition?.()?.getRespawn?.() ?? 25;
  if (area?.isKrakenInstance === true) schedulePrivate(area, delay);
  else later(delay, () => respawnAll(area));
}

function releaseArea(area) {
  for (const task of privatePending.get(area) ?? []) task.stop();
  privatePending.delete(area);
  simultaneousPending.delete(area);
  deadByArea.delete(area);
}

function attach(api) {
  api.onNpcDeath(tentacleDied);
  api.onNpcDeath(bossDied);
}

module.exports = { attach, tentacleDied, bossDied, bossUp, respawnAll, releaseArea };
