"use strict";

/**
 * Crombwick Manor's front doors in Slepe (slp_mansion_door_l / _r) never open. The Wiki (Slepe):
 * "As the entrances to the manor are locked, it is only accessible via the ladder in Kroy's
 * laboratory in the Sisterhood Sanctuary."
 *
 * rsprox captures 227/1000270 tick 6370, 231/391 ticks 2613 and 5210: Open on either leaf walks
 * to the door, then the tick after arrival a message box says "The door is locked." and the
 * player faces the door. Nothing else changes.
 */
const DOOR_LOCS = Object.freeze(["slp_mansion_door_l", "slp_mansion_door_r"]);
const LOCKED = "The door is locked.";

let core = null;

function isManorDoor(objectId) {
  return DOOR_LOCS.some((loc) => core.CacheDefinitions.getLocId(loc) === objectId);
}

function openDoor({ player, objectId }) {
  if (!isManorDoor(objectId)) return false;
  const { DialogueChainBuilder, StatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, LOCKED)));
  return true;
}

module.exports = {
  name: "CrombwickManor",
  description: "Crombwick Manor's front doors in Slepe stay locked.",
  members: true,
  register(api) {
    core = api.core;
    api.onObjectInteraction("Doors", { Open: openDoor });
  },
  _test: { DOOR_LOCS, LOCKED },
};
