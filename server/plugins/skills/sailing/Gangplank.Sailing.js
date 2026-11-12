// Boarding and disembarking a boat at a dock's gangplank (varbit 19104 switches its op between
// Board and Disembark), and docking at a port's buoy. Fade out, move a tick later, fade back in
// the tick after. Docking and disembarking at another port follow a live capture at Port Sarim
// (docs/sailing-osrs-reference.md); every port and its level are the cache's.
//
// Board-friend (and the boat list's "Board friend's boat") puts a player on somebody else's boat
// as a guest: "Enter name:", then aboard, or one of the captured refusals (rsprox 697 and 698).
//
// Every refusal is a message box on the click's tick, before any fade: no boat here, the boat
// docked at another port or lost at sea, the boat too far from the dock to disembark, or the
// port's Sailing level. A port's gangplank answers a
// click from the deck however far off the boat is; other gangplanks (a ship's Cross) don't.
const { Task } = require("../../../src/main/typescript/elvarg/game/task/Task");
const { TaskManager } = require("../../../src/main/typescript/elvarg/game/task/TaskManager");
const { Sailing } = require("../../../src/main/typescript/elvarg/game/content/sailing/Sailing");
const { Skill } = require("../../../src/main/typescript/elvarg/game/model/Skill");
const { World } = require("../../../src/main/typescript/elvarg/game/World");
const { CacheDefinitions } = require("../../../src/main/typescript/elvarg/game/cache/CacheDefinitions");
const { DialogueChainBuilder } = require("../../../src/main/typescript/elvarg/game/model/dialogues/builders/DialogueChainBuilder");
const { StatementDialogue } = require("../../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/StatementDialogue");
const { ChatType } = require("../../../src/main/typescript/elvarg/net/protocol/ClientProtocol");
const { content, boatType, dockAtGangplank, dockAtBuoy, fade, playSound, spam } = require("./SailingContent.Sailing");
const { sendBoatVarbits } = require("./BoatVarbits.Sailing");
const { MODE, openBoatSelection } = require("./BoatSelection.Sailing");
const holdWarning = require("./porttasks/HoldWarning.PortTasks");

const SOUND_BOARD_BOAT = 10754;
const SOUND_DOCK = 1794;
/** The chatbox's name prompt; the client answers with `resume_p_namedialog` (rsprox 697). */
const SCRIPT_NAME_INPUT = 109;
const BOAT_TABLE = 166;
/** Ours: a port's gangplank is used from a deck anywhere in view, so a boat too far off hears why. */
const GANGPLANK_DECK_REACH = 64;
const TOO_FAR = "The boat isn't close enough for you to be able to disembark here.";

/** Boarding somebody else's boat, as captured (rsprox 697). The first is a plain game message, the rest message boxes. */
const FRIEND_PROMPT = "Enter name:";
const FRIEND_OFFLINE = "That player is offline, or has privacy mode enabled.";
const FRIEND_REFUSALS = {
  aboard: "You're already on a boat.",
  "not-aboard": "The player is not on their own boat, so you cannot join them.",
  "not-here": "That player does not have a boat for you to board right now.",
  full: "There's no space for you on that boat.",
};

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
    openBoatSelection(player, MODE.BOARD, dock, (slot) => boardSlot(this, player, dock, slot),
      () => askWhoseBoat(this, player, dock));
  } else {
    boardSlot(this, player, dock, undefined);
  }
}

/** Boards the boat in `slot`, or with none given the one moored here. */
function boardSlot(api, player, dock, slot) {
  const refusal = Sailing.boardRefusal(player, dock.id, slot);
  if (refusal) {
    messageBox(player, refusal);
    return;
  }
  fade(player, true);
  later(player, 1, () => {
    if (!boardingAllowed(api, player, dock)) {
      fade(player, false);
      return;
    }
    const refused = Sailing.board(player, dock.id, slot);
    if (refused) {
      fade(player, false);
      messageBox(player, refused);
      return;
    }
    playSound(player, SOUND_BOARD_BOAT);
    spam(player, "You board your boat.");
    later(player, 1, () => fade(player, false));
  });
}

/** How many players a boat holds, its owner included (table 166 `player_capacity`: raft 2, skiff 5, sloop 10). */
function playerCapacity(owned) {
  const row = CacheDefinitions.getDbRow(boatType(owned.type)?.sidepanelBoatType);
  const column = CacheDefinitions.getDbColumn(BOAT_TABLE, "player_capacity");
  return (column === null ? undefined : row?.int(column, 0)) || 1;
}

/** A message box, with its line in the chat as live sends it (a mesbox message). */
function messageBox(player, text) {
  player.getPacketSender().sendTypedMessage(ChatType.MESBOX, text);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
}

/**
 * The ports' gangplanks and mooring points: the multilocs that turn into a Sailing gangplank with
 * Board-friend (varbit 19104), not every loc that shares the name.
 */
function portGangplankIds() {
  const total = CacheDefinitions.getCounts().objects;
  const boardable = new Set();
  for (let id = 0; id < total; id++) {
    if (CacheDefinitions.getObject(id)?.actions?.includes("Board-friend")) boardable.add(id);
  }
  const ports = [];
  for (let id = 0; id < total; id++) {
    const transforms = CacheDefinitions.getObject(id)?.transforms;
    if (Array.isArray(transforms) && transforms.some((variant) => boardable.has(variant))) ports.push(id);
  }
  return ports;
}

/** Board-friend: boards somebody else's boat, moored at this dock with them aboard. */
function boardFriendsBoat({ player, location }) {
  const dock = dockAtGangplank(location);
  if (!dock) return false;
  if (!boardingAllowed(this, player, dock)) return true;
  askWhoseBoat(this, player, dock);
}

