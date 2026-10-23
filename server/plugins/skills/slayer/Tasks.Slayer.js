"use strict";

/**
 * Slayer tasks: assigning, counting kills, completing, cancelling.
 *
 * - A master assigns from its slayer_master_task rows (Data.Slayer.js): rows whose task the
 *   player has the Slayer, combat (unless combat checks are off, varbit
 *   combat_level_reqs_disabled; Krystilia never checks) and stat levels for, whose required
 *   unlock is bought, that no bought unlock removes, and that the player hasn't blocked. One is
 *   picked by weight, its amount from min..max, or the extension range with its unlock.
 * - A Slayer cape (or max cape): worn, it bypasses the combat level a master or task needs;
 *   worn or carried, a new task has a 10% chance to be the previous one again (Wiki: Slayer
 *   cape), if the player could still get it.
 * - The "Boss" task picks one of the boss tasks the player qualifies for. Konar picks one of the
 *   task's areas (varp slayer_area).
 * - A kill counts when the NPC counts for the task (Data.npcCountsFor); Konar's must be in her
 *   area, Krystilia's in the Wilderness. Slayer XP is the monster's hitpoints.
 * - Mortimer offers a choice of tasks instead (Choice.Slayer.js); the chosen one comes here
 *   (assignChosen) with its modifier (varbits slayer_modifier_id, _value, _negative): Slayer
 *   points on completion, a longer or shorter task, more clue scrolls, more superior uniques
 *   (Superiors.Slayer.js) or more Slayer XP.
 * - Completing: Krystilia's tasks add to the Wilderness streak, Mortimer's to his own
 *   (slayer_mortimer_tasks_completed) and give only their points modifier; the others add to
 *   the standard streak. No points for the first four (Wiki), then the master's points times
 *   the 10th/50th/100th/250th/1,000th multiplier. Messages are captured lines.
 */
const Data = require("./Data.Slayer");
const State = require("./State.Slayer");

const COMPLETE = "<col=ef1020>You have completed your task! You killed</col> {amount} {name}<col=ef1020>. You gained</col> {xp} xp<col=ef1020>.";
const FREE_TASK = "<col=ef1020>You've completed </col>{streak} {tasks}<col=ef1020> and will need </col>{more} more<col=ef1020> before you start receiving Slayer points; return to a Slayer master.</col>";
const POINTS = "<col=ef1020>You've completed </col>{streak} tasks <col=ef1020>and received </col>{points} points<col=ef1020>, giving you a total of </col>{total}<col=ef1020>; return to a Slayer master.</col>";
const MORTIMER_POINTS = "<col=ef1020>You've completed </col>{streak} Mortimer tasks<col=ef1020> and received </col>{points} points<col=ef1020>, giving you a total of </col>{total}<col=ef1020>; return to a Slayer master.</col>";
/** Ours: no capture shows a Mortimer task without a points modifier. */
const MORTIMER_NO_POINTS = "<col=ef1020>You've completed </col>{streak} Mortimer tasks<col=ef1020>; return to a Slayer master.</col>";
const NO_POINTS_MASTER = "<col=ef1020>You've completed </col>{streak} tasks<col=ef1020>. You'll be eligible to earn reward points if you complete tasks from a more advanced Slayer Master.";

/** Masters whose tasks give no points and say so (Turael/Aya, Spria). */
const NO_POINTS = 0;
const KRYSTILIA = 7;
/** The Slayer XP gained on the current task, for the completion message. */
const TASK_XP_ATTRIBUTE = "slayer:task-xp";
/** The last task assigned (its slayer_task row), which a Slayer cape may offer again. */
const PREVIOUS_TASK_ATTRIBUTE = "slayer:previous-task";
const CAPE_REPEAT_CHANCE = 0.1;
const { MORTIMER, MODIFIER } = Data;
/** The modifier of the task each NPC was killed on, for drop rolls that come after the last kill. */
const killModifiers = new WeakMap();

let api = null;
let core = null;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
}

/** The player's current task, or null. */
function current(player) {
  const count = State.varp(player, "slayer_count");
  if (count <= 0) return null;
  const taskId = State.varp(player, "slayer_target");
  const data = Data.get();
  const bossId = State.varbit(player, "slayer_target_bossid");
  const task = taskId === Data.BOSS_TASK_ID ? data.bosses.get(bossId) ?? data.taskById.get(taskId) : data.taskById.get(taskId);
  return {
    taskId,
    task,
    bossId: taskId === Data.BOSS_TASK_ID ? bossId : 0,
    count,
    original: State.varp(player, "slayer_count_original"),
    masterId: State.varbit(player, "slayer_master"),
    area: areaById(State.varp(player, "slayer_area")),
    modifier: modifier(player),
  };
}

