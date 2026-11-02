"use strict";

/**
 * Superior Slayer monsters (data/slayer-superiors.json): with Bigger and Badder unlocked and
 * not toggled off (slayer_toggleoff_superiormobs), an on-task kill ("slayer:task-kill" from
 * Tasks.Slayer.js) spawns the monster's superior where it died, 1 time in 200, attacking the
 * player. A superior gives ten times its hitpoints in Slayer XP, on task or not (on task through
 * the task's kill, so Mortimer's XP modifier counts it), and rolls the superior unique tables
 * (Mortimer's superior unique modifier raises their chance). A slain superior brings another
 * only when content gives it a chance ("slayer:superior-again").
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
/** The NPC id each spawned superior came from, so its bonus rolls use that monster's own table. */
const spawnedFrom = new WeakMap();
const UNIQUE_TABLE_SIZE = 16;
/** The source the unique rolls name on "drops:chance" { player, source, rules }. */
const UNIQUES_SOURCE = "superior-slayer-monster";
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

/**
 * Whether and how often a task kill brings its superior: Bigger and Badder's bit and the data's
 * 1 in 200, which plugins change on "slayer:superior-spawn" { player, npc, unlocked, chance }
 * (a league's tier passive unlocks it and makes them 1 in 50); the toggle-off always holds.
 */
function spawnRule(player, npc) {
  const rule = { player, npc, unlocked: Tasks.hasUnlockBit(player, DATA.unlockBit), chance: DATA.chance };
  api.emitCustomEvent("slayer:superior-spawn", rule);
  if (State.varbit(player, "slayer_toggleoff_superiormobs") === 1) rule.unlocked = false;
  return rule;
}

/** Unique table -> its item names, for the chance rules. */
const tableItemNames = new WeakMap();

function tableItems(table) {
  if (!tableItemNames.has(table)) {
    tableItemNames.set(table, Object.keys(table).filter((name) => name !== "NOTHING")
      .map((name) => core.ItemDefinition.forId(core.ItemIdentifiers[name])?.getName() ?? name));
  }
  return tableItemNames.get(table);
}

/** How many times likelier a unique table is: the product of the rules matching any of its items. */
function tableBoost(table, rules) {
  const names = tableItems(table);
  return rules.reduce((boost, rule) => (names.some((name) => rule.pattern.test(name)) ? boost * rule.multiplier : boost), 1);
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
  if (isSuperior(npc)) return null;
  const rule = spawnRule(player, npc);
  if (!rule.unlocked) return null;
  const id = resolve().get(npcName(npc).toLowerCase());
  if (id == null || Math.floor(random() * rule.chance) !== 0) return null;
  return spawnWhereDied(player, npc, id, npc.getId?.());
}

/** Superior `id` where `npc` died, attacking the player; `fromId` is the monster whose table it rolls. */
function spawnWhereDied(player, npc, id, fromId) {
  const at = npc.getLocation();
  const superior = api.spawnNpc({ id, x: at.getX(), y: at.getY(), z: at.getZ(), owner: player });
  if (!superior) return null;
  if (Number.isInteger(fromId)) spawnedFrom.set(superior, fromId);
  player.sendMessage(DATA.message);
  superior.getCombat?.()?.attack?.(player);
  api.emitCustomEvent("slayer:superior-spawned", { player, npc, superior });
  return superior;
}

/**
 * A slain superior may bring another of itself where it died: never unless content gives it a
 * chance ("slayer:superior-again" { player, npc, chance }, a league relic's 50%).
 */
function superiorAgain(player, npc, random = Math.random) {
  const rule = { player, npc, chance: 0 };
  api.emitCustomEvent("slayer:superior-again", rule);
  if (!(rule.chance > 0) || random() >= rule.chance || !Number.isInteger(npc.getId?.())) return null;
  return spawnWhereDied(player, npc, npc.getId(), spawnedFrom.get(npc) ?? normalIdOf(npc));
}

/** The normal monster a superior is the superior of (its first attackable NPC id), or null. */
function normalIdOf(superior) {
  resolve();
  const name = npcName(superior).toLowerCase();
  const normal = Object.entries(DATA.superiors).find(([, value]) => value.toLowerCase() === name)?.[0];
  return normal ? normalIds.get(normal.toLowerCase()) ?? null : null;
}

/** A superior's Slayer XP off task (on task, the task's kill gave it). */
function npcKilled({ killer, npc }) {
  if (!killer?.isPlayer?.() || !isSuperior(npc)) return;
  // "slayer:superior-killed" { player, npc }: a superior killed, on task or off (a league's "Defeat 25 Superior slayer monsters").
  api.emitCustomEvent("slayer:superior-killed", { player: killer, npc });
  superiorAgain(killer, npc);
  if (onTaskKills.has(npc)) return;
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
 * superior unique modifier), as do the chance `rules` matching a table's items ("drops:chance",
 * a league's boosted drops). Returns the item ids won.
 */
function rollUniques(npc, boost = 1, random = Math.random, rules = []) {
  const won = [];
  for (const table of DATA.uniques) {
    const chance = (boost * tableBoost(table, rules)) / uniqueChance(npc);
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
  // Content may add rolls on the normal monster's table and raise the unique chance
  // ("slayer:superior-rewards", a league relic); it may also add drops of its own.
  // The monster it spawned from (a Turoth's own id, which has the drop table), else the first of its name.
  const rewards = { player, npc, normalId: spawnedFrom.get(npc) ?? normalIdOf(npc), drops, uniqueBoost: 1, extraRolls: 0 };
  api.emitCustomEvent("slayer:superior-rewards", rewards);
  const boost = Tasks.killBoost(player, npc, Data.MODIFIER.SUPERIOR_UNIQUES) * (rewards.uniqueBoost > 0 ? rewards.uniqueBoost : 1);
  const rules = [];
  api.emitCustomEvent("drops:chance", { player, source: UNIQUES_SOURCE, rules });
  for (const itemId of rollUniques(npc, boost, Math.random, rules)) drops.push({ itemId, amount: 1, noted: false });
  if (rewards.normalId != null && Number.isInteger(rewards.extraRolls) && rewards.extraRolls > 0) {
    api.emitCustomEvent("npc-drops:extra-rolls", { player, npc, npcId: rewards.normalId, rolls: rewards.extraRolls, drops });
  }
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

module.exports = { init, attach, taskKill, npcKilled, superiorAgain, rollUniques, uniqueChance, isSuperior, resolve, superiorForTask, spawnForTask, normalIdOf, addUniques };
