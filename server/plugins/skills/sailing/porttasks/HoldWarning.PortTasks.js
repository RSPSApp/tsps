"use strict";

// All Settings "Port task cargo in hold warning" (467, varbit 18144; warns while it is 0):
// disembarking at a port while the boat's cargo hold still has a crate to deliver there asks
// first. Disembark anyway, never ask again (sets 18144), don't ask again until logout (varbit
// 19120), or remain on the boat.
const common = require("./Common.PortTasks");
const cargo = require("../Cargo.Sailing");

const SETTING = 467;
const DONT_ASK_VARBIT = 18144;
const SESSION_VARBIT = 19120;
/** Not saved: "don't ask again this session" lasts until logout. */
const SESSION_ATTRIBUTE = "port-tasks:hold-warning-off";

const TITLE = "Some cargo for this port is still in the cargo hold.";
const OPTIONS = ["Disembark anyway.", "Disembark anyway, and don't ask again.", "Disembark anyway, and don't ask again this session.", "Remain on the boat."];

/** True when one of the player's courier tasks has a crate in this boat's hold still owed at `dockId`. */
function cargoForPort(player, boat, dockId) {
  if (!boat?.cargo) return false;
  return common.slots(player).some((slot) => {
    const task = slot && common.taskById(slot.id);
    return task?.type === "courier" && task.destination === dockId && slot.taken > slot.delivered
      && cargo.countIn(boat, task.crate) > 0;
  });
}

function asks(player, boat, dockId) {
  return cargoForPort(player, boat, dockId)
    && player.getAttribute(SESSION_ATTRIBUTE) !== true
    && (Number(player.getPacketSender().getVarbit(DONT_ASK_VARBIT)) || 0) === 0;
}

/**
 * Asks before disembarking from `boat` at `dockId` when the warning applies; `proceed` runs on
 * any of the disembark answers. Returns false (and does nothing) when there is nothing to ask.
 */
function warn(player, boat, dockId, proceed) {
  if (!asks(player, boat, dockId)) return false;
  const { DialogueChainBuilder, OptionDialogue, PluginManager } = common.core();
  const sender = player.getPacketSender();
  const owner = {};
  // A quest can word its own cargo's warning ("port-tasks:hold-warning"), choosing from OPTIONS:
  // Pandemonium's crate asks "Jim's cargo is still in the cargo hold." with two of them.
  const prompt = { player, boat, dockId, title: TITLE, options: OPTIONS };
  PluginManager.emitCustomEvent("port-tasks:hold-warning", prompt);
  const options = prompt.options.filter((option) => OPTIONS.includes(option));
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new OptionDialogue(0, {
    executeOption: (option) => {
      sender.closeChatboxFor(owner);
      const choice = OPTIONS.indexOf(options[Number(option) - 1]) + 1;
      if (choice === 2) PluginManager.emitCustomEvent("settings:set", { player, settingId: SETTING, value: 1 });
      if (choice === 3) {
        player.setAttribute(SESSION_ATTRIBUTE, true);
        sender.sendVarbit(SESSION_VARBIT, 1);
      }
      if (choice >= 1 && choice <= 3) proceed();
    },
  }, ...options).setTitle(prompt.title)), owner);
  return true;
}

module.exports = { warn, cargoForPort, TITLE, OPTIONS, SETTING, DONT_ASK_VARBIT, SESSION_VARBIT, SESSION_ATTRIBUTE };
