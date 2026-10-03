// The boat selection interface (934): choosing which of your boats to board at a gangplank or
// to recover at a shipwright. Packets follow live captures (docs/sailing-osrs-reference.md):
// the mode varbit, the current dock's db row, the cargo holds, script 2524, the modal, init
// script 8621 and 934:5's events; a choice resumes 934:5 with the boat's slot (from 1).
const { content, setVarbit } = require("./sailingContent");
const { sendBoatVarbits } = require("./boatVarbits");
const cargo = require("./cargo");

const SELECTION = 934;
const BOATS = 5;
const MAIN_MODAL = (161 << 16) | 16;
const VARBIT_MODE = 18553;
const VARP_CURRENT_DOCK = 5005;
const SCRIPT_MAINMODAL_OPEN = 2524;
const SCRIPT_INIT = 8621;
/** `chatdefault_restoreinput`: gives the chatbox its input back after the choice, as OSRS does. */
const SCRIPT_RESTORE_CHAT_INPUT = 2158;
const IF_EVENT_PAUSEBUTTON_OP1 = (1 << 0) | (1 << 1);
const MAX_BOATS = 5;

/** What the interface was opened for (varbit 18553). */
const MODE = { CUSTOMISE: 2, BOARD: 3, RECOVER: 5 };

/** The pending choice per player: what to do with the chosen boat slot. */
const pending = new Map();

/**
 * Opens the interface in `mode` at `dock`; `onChoose(slot)` runs with the chosen boat's slot
 * (from 0) once the player picks one.
 */
function openBoatSelection(player, mode, dock, onChoose) {
  const sender = player.getPacketSender();
  sendBoatVarbits(player);
  for (const boat of player.getSailing().boats) {
    sender.sendInventory(cargo.sentInventoryIdOf(boat), cargo.capacityOf(boat), boat.cargo);
  }
  setVarbit(player, VARBIT_MODE, mode);
  sender.sendConfig(VARP_CURRENT_DOCK, dock.selectionDbrow ?? -1);
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -3]);
  player.setInterfaceId(SELECTION);
  sender.sendSubInterface(MAIN_MODAL, SELECTION, 0);
  sender.sendInterfaceScript(SCRIPT_INIT);
  sender.sendInterfaceFlagsRange((SELECTION << 16) | BOATS, 1, MAX_BOATS, IF_EVENT_PAUSEBUTTON_OP1);
  pending.set(player, onChoose);
}

function closeSelection(player) {
  pending.delete(player);
  setVarbit(player, VARBIT_MODE, 0);
  player.getPacketSender().sendConfig(VARP_CURRENT_DOCK, -1);
  player.getPacketSender().sendInterfaceScript(SCRIPT_RESTORE_CHAT_INPUT);
  player.getPacketSender().sendInterfaceRemoval();
}

/** A choice arrives as a pause-button resume (action = slot) or an op 1 click (slot). */
function chooseBoat(event) {
  if (event.groupId !== SELECTION || event.childId !== BOATS) return;
  event.handled = true;
  const { player } = event;
  const onChoose = pending.get(player);
  if (!onChoose || player.getInterfaceId?.() !== SELECTION) return;
  const chosen = Number.isInteger(event.slot) && event.slot > 0 ? event.slot : event.action;
  if (!Number.isInteger(chosen) || chosen < 1 || chosen > MAX_BOATS) return;
  closeSelection(player);
  onChoose(chosen - 1);
}

function forgetPending({ player }) {
  pending.delete(player);
}

module.exports = {
  name: "SailingBoatSelection",
  members: true,
  MODE,
  openBoatSelection,
  register(api) {
    content();
    api.onInterfaceActionClick(chooseBoat);
    api.onPlayerLogout(forgetPending);
  },
};
