"use strict";

/**
 * NPCs that fight each other: Shayzien soldiers and lizardmen in Lizardman Canyon and at the
 * Battlefront, the God Wars Dungeon's four armies. Rivalries are data/definitions/npc-rivalries.json
 * plus whatever other plugins add with "npc-rivalries:add" { name, sides: [[npc ids], ...] };
 * every side is hostile to every other side.
 *
 * An idle rival hunts the way an aggressive NPC hunts a player (NpcAggression): the nearest NPC
 * of an enemy side within its hunt range - its definition's, or as far as it can attack - that
 * the combat rules let it attack. The fight itself is ordinary combat, so hits are real and
 * either side can die; an NPC killed only by NPCs has no player killer and drops nothing.
 *
 * Rivals sit in a few places, so this follows players by map square and each tick looks only at
 * the rival NPCs those players can see - nobody fights where nobody is watching.
 */
const fs = require("fs");
const path = require("path");

let core = null;
/** Npc id -> the ids of every NPC hostile to it. */
const enemies = new Map();
/** "x,y,z" of each map square a rival spawns in, or borders one (it is in view from there). */
const rivalSquares = new Set();
/** Players standing in a rival square. */
const watched = new Set();
/** Spawns by npc id, read once, for placing rivalries added after startup. */
let spawnsById = null;
/** Rivalries other plugins added before this one started. */
const pending = [];

const squareKey = (x, y, z) => `${x >> 6},${y >> 6},${z}`;

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(core.GameConstants.DEFINITIONS_DIRECTORY, file), "utf8"));
}

function spawnsFor(id) {
  if (!spawnsById) {
    spawnsById = new Map();
    for (const spawn of readJson("npc-spawns.json")) {
      const list = spawnsById.get(spawn.id) ?? [];
      list.push(spawn);
      spawnsById.set(spawn.id, list);
    }
  }
  return spawnsById.get(id) ?? [];
}

/** { name, sides: [[ids] | { npcs: [ids] }] }: each side's NPCs become enemies of every other side's. */
function addRivalry(rivalry) {
  if (!core) {
    pending.push(rivalry);
    return;
  }
  const sides = (rivalry?.sides ?? []).map((side) => (Array.isArray(side) ? side : side?.npcs ?? []));
  for (const [index, side] of sides.entries()) {
    const others = sides.filter((_, other) => other !== index).flat();
    for (const id of side) {
      const hostile = enemies.get(id) ?? new Set();
      for (const enemy of others) hostile.add(enemy);
      enemies.set(id, hostile);
      for (const spawn of spawnsFor(id)) markSquare(spawn.x, spawn.y, spawn.level ?? spawn.z ?? 0);
    }
  }
}

function markSquare(x, y, z) {
  for (let dx = -64; dx <= 64; dx += 64) {
    for (let dy = -64; dy <= 64; dy += 64) rivalSquares.add(squareKey(x + dx, y + dy, z));
  }
}

function start(pluginApi) {
  core = pluginApi.core;
  for (const rivalry of [...readJson("npc-rivalries.json").rivalries, ...pending.splice(0)]) addRivalry(rivalry);
  core.TaskManager.submit(new (class RivalriesTask extends core.Task {
    constructor() {
      super(1, null, false);
    }
    execute() {
      tick();
    }
  })());
}

function track({ player }) {
  const at = player.getLocation();
  if (rivalSquares.has(squareKey(at.getX(), at.getY(), at.getZ()))) watched.add(player);
  else watched.delete(player);
}

function forget({ player }) {
  watched.delete(player);
}

function tick() {
  if (watched.size === 0) return;
  const seen = new Set();
  for (const player of watched) {
    for (const npc of player.getLocalNpcs?.() ?? []) {
      if (!npc || seen.has(npc)) continue;
      seen.add(npc);
      const hostile = enemies.get(npc.getId());
      if (hostile) hunt(npc, hostile);
    }
  }
}

/** An idle rival picks a fight with the nearest enemy it may attack. */
function hunt(npc, hostile) {
  const { CombatFactory, CanAttackResponse, World } = core;
  if (!npc.isRegistered() || npc.getHitpoints() <= 0 || npc.isDyingFunction?.()) return;
  if (npc.getCombat().getTarget() != null || CombatFactory.inCombat(npc)) return;
  const definition = npc.getCurrentDefinition();
  if (!definition) return;
  const method = CombatFactory.getMethod(npc);
  const range = Math.max(definition.getHuntRange(), method.attackDistance(npc));
  const at = npc.getLocation();
  let best = null;
  let bestDistance = Infinity;
  for (const rival of World.getNpcsNear(at, range, npc.getPrivateArea())) {
    if (rival === npc || !hostile.has(rival.getId()) || rival.getHitpoints() <= 0) continue;
    const distance = at.getDistance(rival.getLocation());
    if (distance >= bestDistance) continue;
    if (CombatFactory.canAttack(npc, method, rival) !== CanAttackResponse.CAN_ATTACK) continue;
    best = rival;
    bestDistance = distance;
  }
  if (best) npc.getCombat().attack(best);
}

module.exports = {
  name: "NpcRivalries",
  members: true,
  register(pluginApi) {
    pluginApi.onServerStartup(() => start(pluginApi));
    pluginApi.onCustomEvent("npc-rivalries:add", addRivalry);
    pluginApi.onPlayerLogin(track);
    pluginApi.onPlayerMapSquareChange(track);
    pluginApi.onPlayerLogout(forget);
    pluginApi.onPlayerDisconnect(forget);
  },
  _test: { start, addRivalry, track, tick, hunt, enemies, rivalSquares, watched },
};
