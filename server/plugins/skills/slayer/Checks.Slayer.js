"use strict";

/**
 * Checking the task: the enchanted gem's Check (and Activate, which talks to the master in OSRS
 * and here gives the same answer), the slayer ring's Check option and its Rub > Check
 * ("slayer:check" from Jewellery.plugin.js). Lines: Wiki, Enchanted gem; the streak line is
 * captured.
 */
const State = require("./State.Slayer");
const Tasks = require("./Tasks.Slayer");

const STREAK = "<col=ef1020>You've completed </col>{streak} tasks <col=ef1020>in a row and currently have a total of </col>{points} points<col=ef1020>.";
const NO_TASK = "You need something new to hunt.";

const SLAYER_RINGS = [
  "Slayer ring (1)", "Slayer ring (2)", "Slayer ring (3)", "Slayer ring (4)",
  "Slayer ring (5)", "Slayer ring (6)", "Slayer ring (7)", "Slayer ring (8)", "Slayer ring (eternal)",
];

/** The task line: "You're assigned to kill bloodveld; only 44 more to go." */
function taskLine(player) {
  const task = Tasks.current(player);
  if (!task) return NO_TASK;
  const where = task.area ? ` ${task.area.text}` : "";
  return `You're assigned to kill ${Tasks.taskName(task.task)}${where}; only ${task.count} more to go.`;
}

function check(player) {
  player.sendMessage(taskLine(player));
  const streak = State.varbit(player, "slayer_tasks_completed");
  const points = State.varbit(player, "slayer_points");
  player.sendMessage(STREAK.replace("{streak}", String(streak)).replace("{points}", String(points)));
}

function gemCheck({ player }) {
  check(player);
}

function checkEvent(request) {
  if (!request?.player) return;
  check(request.player);
  request.handled = true;
}

function attach(api) {
  api.onItemAction("Enchanted gem", { Check: gemCheck, Activate: gemCheck });
  for (const ring of SLAYER_RINGS) api.onItemAction(ring, { Check: gemCheck });
  api.onCustomEvent("slayer:check", checkEvent);
}

module.exports = { attach, taskLine, check };
