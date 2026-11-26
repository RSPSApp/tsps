"use strict";

/**
 * Doors that never open: their Open answers a locked line and the door stays shut. Lines,
 * sounds and whether they come in a message box or as an NPC's chathead line (the occupied
 * outhouses' "Occupied!"): data/locked-doors.json, cited per door
 * (docs/locked-doors.md).
 *
 * Some of these are a cache "Open" loc whose id + 1 is a same-model "Close" loc
 * (prisonbarsdoor_locked -> prisonbarsdoor_open, frisb_abode_door_locked ->
 * frisb_abode_door_open), which the Doors plugin's cache-derived pairs would otherwise swing
 * open. This claims them through Doors' `door:toggle` request, before any pair is looked up.
 *
 * Doors also routes a closed wall door across its face only (blockAccessFlags 0x5), which
 * walks the player onto the door's tile. Live answers these from either side, the wall's end
 * tiles included (rsprox 323: from 3012,3188 and 3012,3196 for the cell at 3012,3189/3195), so
 * they keep ordinary wall reach. That route hook is added at startup, after Doors' own.
 */
const fs = require("node:fs");
const path = require("node:path");

const DOORS = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "locked-doors.json"), "utf8")).doors;

let core = null;
/** @type {Map<number, object> | null} loc id -> its door entry, built on first use from the cache gamevals. */
let byId = null;

function lockedDoorFor(objectId) {
  if (!byId) {
    byId = new Map();
    for (const door of DOORS) {
      for (const loc of door.locs) {
        const id = core.CacheDefinitions.getLocId(loc);
        if (id != null && id >= 0) byId.set(id, door);
      }
    }
  }
  return byId.get(objectId) ?? null;
}

/** @type {WeakMap<object, object>} player -> the token of their one pending delayed answer. */
const PENDING_ANSWERS = new WeakMap();

function refuseLockedDoor(request) {
  if (request.handled || !request.player) return;
  const door = lockedDoorFor(request.objectId);
  if (!door) return;
  request.handled = true;
  const { player } = request;
  if (!door.delay) {
    answerLockedDoor(player, door);
    return;
  }
  // The outhouse's man answers a tick after the player turns to the door. One answer is
  // pending per player: a second click in that tick replaces the first rather than playing
  // the line twice. A player who logged out, or was moved off the tile by a forced move
  // (a teleport, say), gets no line (ours: live recorded neither).
  const at = player.getLocation().clone();
  const token = {};
  PENDING_ANSWERS.set(player, token);
  core.TaskManager.submit(new core.CountdownTask(player, door.delay, () => {
    if (PENDING_ANSWERS.get(player) !== token) return;
    PENDING_ANSWERS.delete(player);
    if (player.isRegistered() && player.getLocation().equals(at)) answerLockedDoor(player, door);
  }));
}

function answerLockedDoor(player, door) {
  if (door.sound) player.getPacketSender().sendSound(door.sound, 1, 0);
  if (door.npc) {
    const { DialogueChainBuilder, NpcDialogue } = core;
    const npcId = core.CacheDefinitions.getNpcId(door.npc);
    player.getDialogueManager().startDialogues(
      new DialogueChainBuilder().add(new NpcDialogue(0, npcId, door.message, undefined, door.expression)));
  } else if (door.box) {
    const { DialogueChainBuilder, StatementDialogue } = core;
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, door.message)));
  } else {
    player.sendMessage(door.message);
  }
}

/** Undo Doors' face-only reach for a locked door. */
function routeLockedDoor(event) {
  if (lockedDoorFor(event.objectId) && event.blockAccessFlags) event.blockAccessFlags &= ~0x5;
}

let pluginApi = null;

function registerLockedDoorRoutes() {
  pluginApi.onObjectRoute(routeLockedDoor);
}

module.exports = {
  name: "LockedDoors",
  description: "Doors that never open (the Port Sarim jail cells, Neitiznot's houses, a Civitas illa Fortis door, the occupied outhouses) answer Open with their recorded locked line.",
  register(api) {
    pluginApi = api;
    core = api.core;
    api.onCustomEvent("door:toggle", refuseLockedDoor);
    api.onServerStartup(registerLockedDoorRoutes);
  },
  _test: { DOORS, lockedDoorFor, refuseLockedDoor, routeLockedDoor },
};
