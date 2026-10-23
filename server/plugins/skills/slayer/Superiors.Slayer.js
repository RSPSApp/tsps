"use strict";

/**
 * Superior Slayer monsters (data/slayer-superiors.json): with Bigger and Badder unlocked and
 * not toggled off (slayer_toggleoff_superiormobs), an on-task kill ("slayer:task-kill" from
 * Tasks.Slayer.js) spawns the monster's superior where it died, 1 time in 200, attacking the
 * player. A superior gives ten times its hitpoints in Slayer XP, on task or not (on task through
 * the task's kill, so Mortimer's XP modifier counts it), and rolls the superior unique tables
 * (Mortimer's superior unique modifier raises their chance).
 */
const DATA = require("../data/slayer-superiors.json");
const Data = require("./Data.Slayer");
const State = require("./State.Slayer");
const Tasks = require("./Tasks.Slayer");

let api = null;
let core = null;
/** Normal monster name (lowercase) -> superior NPC id. */
let superiorIds = null;
/** Normal monster name (lowercase) -> its first attackable cache NPC id. */
let normalIds = null;
/** Superiors whose XP the task's kill gave (Tasks.Slayer.js runs before npcKilled). */
const onTaskKills = new WeakSet();
const UNIQUE_TABLE_SIZE = 16;
const superiorNames = new Set(Object.values(DATA.superiors).map((name) => name.toLowerCase()));

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

function npcName(npc) {
  return String((npc?.getCurrentDefinition?.() ?? npc?.getDefinition?.())?.getName?.() ?? "");
}

/** The first attackable cache NPC with each superior's name. */
function resolve() {
  if (superiorIds) return superiorIds;
  const byName = new Map();
  const normals = new Set(Object.keys(DATA.superiors).map((name) => name.toLowerCase()));
  normalIds = new Map();
  const count = core.CacheDefinitions.getCounts().npcs;
  for (let id = 0; id < count; id++) {
    const type = core.CacheDefinitions.getNpc(id);
    const name = type?.name?.toLowerCase();
    if (!name || !(type.actions ?? []).includes("Attack")) continue;
    if (superiorNames.has(name) && !byName.has(name)) byName.set(name, id);
    if (normals.has(name) && !normalIds.has(name)) normalIds.set(name, id);
  }
  superiorIds = new Map();
  for (const [normal, superior] of Object.entries(DATA.superiors)) {
    const id = byName.get(superior.toLowerCase());
    if (id != null) superiorIds.set(normal.toLowerCase(), id);
  }
  return superiorIds;
}

/** The superior NPC id of one of the task's monsters, or null. */
function superiorForTask(task) {
  resolve();
  for (const [normal, superiorId] of superiorIds) {
    const normalId = normalIds.get(normal);
    if (normalId == null) continue;
    const name = core.CacheDefinitions.getNpc(normalId).name;
    const counts = task.taskId === Data.BOSS_TASK_ID ? false : Data.npcCountsFor(task.taskId, normalId, name);
    if (counts) return superiorId;
  }
  return null;
}

/** Spawns a task's superior beside the player (::superior). */
function spawnForTask(player, task) {
  const id = superiorForTask(task);
  if (id == null) return null;
  const at = player.getLocation();
  const superior = api.spawnNpc({ id, x: at.getX() + 1, y: at.getY(), z: at.getZ(), owner: player });
  if (!superior) return null;
  player.sendMessage(DATA.message);
  superior.getCombat?.()?.attack?.(player);
  return superior;
}

function isSuperior(npc) {
  return superiorNames.has(npcName(npc).toLowerCase());
}

function enabled(player) {
  return Tasks.hasUnlockBit(player, DATA.unlockBit) && State.varbit(player, "slayer_toggleoff_superiormobs") !== 1;
}

/**
 * "slayer:task-kill" { player, npc, xp }: a superior's own XP (npcKilled) replaces the task's
 * (taskXp is what the completion message counts); a normal monster may bring its superior.
 */
function taskKillEvent(event) {
  if (isSuperior(event.npc)) {
    event.xp *= DATA.xpPerHitpoint;
    onTaskKills.add(event.npc);
    return;
  }
  taskKill(event);
}

function taskKill({ player, npc }, random = Math.random) {
  if (isSuperior(npc) || !enabled(player)) return null;
  const id = resolve().get(npcName(npc).toLowerCase());
  if (id == null || Math.floor(random() * DATA.chance) !== 0) return null;
  const at = npc.getLocation();
  const superior = api.spawnNpc({ id, x: at.getX(), y: at.getY(), z: at.getZ(), owner: player });
  if (!superior) return null;
  player.sendMessage(DATA.message);
  superior.getCombat?.()?.attack?.(player);
  return superior;
}

/** A superior's Slayer XP off task (on task, the task's kill gave it). */
function npcKilled({ killer, npc }) {
  if (!killer?.isPlayer?.() || !isSuperior(npc) || onTaskKills.has(npc)) return;
  const hitpoints = (npc.getCurrentDefinition?.() ?? npc.getDefinition()).getHitpoints();
  killer.getSkillManager().addExperiences(core.Skill.SLAYER, hitpoints * DATA.xpPerHitpoint);
}

/** 1 in this many per unique table (Wiki): lower for superiors that need more Slayer. */
function uniqueChance(npc) {
  const level = Math.max(1, (npc.getCurrentDefinition?.() ?? npc.getDefinition?.())?.getSlayerLevel?.() ?? 1);
  return 200 - (level + 55) ** 2 / 125;
}

/**
 * The superior unique tables, each rolled once; `boost` multiplies their chance (Mortimer's
 * superior unique modifier). Returns the item ids won.
 */
function rollUniques(npc, boost = 1, random = Math.random) {
  const won = [];
  const chance = boost / uniqueChance(npc);
  for (const table of DATA.uniques) {
    if (random() >= chance) continue;
    let roll = Math.floor(random() * UNIQUE_TABLE_SIZE);
    for (const [name, weight] of Object.entries(table)) {
      roll -= weight;
      if (roll >= 0) continue;
      if (name !== "NOTHING") won.push(core.ItemIdentifiers[name]);
      break;
    }
  }
  return won;
}

/** "npc-drops:add": a superior's uniques join its drops. */
function addUniques({ player, npc, drops }) {
  if (!player || !npc || !Array.isArray(drops) || !isSuperior(npc)) return;
  const boost = Tasks.killBoost(player, npc, Data.MODIFIER.SUPERIOR_UNIQUES);
  for (const itemId of rollUniques(npc, boost)) drops.push({ itemId, amount: 1, noted: false });
}

/** "slayer:is-superior" { npc, superior }: whether an NPC is a superior Slayer monster. */
function answerIsSuperior(request) {
  if (request?.npc && isSuperior(request.npc)) request.superior = true;
}

function attach(pluginApi) {
  pluginApi.onCustomEvent("slayer:task-kill", taskKillEvent);
  pluginApi.onCustomEvent("slayer:is-superior", answerIsSuperior);
  pluginApi.onCustomEvent("npc-drops:add", addUniques);
  pluginApi.onNpcDeath(npcKilled);
}

module.exports = { init, attach, taskKill, npcKilled, rollUniques, uniqueChance, isSuperior, resolve, superiorForTask, spawnForTask };
