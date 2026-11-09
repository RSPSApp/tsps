// Boarding and disembarking a boat at a dock's gangplank (varbit 19104 switches its op between
// Board and Disembark), and docking at a port's buoy. Fade out, move a tick later, fade back in
// the tick after. Docking and disembarking at another port follow a live capture at Port Sarim
// (docs/sailing-osrs-reference.md); every port and its level are the cache's.
const { Task } = require("../../../src/main/typescript/elvarg/game/task/Task");
const { TaskManager } = require("../../../src/main/typescript/elvarg/game/task/TaskManager");
const { Sailing } = require("../../../src/main/typescript/elvarg/game/content/sailing/Sailing");
const { Skill } = require("../../../src/main/typescript/elvarg/game/model/Skill");
const { content, dockAtGangplank, dockAtBuoy, fade, playSound, spam } = require("./SailingContent.Sailing");
const { sendBoatVarbits } = require("./BoatVarbits.Sailing");
const { MODE, openBoatSelection } = require("./BoatSelection.plugin");

const SOUND_BOARD_BOAT = 10754;
const SOUND_DOCK = 1794;

function later(player, ticks, action) {
  TaskManager.submit(new (class extends Task {
    constructor() { super(ticks, player); }
    execute() {
      action();
      this.stop();
    }
  })());
}

/** Check again at the delayed commit: a condition may change while a boat is selected. */
function boardingAllowed(api, player, dock) {
  const event = { player, dock, allow: true, reason: null };
  api.emitCustomEvent("sailing:can-board", event);
  if (event.allow !== false) return true;
  if (event.reason) player.sendMessage(event.reason);
  return false;
}

/** With more than one boat, Board asks which (the boat selection interface, as in OSRS). */
function boardBoat({ player, location }) {
  const dock = dockAtGangplank(location);
  if (!dock) return false;
  if (!boardingAllowed(this, player, dock)) return true;
  if (player.getSailing().boats.length > 1) {
    openBoatSelection(player, MODE.BOARD, dock, (slot) => boardSlot(this, player, dock, slot));
  } else {
    boardSlot(this, player, dock, undefined);
  }
}

/** Boards the boat in `slot`, or with none given the one moored here. */
function boardSlot(api, player, dock, slot) {
  fade(player, true);
  later(player, 1, () => {
    if (!boardingAllowed(api, player, dock)) {
      fade(player, false);
      return;
    }
    const refusal = Sailing.board(player, dock.id, slot);
    if (refusal) {
      fade(player, false);
      player.sendMessage(refusal);
      return;
    }
    playSound(player, SOUND_BOARD_BOAT);
    spam(player, "You board your boat.");
    later(player, 1, () => fade(player, false));
  });
}

/** Why the player can't dock at a port: its Sailing level (table 194), or null. Guessed text. */
function levelRefusal(player, dock) {
  const level = dock.level ?? 1;
  return player.getSkillManager().getCurrentLevel(Skill.SAILING) < level
    ? `You need a Sailing level of at least ${level} to dock at ${dock.theName}.`
    : null;
}

/** A port's buoy: dock there and stay aboard; the port becomes the boat's and the return point. */
function dockAtBuoyOp({ player, location }) {
  const dock = dockAtBuoy(location);
  if (!dock || !Sailing.instanceAboard(player)) return false;
  const refusal = levelRefusal(player, dock) ?? Sailing.dock(player, dock.id);
  if (refusal) {
    player.sendMessage(refusal);
    return;
  }
  sendBoatVarbits(player);
  player.sendMessage(`You dock the boat at ${dock.theName}. You will return here if you have to abandon your boat for any reason.`);
  playSound(player, SOUND_DOCK);
}

/**
 * A port's gangplank, from the boat: disembark there, which docks the boat if it wasn't. Both
 * lines are spam; docking says so (rsprox captures, rev 235: both lines in the same recordings at
 * Port Sarim, the Pandemonium and Musa Point).
 */
function disembarkBoat({ player, location }) {
  const dock = dockAtGangplank(location);
  if (!dock || !Sailing.instanceAboard(player)) return false;
  const docked = Sailing.lastPortOf(Sailing.activeBoat(player)) === dock.id;
  const refusal = docked ? null : levelRefusal(player, dock);
  if (refusal) {
    player.sendMessage(refusal);
    return;
  }
  fade(player, true);
  later(player, 1, () => {
    const refused = Sailing.disembark(player, dock.id);
    if (refused) {
      player.sendMessage(refused);
    } else {
      spam(player, docked ? `You disembark at ${dock.theName}.` : `You dock the boat at ${dock.theName} and disembark.`);
      playSound(player, SOUND_BOARD_BOAT);
    }
    later(player, 1, () => fade(player, false));
  });
}

module.exports = {
  name: "SailingGangplank",
  description: "Boarding and disembarking boats at gangplanks and mooring points, and docking at a port's buoy, with fades and sounds.",
  members: true,
  register(api) {
    content();
    api.onObjectInteraction("Gangplank", { Board: boardBoat.bind(api), Disembark: disembarkBoat });
    api.onObjectInteraction("Mooring point", { Board: boardBoat.bind(api), Disembark: disembarkBoat });
    api.onObjectInteraction("Buoy", { Dock: dockAtBuoyOp });
    api.setUsableFromDeck?.(["Gangplank", "Mooring point", "Buoy"]);
  },
};