function askWhoseBoat(api, player, dock) {
  player.getPacketSender().sendInterfaceRemoval();
  player.setEnteredSyntaxAction({ execute: (name) => boardBoatOf(api, player, dock, String(name ?? "").trim()) });
  player.getPacketSender().sendClientScript(SCRIPT_NAME_INPUT, FRIEND_PROMPT);
}

/**
 * The named player has to be someone this player could see online (their private chat on, or on
 * friends with this player a friend), and aboard their own boat at this dock with room to spare.
 */
function boardBoatOf(api, player, dock, name) {
  if (!name || !nearDock(player, dock)) return;
  const owner = World.getPlayerByName(name);
  if (!owner || owner === player || !owner.getRelations().isVisibleTo(player)) {
    player.sendMessage(FRIEND_OFFLINE);
    return;
  }
  if (!boardingAllowed(api, player, dock)) return;
  const refusal = guestRefusal(player, owner, dock, false);
  if (refusal) {
    messageBox(player, FRIEND_REFUSALS[refusal]);
    return;
  }
  // As boarding your own boat: fade out, aboard a tick later, fade back in the tick after.
  fade(player, true);
  later(player, 1, () => {
    const refused = !owner.isRegistered() || !boardingAllowed(api, player, dock)
      ? "not-aboard" : guestRefusal(player, owner, dock, true);
    if (refused) {
      fade(player, false);
      messageBox(player, FRIEND_REFUSALS[refused]);
      return;
    }
    playSound(player, SOUND_BOARD_BOAT);
    later(player, 1, () => fade(player, false));
  });
}

/** Why the player can't board `owner`'s boat here, or null; with `board`, puts them aboard. */
function guestRefusal(player, owner, dock, board) {
  const instance = Sailing.instanceAboard(owner);
  const owned = instance && Sailing.ownedOf(instance);
  if (!owned) return "not-aboard";
  return (board ? Sailing.boardAsGuest : Sailing.guestRefusal)(player, owner, dock.id, playerCapacity(owned));
}

/** Still by the dock when the name arrives: the prompt stays up while the player walks off. */
function nearDock(player, dock) {
  const here = player.getLocation();
  const distance = (tile) => Math.max(Math.abs(tile.x - here.getX()), Math.abs(tile.y - here.getY()));
  return distance(dock.gangplank) <= 2 || distance(dock.landing) <= 2;
}

/** A guest steps off somebody else's boat at the port it's moored at. The line isn't captured. */
function disembarkAsGuest(player, dock) {
  fade(player, true);
  later(player, 1, () => {
    if (Sailing.guestBoat(player)) {
      const refused = Sailing.disembarkGuest(player, dock.id);
      if (refused) {
        player.sendMessage(refused);
      } else {
        spam(player, `You disembark at ${dock.theName}.`);
        playSound(player, SOUND_BOARD_BOAT);
      }
    }
    later(player, 1, () => fade(player, false));
  });
}

/** Why the player can't dock or disembark (`verb`) at a port: its Sailing level (table 194), or null. */
function levelRefusal(player, dock, verb) {
  const level = dock.level ?? 1;
  return player.getSkillManager().getCurrentLevel(Skill.SAILING) < level
    ? `You need a Sailing level of ${level} to ${verb} here.`
    : null;
}

/** A port's buoy: dock there and stay aboard; the port becomes the boat's and the return point. */
function dockAtBuoyOp({ player, location }) {
  const dock = dockAtBuoy(location);
  if (!dock || !Sailing.instanceAboard(player)) return false;
  const tooLow = levelRefusal(player, dock, "dock");
  if (tooLow) {
    messageBox(player, tooLow);
    return;
  }
  const refusal = Sailing.dock(player, dock.id);
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
  if (dock && Sailing.guestBoat(player)) return disembarkAsGuest(player, dock);
  if (!dock || !Sailing.instanceAboard(player)) return false;
  if (!Sailing.boatNearDock(player, dock.id)) {
    messageBox(player, TOO_FAR);
    return;
  }
  const docked = Sailing.lastPortOf(Sailing.activeBoat(player)) === dock.id;
  const refusal = docked ? null : levelRefusal(player, dock, "disembark");
  if (refusal) {
    messageBox(player, refusal);
    return;
  }
  // Checked again at the answer: the boat may have sailed off while the question was open.
  const leave = () => {
    if (!Sailing.instanceAboard(player)) return;
    if (!Sailing.boatNearDock(player, dock.id)) messageBox(player, TOO_FAR);
    else leaveBoat(player, dock, docked);
  };
  if (holdWarning.warn(player, Sailing.activeBoat(player), dock.id, leave)) return;
  leaveBoat(player, dock, docked);
}

function leaveBoat(player, dock, docked) {
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
  portGangplankIds,
  register(api) {
    content();
    api.onObjectInteraction("Gangplank", { Board: boardBoat.bind(api), "Board-friend": boardFriendsBoat.bind(api), Disembark: disembarkBoat });
    api.onObjectInteraction("Mooring point", { Board: boardBoat.bind(api), "Board-friend": boardFriendsBoat.bind(api), Disembark: disembarkBoat });
    api.onObjectInteraction("Buoy", { Dock: dockAtBuoyOp });
    api.setUsableFromDeck?.(["Gangplank", "Mooring point", "Buoy"]);
    api.onServerStartup?.(() => api.setDeckReach?.(portGangplankIds(), GANGPLANK_DECK_REACH));
  },
};