/** The current task's Mortimer modifier ({ id, value, negative }), or null. */
function modifier(player) {
  const id = State.varbit(player, "slayer_modifier_id");
  if (!id) return null;
  return { id, value: State.varbit(player, "slayer_modifier_value"), negative: State.varbit(player, "slayer_modifier_negative") === 1 };
}

/** 1 + the modifier's percentage when the task has this modifier (clue, superior, XP), else 1. */
function modifierBoost(task, id) {
  return task?.modifier?.id === id ? 1 + task.modifier.value / 100 : 1;
}

/**
 * The boost a modifier gives a kill of this NPC (clue scrolls, superior uniques): the task it was
 * killed on, or the player's task if it counts for it.
 */
function killBoost(player, npc, id) {
  const killed = killModifiers.get(npc);
  if (killed) return killed.player === player ? modifierBoost(killed, id) : 1;
  const task = current(player);
  return countsFor(task, npc) ? modifierBoost(task, id) : 1;
}

function areaById(id) {
  if (!id) return null;
  for (const area of Data.get().areas.values()) if (area.id === id) return area;
  return null;
}

/** The task's name as masters say it in "still hunting": lowercase. */
function taskName(task) {
  return task?.name || task?.displayName?.toLowerCase() || "";
}

// --- Requirements

function hasUnlock(player, unlockRow) {
  const unlock = Data.get().unlocks.get(unlockRow);
  return unlock ? hasUnlockBit(player, unlock.bit) : false;
}

/** Unlock bits 0-31, 32-63, 64-95 are slayer_rewards_unlocks, ...1, ...2. */
function hasUnlockBit(player, bit) {
  const varp = ["slayer_rewards_unlocks", "slayer_rewards_unlocks1", "slayer_rewards_unlocks2"][bit >> 5];
  return varp ? ((State.varp(player, varp) >>> (bit & 31)) & 1) === 1 : false;
}

function blockedTaskIds(player, master) {
  const ids = new Set();
  for (const suffix of ["1", "2", "3", "4", "5", "6", "diary"]) {
    const id = core.CacheDefinitions.getVarbitId(`slayer_blocked_${master.blocks}_${suffix}`);
    if (id == null) continue;
    const value = player.getPacketSender().getVarbit(id);
    if (value > 0) ids.add(value);
  }
  return ids;
}

/** Stat requirements use the client's stat ids, which index Skill.values(). */
function meetsStats(player, task) {
  const skills = player.getSkillManager();
  const level = ({ skill }) => skills.getMaxLevel(core.Skill.values()[skill]);
  if (!task.statsAll.every((req) => level(req) >= req.level)) return false;
  return task.statsAny.length === 0 || task.statsAny.some((req) => level(req) >= req.level);
}

function checksCombat(player, master) {
  return master.id !== KRYSTILIA && State.varbit(player, "combat_level_reqs_disabled") !== 1 && !hasSlayerCape(player, false);
}

/** "skillcape:has-perk": a worn Slayer cape (or max cape), or with `inventory` a carried one. */
function hasSlayerCape(player, inventory) {
  const request = { player, skill: "SLAYER", inventory, result: false };
  api.emitCustomEvent("skillcape:has-perk", request);
  return request.result === true;
}

/** Whether the player may get this row from this master. */
function eligible(player, master, entry, blocked) {
  const task = entry.task;
  if (entry.unlockRow != null && !hasUnlock(player, entry.unlockRow)) return false;
  if (task.blockedByUnlockRow != null && hasUnlock(player, task.blockedByUnlockRow)) return false;
  if (blocked.has(task.id)) return false;
  if (task.id === Data.BOSS_TASK_ID) return bossChoices(player).length > 0;
  if (player.getSkillManager().getMaxLevel(core.Skill.SLAYER) < Data.taskLevel(task.id)) return false;
  if (checksCombat(player, master) && player.getSkillManager().getCombatLevel() < task.minCombat) return false;
  return meetsStats(player, task) && meetsQuests(player, task.id);
}

/**
 * The task's quests (Data.taskQuests): any one complete, or only started for the ones the Wiki
 * needs partly done. A quest no plugin answers for (not in tsps yet) doesn't block the task.
 */
function meetsQuests(player, taskId) {
  const needs = Data.taskQuests(taskId);
  if (!needs) return true;
  const event = needs.started ? "quest:is-started" : "quest:is-complete";
  const field = needs.started ? "started" : "complete";
  const answers = needs.any.map((key) => {
    const request = { player, key, [field]: null };
    api.emitCustomEvent(event, request);
    return request[field];
  });
  if (answers.some((answer) => answer === true)) return true;
  return answers.every((answer) => answer == null);
}

