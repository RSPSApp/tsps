"use strict";

/**
 * Checking the task: the enchanted gem's Check (and Activate, which talks to the master in OSRS
 * and here gives the same answer), the slayer ring's Check option and its Rub > Check
 * ("slayer:check" from Jewellery.plugin.js). Lines: Wiki, Enchanted gem; the streak line is
 * captured.
 */
const Data = require("./Data.Slayer");
const State = require("./State.Slayer");
const Tasks = require("./Tasks.Slayer");

const STREAK = "<col=ef1020>You've completed </col>{streak} tasks <col=ef1020>in a row and currently have a total of </col>{points} points<col=ef1020>.";
const NO_TASK = "You need something new to hunt.";

const SLAYER_RINGS = [
  "Slayer ring (1)", "Slayer ring (2)", "Slayer ring (3)", "Slayer ring (4)",
  "Slayer ring (5)", "Slayer ring (6)", "Slayer ring (7)", "Slayer ring (8)", "Slayer ring (eternal)",
];

/** The task line, red but for the task and the count: "You're assigned to kill bloodveld; only 44 more to go." */
function taskLine(player) {
  const task = Tasks.current(player);
  if (!task) return NO_TASK;
  const where = task.area ? ` ${task.area.text}` : "";
  return `<col=ef1020>You're assigned to kill </col>${Tasks.taskName(task.task)}${where}<col=ef1020>; only </col>${task.count}<col=ef1020> more to go.`;
}

function check(player) {
  player.sendMessage(taskLine(player));
  const streak = State.varbit(player, "slayer_tasks_completed");
  const points = State.varbit(player, "slayer_points");
  player.sendMessage(STREAK.replace("{streak}", String(streak)).replace("{points}", String(points)));
  remote(player);
}

/**
 * "slayer:remote-task" { player, allowed }: content may let the gem, ring or helmet take a new
 * task from the last master or cancel the current one from anywhere (a league relic). The
 * cancel costs what the master's would (Rewards' "slayer:cancel-task").
 */
function remote(player) {
  const request = { player, allowed: false };
  api.emitCustomEvent("slayer:remote-task", request);
  if (request.allowed !== true) return;
  const master = Data.get().masters.get(State.varbit(player, "slayer_master"));
  const task = Tasks.current(player);
  // Mortimer's tasks are a choice with modifiers, made in person.
  if (!task && (!master || master.id === Data.MORTIMER)) return;
  const { DialogueChainBuilder, OptionDialogue } = api.core;
  const first = task ? "Cancel my task." : `Get a new task from ${master.names[0]}.`;
  const menu = new OptionDialogue(0, {
    executeOption: (option) => {
      player.getPacketSender().sendInterfaceRemoval();
      if (Number(option) !== 1) return;
      if (task) {
        api.emitCustomEvent("slayer:cancel-task", { player });
        return;
      }
      const assignment = { player, npcName: master.names[0], master: master.names[0], line: null };
      api.emitCustomEvent("slayer:assignment", assignment);
      if (assignment.line) player.sendMessage(assignment.line.replace(/<br>/g, " "));
    },
  }, first, "Nothing.");
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(menu));
}

function gemCheck({ player }) {
  check(player);
}

function checkEvent(request) {
  if (!request?.player) return;
  check(request.player);
  request.handled = true;
}

let api = null;

function attach(pluginApi) {
  api = pluginApi;
  api.onItemAction("Enchanted gem", { Check: gemCheck, Activate: gemCheck });
  for (const ring of SLAYER_RINGS) api.onItemAction(ring, { Check: gemCheck });
  api.onCustomEvent("slayer:check", checkEvent);
}

module.exports = { attach, taskLine, check };
