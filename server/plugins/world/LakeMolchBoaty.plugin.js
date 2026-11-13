/**
 * Lake Molch's Boaty: the rowing boat between the lake's three docks (Molch, Battlefront,
 * Shayzien) and Molch Island, where Alry runs aerial fishing. docs/lake-molch-boaty.md.
 *
 * As live OSRS plays it (rsprox capture database, rec 1692 ticks 320-330 and 426-437):
 * - Board opens "Where would you like to go?" with the other three stops, always in the order
 *   Molch Island, Molch, Battlefront, Shayzien, then Cancel.
 * - Picking one: the mesbox "You travel to <stop>." (no continue) and the screen fades out;
 *   three ticks later the player is at that stop and the screen fades back in; two ticks after
 *   that the mesbox and the fade overlay close.
 *
 * Free and without requirements (OSRS Wiki, Lake Molch: no fare or level for the boat).
 * Ours: the Battlefront landing is not captured (data/lake-molch-boaty.json).
 */
const fs = require("fs");
const path = require("path");

/** ObjectIdentifiers.BOATY: the only loc named "Boaty" that runs this route. */
const BOATY = 33614;
const BOATY_NAME = "Boaty";
const TITLE = "Where would you like to go?";
const CANCEL = "Cancel";
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;
const MOVE_TICKS = 3;
const CLOSE_TICKS = 5;

let core = null;
let api = null;
let docks = [];
/** Players mid-trip: Board is ignored until the trip closes (Ours: live never recorded a click mid-trip). */
const travelling = new WeakSet();

function loadDocks() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "data", "lake-molch-boaty.json"), "utf8")).docks;
}

/** The dock whose Boaty is the clicked loc, or -1. */
function dockOf(location) {
  return docks.findIndex(({ boat }) => boat[0] === location.x && boat[1] === location.y && boat[2] === location.z);
}

function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, { postScripts: [{ scriptId: FADE_SCRIPT, args }] });
}

/** The captured trip: mesbox and fade out, the move and fade in three ticks later, closed at five. */
function travel(player, dock) {
  const { Task, TaskManager, Location, StatementDialogue } = core;
  const sender = player.getPacketSender();
  StatementDialogue.send(player, `You travel to ${dock.name}.`, false);
  fade(player, true);
  const movement = player.getMovementQueue();
  movement.setBlockMovement(true).reset();
  travelling.add(player);
  let tick = 0;
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, player, false); }
    execute() {
      tick++;
      if (!player.isRegistered()) {
        this.stop();
        return;
      }
      if (tick === MOVE_TICKS) {
        player.moveTo(new Location(...dock.landing));
        movement.setBlockMovement(false);
        fade(player, false);
      }
      if (tick >= CLOSE_TICKS) {
        sender.sendInterfaceRemoval();
        sender.closeSubInterface(OVERLAY_ATMOSPHERE_UID);
        this.stop();
      }
    }
    stop() {
      travelling.delete(player);
      movement.setBlockMovement(false);
      super.stop();
    }
  })());
}

function board(event) {
  const { player, objectId } = event;
  if (objectId !== BOATY) return false;
  if (travelling.has(player)) return true;
  const here = dockOf(event.location);
  if (here < 0) return false;
  const choices = docks.flatMap((dock, index) => (index === here ? [] : [dock.name, () => travel(player, dock)]));
  api.sendMultiChatboxPrompt(player, TITLE, ...choices, CANCEL, () => {});
  return true;
}

module.exports = {
  name: "LakeMolchBoaty",
  description: "Lake Molch's Boaty: Board rows between Molch, Battlefront, Shayzien and Molch Island.",
  members: true,
  _test: { dockOf, board, travel, get docks() { return docks; } },
  register(registerApi) {
    api = registerApi;
    core = registerApi.core;
    docks = loadDocks();
    registerApi.onObjectInteraction(BOATY_NAME, { Board: board });
  },
};