/** The boss tasks the player has the levels for (their Slayer levels are stat requirements). */
function bossChoices(player) {
  return [...Data.get().bosses.entries()].filter(([, task]) => meetsStats(player, task));
}

/** Whether a player may get tasks from this master at all (the master's own levels). */
function meetsMaster(player, master) {
  const skills = player.getSkillManager();
  const combat = skills.getCombatLevel() >= master.combat || hasSlayerCape(player, false);
  return combat && skills.getMaxLevel(core.Skill.SLAYER) >= master.slayer;
}

// --- Assigning

function weightedPick(entries, random) {
  const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
  let roll = Math.floor(random() * total);
  for (const entry of entries) {
    roll -= Math.max(0, entry.weight);
    if (roll < 0) return entry;
  }
  return entries[entries.length - 1];
}

const between = (min, max, random) => min + Math.floor(random() * (max - min + 1));

/**
 * Gives the player a task from this master. Returns { line } with the master's line, or
 * { refused: line } when the master has nothing for them. The caller checks the existing task.
 */
function assign(player, master, random = Math.random) {
  const blocked = blockedTaskIds(player, master);
  const choices = master.tasks.filter((entry) => eligible(player, master, entry, blocked));
  if (choices.length === 0) return { refused: `${master.names[0]} was unable to give you a Slayer task. Please try again later.` };
  const previous = choices.find((entry) => entry.task.id === player.getAttribute(PREVIOUS_TASK_ATTRIBUTE));
  const repeat = previous && hasSlayerCape(player, true) && random() < CAPE_REPEAT_CHANCE;
  const entry = repeat ? previous : weightedPick(choices, random);
  const bossId = entry.task.id === Data.BOSS_TASK_ID ? rollBoss(player, random) : 0;
  const area = master.locations ? pickArea(entry, random) : null;
  const { task, amount } = setTask(player, master, entry, bossId, area, null, random);
  const name = task.displayName;
  const line = area
    ? `You are to bring balance to ${amount} ${name} ${area.text}.`
    : `Your new task is to kill ${amount} ${name}.`;
  return { line };
}

/** One of the boss tasks the player qualifies for, by boss id. */
function rollBoss(player, random = Math.random) {
  const bosses = bossChoices(player);
  return bosses.length ? bosses[Math.floor(random() * bosses.length)][0] : 0;
}

/** A task's amount: the boss range, min..max, or the extension range with its unlock. */
function rollAmount(player, entry, bossId, random) {
  if (bossId) return between(BOSS_AMOUNT.min, BOSS_AMOUNT.max, random);
  const extension = entry.task.extension;
  const extended = extension && hasUnlock(player, extension.unlockRow);
  if (extended && !extension.additive) return between(extension.min, extension.max, random);
  return between(entry.min, entry.max, random) + (extended ? between(extension.min, extension.max, random) : 0);
}

/**
 * Sets the task. A Mortimer modifier is set first; a quantity modifier then changes the count
 * the base roll set (live sends the base count, then the changed one; the original count stays
 * the base roll).
 */
function setTask(player, master, entry, bossId, area, chosenModifier, random) {
  player.setAttribute(PREVIOUS_TASK_ATTRIBUTE, entry.task.id);
  const task = bossId ? Data.get().bosses.get(bossId) ?? entry.task : entry.task;
  const base = rollAmount(player, entry, bossId, random);
  if (chosenModifier) {
    State.update(player, {
      slayer_modifier_id: chosenModifier.id,
      slayer_modifier_value: chosenModifier.value,
      slayer_modifier_negative: chosenModifier.negative ? 1 : 0,
    });
  }
  State.update(player,
    { slayer_master: master.id, slayer_target_bossid: bossId },
    { slayer_count_original: base, slayer_count: base, slayer_target: entry.task.id, slayer_area: area?.id ?? 0 });
  let amount = base;
  if (chosenModifier?.id === MODIFIER.QUANTITY) {
    amount = Math.max(1, base + (chosenModifier.negative ? -chosenModifier.value : chosenModifier.value));
    State.setVarp(player, "slayer_count", amount);
  }
  api.emitCustomEvent("slayer:task-assigned", { player, master: master.id, task: task.name, taskId: entry.task.id });
  return { task, amount };
}

/** Mortimer's chosen task (Choice.Slayer.js): the row, its boss and its modifier. */
function assignChosen(player, master, entry, bossId, chosenModifier, random = Math.random) {
  return setTask(player, master, entry, bossId, null, chosenModifier, random);
}

