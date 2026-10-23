"use strict";

/**
 * Developer commands:
 * - ::completetask finishes the current task as if its last kill had landed (points, streak and
 *   messages included).
 * - ::slayerpoints <amount> sets the Slayer points.
 * - ::clearunlocks locks every Rewards unlock and extension again, and resets their toggles.
 * - ::superior spawns the current task's superior beside the player, unlock or not.
 * - ::slayertask <amount> <task> sets a task outright ("::slayertask 20 abyssal demons"), from
 *   Duradel unless the player's last master is known.
 * - ::mortimertasks <amount> sets how many Mortimer tasks the player has done (his modifiers
 *   unlock at 15, 25 and 40, a third choice at 50) and drops a waiting choice, so the next one
 *   is rolled with the new count.
 */
const Data = require("./Data.Slayer");
const State = require("./State.Slayer");
const Tasks = require("./Tasks.Slayer");
const Superiors = require("./Superiors.Slayer");
const Choice = require("./Choice.Slayer");

/** slayer_points is 17 bits wide. */
const POINTS_CAP = (1 << 17) - 1;
const UNLOCK_VARPS = ["slayer_rewards_unlocks", "slayer_rewards_unlocks1", "slayer_rewards_unlocks2"];
const TOGGLE_VARBITS = ["slayer_toggleoff_superiormobs", "slayer_toggleoff_fossilwyvernblock", "slayer_toggleoff_longerrevenants"];

function completeTask({ player }) {
  const task = Tasks.current(player);
  if (!task) {
    player.sendMessage("You don't have a Slayer task.");
    return;
  }
  State.setVarp(player, "slayer_count", 0);
  Tasks.complete(player, task);
}

function setPoints({ player, parts }) {
  const amount = Number(parts?.[1]);
  if (!Number.isInteger(amount) || amount < 0) {
    player.sendMessage(`Usage: ::slayerpoints <0-${POINTS_CAP}>`);
    return;
  }
  State.setVarbit(player, "slayer_points", Math.min(POINTS_CAP, amount));
  player.sendMessage(`Your Slayer points are now ${State.varbit(player, "slayer_points")}.`);
}

function clearUnlocks({ player }) {
  State.update(player,
    Object.fromEntries(TOGGLE_VARBITS.map((name) => [name, 0])),
    Object.fromEntries(UNLOCK_VARPS.map((name) => [name, 0])));
  player.sendMessage("Your Slayer unlocks have been cleared.");
}

function spawnSuperior({ player }) {
  const task = Tasks.current(player);
  if (!task) {
    player.sendMessage("You don't have a Slayer task.");
    return;
  }
  if (!Superiors.spawnForTask(player, task)) player.sendMessage("Your task has no superior monster.");
}

function setTask({ player, parts }) {
  const amount = Number(parts?.[1]);
  const name = (parts ?? []).slice(2).join(" ").trim().toLowerCase();
  const task = [...Data.get().taskById.values()].find((entry) => entry.name?.toLowerCase() === name || entry.displayName?.toLowerCase() === name);
  if (!Number.isInteger(amount) || amount <= 0 || !task) {
    player.sendMessage("Usage: ::slayertask <amount> <task name>, as ::slayertask 20 abyssal demons");
    return;
  }
  const master = State.varbit(player, "slayer_master") || Data.masterForNpcName("Duradel")?.id || 0;
  State.update(player,
    { slayer_master: master, slayer_target_bossid: 0 },
    { slayer_count: amount, slayer_count_original: amount, slayer_target: task.id, slayer_area: 0 });
  player.sendMessage(`Your task is now ${amount} ${task.displayName || task.name}.`);
}

function setMortimerTasks({ player, parts }) {
  const amount = Number(parts?.[1]);
  if (!Number.isInteger(amount) || amount < 0) {
    player.sendMessage("Usage: ::mortimertasks <amount>");
    return;
  }
  State.setVarp(player, "slayer_mortimer_tasks_completed", amount);
  if (Choice.pending(player)) Choice.clearRoll(player);
  player.sendMessage(`You have now completed ${amount} Mortimer tasks.`);
}

function attach(api) {
  const { DEVELOPER } = api.core.PlayerRights;
  api.registerCommand("completetask", completeTask, DEVELOPER, "Complete the current Slayer task");
  api.registerCommand("slayerpoints", setPoints, DEVELOPER, "Set Slayer points: ::slayerpoints <amount>");
  api.registerCommand("clearunlocks", clearUnlocks, DEVELOPER, "Clear every Slayer Rewards unlock");
  api.registerCommand("superior", spawnSuperior, DEVELOPER, "Spawn the current Slayer task's superior");
  api.registerCommand("slayertask", setTask, DEVELOPER, "Set a Slayer task: ::slayertask <amount> <task name>");
  api.registerCommand("mortimertasks", setMortimerTasks, DEVELOPER, "Set Mortimer tasks completed: ::mortimertasks <amount>");
}

module.exports = { attach, completeTask, setPoints, clearUnlocks, spawnSuperior, setMortimerTasks };
