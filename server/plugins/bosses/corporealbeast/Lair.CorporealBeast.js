"use strict";

/**
 * The Corporeal Beast's Lair: the cave from the Wilderness, the lobby's exit, the passage to
 * the Beast's room and the room's damage overlay.
 *
 * Capture (games necklace -> one attack): the necklace lands at (2966, 4380, 2) and the lair
 * is multi-way at once. Go-through on the passage (677) moves the player from x 2970 to x 2974
 * a tick later; inside, the Corp overlay (interface 13) opens, and it closes on death.
 * Wiki: the lair is multi-combat and outside the Wilderness; the cave can't be entered while
 * in combat; pets can't be taken into the lair.
 * Cache: the cave (678, 3201 3679); in each copy of the lair the exit (679, 2963 4382 / 4254)
 * and the passage (677, 2971 4382 / 4254, 3 tiles wide, Go-through and Peek); script 693
 * shows varbit 999 as "Damage: N".
 * Offline_Scape: where the cave and the exit put you, and the messages for combat, followers,
 * Peek and the exit's warning (not in the capture or the Wiki).
 */

const Shared = require("./CorpShared");

const PASSAGE_WIDTH = 3;
const PET_ATTRIBUTE = "pets:current";

function playersInRoom() {
  const { World } = Shared.core();
  let count = 0;
  World.getPlayers().forEach((player) => {
    if (player && Shared.inRoom(player.getLocation())) count++;
  });
  return count;
}

/** Other locs share these names ("Cave", "Passage"): anything else falls through. */
function enterCave({ player, objectId }) {
  if (objectId !== Shared.OBJECT.CAVE) return false;
  const { CombatFactory } = Shared.core();
  if (CombatFactory.inCombat(player)) {
    player.sendMessage("You cannot enter the cave while in combat.");
    return true;
  }
  player.moveTo(Shared.loc(Shared.shifted(Shared.CAVE_ARRIVAL)));
  return true;
}

function exitCave({ player, objectId }) {
  if (objectId !== Shared.OBJECT.CAVE_EXIT) return false;
  Shared.options(player, "This exit leads to the Wilderness, are you sure?",
    "Yes.", () => player.moveTo(Shared.loc(Shared.OUTSIDE)),
    "No.", () => {});
  return true;
}

/** West of the passage you come out on its east side, and the other way round (capture). */
function goThrough({ player, objectId, object }) {
  if (objectId !== Shared.OBJECT.PASSAGE) return false;
  const passageX = object.getLocation().getX();
  if (player.getAttribute?.(PET_ATTRIBUTE)?.isRegistered?.()) {
    player.sendMessage("Your follower hides in fear and refuses to enter the cave.");
    return true;
  }
  const here = player.getLocation();
  const x = here.getX() < passageX ? passageX + PASSAGE_WIDTH : passageX - 1;
  Shared.later(player, 1, () => player.moveTo(Shared.loc({ x, y: here.getY(), z: here.getZ() })));
  return true;
}

function peek({ player, objectId }) {
  if (objectId !== Shared.OBJECT.PASSAGE) return false;
  const count = playersInRoom();
  player.sendMessage(count === 0 ? "There are currently no players fighting Corporeal Beast."
    : count === 1 ? "There is currently 1 player fighting Corporeal Beast."
      : `There are currently ${count} players fighting Corporeal Beast.`);
  return true;
}

/** The overlay shows the damage the player has dealt to the Beast (Beast.* keeps it). */
function showOverlay({ player }) {
  player.getPacketSender().sendSubInterface(Shared.OVERLAY_HUD_UID, Shared.INTERFACE.OVERLAY, 1);
}

function hideOverlay({ player }) {
  player.getPacketSender().closeSubInterface(Shared.OVERLAY_HUD_UID);
  player.getPacketSender().sendVarbit(Shared.VARBIT.DAMAGE, 0);
}

module.exports = function registerCorporealBeastLair(api) {
  Shared.bind(api);
  api.onObjectInteraction("Cave", { Enter: enterCave });
  api.onObjectInteraction("Cave exit", { Exit: exitCave });
  api.onObjectInteraction("Passage", { "Go-through": goThrough, Peek: peek });
  for (const room of Shared.ROOM_AREAS) {
    api.onZoneEnter(room, showOverlay);
    api.onZoneExit(room, hideOverlay);
  }
};

Object.assign(module.exports, { enterCave, exitCave, goThrough, peek, showOverlay, hideOverlay, playersInRoom });