/** Wiki, Boss task: 3-35 kills (the player's choice in OSRS; here rolled in that range). */
const BOSS_AMOUNT = { min: 3, max: 35 };

function pickArea(entry, random) {
  const areas = entry.areaRows.map((row) => Data.get().areas.get(row)).filter(Boolean);
  return areas.length ? areas[Math.floor(random() * areas.length)] : null;
}

/** The line a master says about the current task. */
function stillHunting(player, task) {
  if (task.area) {
    return `You're currently assigned to bring balance to ${taskName(task.task)} ${task.area.text}; you have ${task.count} more to go. Your reward point tally is ${State.varbit(player, "slayer_points")}.`;
  }
  return `You're still hunting ${taskName(task.task)}; you have ${task.count} to go. Come back when you've finished your task.`;
}

/** Ends the current task without a reward (cancelling, Turael's replacement). */
function clear(player) {
  player.setAttribute(TASK_XP_ATTRIBUTE, null);
  State.update(player,
    { slayer_target_bossid: 0, slayer_modifier_id: 0, slayer_modifier_value: 0, slayer_modifier_negative: 0 },
    { slayer_count: 0, slayer_target: 0, slayer_count_original: 0, slayer_area: 0 });
}

// --- Kills

function npcName(npc) {
  return (npc.getCurrentDefinition?.() ?? npc.getDefinition?.())?.getName?.() ?? "";
}

/** Whether a kill of this NPC (where it died) counts for the player's task. */
function countsFor(task, npc) {
  if (!task) return false;
  const name = npcName(npc);
  const matches = task.taskId === Data.BOSS_TASK_ID
    ? Data.isBossNpc(task.bossId, name)
    : Data.npcCountsFor(task.taskId, npc.getId(), name);
  if (!matches) return false;
  if (task.masterId === KRYSTILIA && !core.Wilderness.isInLocation(npc.getLocation())) return false;
  if (task.area && !Data.inArea(task.area, npc.getLocation())) return false;
  return true;
}

/** "slayer:on-task": is this NPC the player's current assignment? */
function onTaskEvent(request) {
  request.onTask = countsFor(current(request.player), request.npc);
}

function npcKilled({ killer, npc }) {
  if (!killer?.isPlayer?.() || !npc) return;
  const player = killer;
  const task = current(player);
  if (!countsFor(task, npc)) return;
  const hitpoints = (npc.getCurrentDefinition?.() ?? npc.getDefinition()).getHitpoints();
  // Superiors.Slayer.js may spawn a superior, or zero this for a superior's own XP.
  const kill = { player, npc, xp: hitpoints };
  api.emitCustomEvent("slayer:task-kill", kill);
  // Mortimer's Slayer XP modifier counts superiors too (Wiki).
  const boost = modifierBoost(task, MODIFIER.XP);
  const xp = kill.xp * boost;
  if (xp > 0) player.getSkillManager().addExperiences(core.Skill.SLAYER, xp);
  player.setAttribute(TASK_XP_ATTRIBUTE, (Number(player.getAttribute(TASK_XP_ATTRIBUTE)) || 0) + (kill.taskXp ?? kill.xp) * boost);
  if (task.modifier) killModifiers.set(npc, { player, modifier: task.modifier });
  const remaining = task.count - 1;
  State.setVarp(player, "slayer_count", remaining);
  if (remaining > 0) return;
  complete(player, task);
}

function complete(player, task) {
  const master = Data.get().masters.get(task.masterId);
  const xp = Math.floor(Number(player.getAttribute(TASK_XP_ATTRIBUTE)) || 0);
  player.sendMessage(fill(COMPLETE, { amount: killedAmount(task), name: task.task?.displayName ?? "", xp: xp.toLocaleString("en-US") }));
  clear(player);
  if (task.masterId === MORTIMER) {
    completeMortimer(player, task.modifier);
    return;
  }
  const streakVarbit = task.masterId === KRYSTILIA ? "slayer_wilderness_tasks_completed" : "slayer_tasks_completed";
  const streak = State.varbit(player, streakVarbit) + 1;
  State.setVarbit(player, streakVarbit, streak);
  const { freeTasks } = Data.config;
  const base = master?.points ?? 0;
  if (base === NO_POINTS) {
    player.sendMessage(fill(NO_POINTS_MASTER, { streak }));
    return;
  }
  const totalTasks = State.varbit(player, "slayer_tasks_completed") + State.varbit(player, "slayer_wilderness_tasks_completed");
  if (totalTasks <= freeTasks) {
    player.sendMessage(fill(FREE_TASK, { streak, tasks: streak === 1 ? "task" : "tasks", more: freeTasks + 1 - totalTasks }));
    return;
  }
  const points = base * multiplier(streak);
  grantPoints(player, points);
  player.sendMessage(fill(POINTS, { streak, points, total: State.varbit(player, "slayer_points") }));
}

