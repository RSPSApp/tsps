"use strict";

/**
 * Slayer tasks: assigning, counting kills, completing, cancelling.
 *
 * - A master assigns from its slayer_master_task rows (Data.Slayer.js): rows whose task the
 *   player has the Slayer, combat (unless combat checks are off, varbit
 *   combat_level_reqs_disabled; Krystilia never checks) and stat levels for, whose required
 *   unlock is bought, that no bought unlock removes, and that the player hasn't blocked. One is
 *   picked by weight, its amount from min..max, or the extension range with its unlock.
 * - The "Boss" task picks one of the boss tasks the player qualifies for. Konar picks one of the
 *   task's areas (varp slayer_area).
 * - A kill counts when the NPC counts for the task (Data.npcCountsFor); Konar's must be in her
 *   area, Krystilia's in the Wilderness. Slayer XP is the monster's hitpoints.
 * - Completing: Krystilia's tasks add to the Wilderness streak, Mortimer's to neither; the
 *   others to the standard streak. No points for the first four (Wiki), then the master's
 *   points times the 10th/50th/100th/250th/1,000th multiplier. Messages are captured lines.
 */
const Data = require("./Data.Slayer");
const State = require("./State.Slayer");

const COMPLETE = "<col=ef1020>You have completed your task! You killed</col> {amount} {name}<col=ef1020>. You gained</col> {xp} xp<col=ef1020>.";
const FREE_TASK = "<col=ef1020>You've completed </col>{streak} {tasks}<col=ef1020> and will need </col>{more} more<col=ef1020> before you start receiving Slayer points; return to a Slayer master.</col>";
const POINTS = "<col=ef1020>You've completed </col>{streak} tasks <col=ef1020>and received </col>{points} points<col=ef1020>, giving you a total of </col>{total}<col=ef1020>; return to a Slayer master.</col>";
const NO_POINTS_MASTER = "<col=ef1020>You've completed </col>{streak} tasks<col=ef1020>. You'll be eligible to earn reward points if you complete tasks from a more advanced Slayer Master.";

/** Masters whose tasks give no points and say so (Turael/Aya, Spria). */
const NO_POINTS = 0;
const KRYSTILIA = 7;
/** The Slayer XP gained on the current task, for the completion message. */
const TASK_XP_ATTRIBUTE = "slayer:task-xp";
const MORTIMER = 10;

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
  };
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
  return master.id !== KRYSTILIA && State.varbit(player, "combat_level_reqs_disabled") !== 1;
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
  return skills.getCombatLevel() >= master.combat && skills.getMaxLevel(core.Skill.SLAYER) >= master.slayer;
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
  const entry = weightedPick(choices, random);
  let task = entry.task;
  let bossId = 0;
  let amount;
  if (task.id === Data.BOSS_TASK_ID) {
    const bosses = bossChoices(player);
    const [id, boss] = bosses[Math.floor(random() * bosses.length)];
    bossId = id;
    task = boss;
    amount = between(BOSS_AMOUNT.min, BOSS_AMOUNT.max, random);
  } else {
    const extended = task.extension && hasUnlock(player, task.extension.unlockRow);
    amount = extended && !task.extension.additive
      ? between(task.extension.min, task.extension.max, random)
      : between(entry.min, entry.max, random) + (extended ? between(task.extension.min, task.extension.max, random) : 0);
  }
  const area = master.locations ? pickArea(entry, random) : null;
  State.update(player,
    { slayer_master: master.id, slayer_target_bossid: bossId },
    {
      slayer_count: amount,
      slayer_count_original: amount,
      slayer_target: entry.task.id,
      slayer_area: area?.id ?? 0,
    });
  api.emitCustomEvent("slayer:task-assigned", { player, master: master.id, task: task.name, taskId: entry.task.id });
  const name = task.displayName;
  const line = area
    ? `You are to bring balance to ${amount} ${name} ${area.text}.`
    : `Your new task is to kill ${amount} ${name}.`;
  return { line };
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
  State.update(player, { slayer_target_bossid: 0 }, { slayer_count: 0, slayer_target: 0, slayer_count_original: 0, slayer_area: 0 });
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
  if (kill.xp > 0) player.getSkillManager().addExperiences(core.Skill.SLAYER, kill.xp);
  player.setAttribute(TASK_XP_ATTRIBUTE, (Number(player.getAttribute(TASK_XP_ATTRIBUTE)) || 0) + (kill.taskXp ?? kill.xp));
  const remaining = task.count - 1;
  State.setVarp(player, "slayer_count", remaining);
  if (remaining > 0) return;
  complete(player, task);
}

function complete(player, task) {
  const master = Data.get().masters.get(task.masterId);
  const xp = Math.floor(Number(player.getAttribute(TASK_XP_ATTRIBUTE)) || 0);
  player.sendMessage(fill(COMPLETE, { amount: task.original, name: task.task?.displayName ?? "", xp: xp.toLocaleString("en-US") }));
  clear(player);
  if (task.masterId === MORTIMER) return;
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

/** "slayer:grant-points" { player, points }: a quest or reward adding points. */
function grantPointsEvent({ player, points }) {
  if (player && Number.isFinite(points)) grantPoints(player, points);
}

function attach(pluginApi) {
  pluginApi.persistAttribute(TASK_XP_ATTRIBUTE);
  pluginApi.onNpcDeath(npcKilled);
  pluginApi.onCustomEvent("slayer:on-task", onTaskEvent);
  pluginApi.onCustomEvent("slayer:grant-points", grantPointsEvent);
  pluginApi.onCustomEvent("slayer:current-task", currentTaskEvent);
}

module.exports = {
  init,
  attach,
  current,
  assign,
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