/** The task's amount: the original roll, changed by a quantity modifier. */
function killedAmount(task) {
  const quantity = task.modifier?.id === MODIFIER.QUANTITY ? task.modifier : null;
  if (!quantity) return task.original;
  return Math.max(1, task.original + (quantity.negative ? -quantity.value : quantity.value));
}

/** Mortimer's own streak; his tasks give only their points modifier (Wiki), no multiplier. */
function completeMortimer(player, taskModifier) {
  const streak = State.varp(player, "slayer_mortimer_tasks_completed") + 1;
  State.setVarp(player, "slayer_mortimer_tasks_completed", streak);
  if (taskModifier?.id !== MODIFIER.POINTS) {
    player.sendMessage(fill(MORTIMER_NO_POINTS, { streak }));
    return;
  }
  grantPoints(player, taskModifier.value);
  player.sendMessage(fill(MORTIMER_POINTS, { streak, points: taskModifier.value, total: State.varbit(player, "slayer_points") }));
}

function multiplier(streak) {
  for (const [every, times] of Data.config.streakMultipliers) {
    if (streak % every === 0) return times;
  }
  return 1;
}

/** Adds points, capped at what slayer_points can hold. */
function grantPoints(player, points) {
  const total = Math.min(POINTS_CAP, State.varbit(player, "slayer_points") + Math.max(0, Math.floor(points)));
  State.setVarbit(player, "slayer_points", total);
}

/** slayer_points is 17 bits wide. */
const POINTS_CAP = (1 << 17) - 1;

/**
 * "slayer:current-task" { player, task: null }: fills task with { master, taskId, name, count,
 * area } (name lowercase, as "kalphites"; area the slayer_area row's text) or leaves it null.
 */
function currentTaskEvent(request) {
  const task = request?.player ? current(request.player) : null;
  if (!task) return;
  request.task = { master: task.masterId, taskId: task.taskId, name: taskName(task.task), count: task.count, area: task.area?.text ?? null };
}

/**
 * "slayer:has-unlock" { player, name, unlocked: false }: sets `unlocked` when the player bought the
 * Rewards unlock with that slayer_unlock name ("Broader Fletching").
 */
function hasUnlockEvent(request) {
  if (!request?.player || !request.name) return;
  for (const unlock of Data.get().unlocks.values()) {
    if (unlock.name === request.name) {
      request.unlocked = hasUnlockBit(request.player, unlock.bit);
      return;
    }
  }
}

const CLUE_SCROLL = /^clue scroll/i;

/** "npc-drops:tertiary-chance": Mortimer's clue modifier makes clue scrolls more likely on task. */
function clueChance(request) {
  if (!request?.player || !request.npc || !Array.isArray(request.rules)) return;
  const boost = killBoost(request.player, request.npc, MODIFIER.CLUES);
  if (boost > 1) request.rules.push({ pattern: CLUE_SCROLL, multiplier: boost });
}

/** "slayer:grant-points" { player, points }: a quest or reward adding points. */
function grantPointsEvent({ player, points }) {
  if (player && Number.isFinite(points)) grantPoints(player, points);
}

function attach(pluginApi) {
  pluginApi.persistAttribute(TASK_XP_ATTRIBUTE);
  pluginApi.persistAttribute(PREVIOUS_TASK_ATTRIBUTE, 0);
  pluginApi.onNpcDeath(npcKilled);
  pluginApi.onCustomEvent("slayer:on-task", onTaskEvent);
  pluginApi.onCustomEvent("slayer:grant-points", grantPointsEvent);
  pluginApi.onCustomEvent("slayer:current-task", currentTaskEvent);
  pluginApi.onCustomEvent("slayer:has-unlock", hasUnlockEvent);
  pluginApi.onCustomEvent("npc-drops:tertiary-chance", clueChance);
}

module.exports = {
  init,
  attach,
  current,
  modifier,
  modifierBoost,
  killBoost,
  assign,
  assignChosen,
  eligible,
  blockedTaskIds,
  weightedPick,
  rollBoss,
  stillHunting,
  clear,
  meetsMaster,
  countsFor,
  meetsQuests,
  hasUnlockBit,
  hasUnlock,
  grantPoints,
  multiplier,
  complete,
  npcKilled,
  taskName,
};
