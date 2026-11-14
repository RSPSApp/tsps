/**
 * Waterbirth Island Dungeon's three circular pressure-pad doors (x 2491, y 10130/10146/10162).
 * Each door has two floor pads west of it, on its south and north rows. With both pads held
 * (two players, or one player and a dropped pet rock) the door opens from the west; from the
 * east (inside) it lets the player straight back out. Every player uses them, not only quests.
 *
 * rsprox captures (rsprox.net recordings 86, 91, 1851, 1856, 1863; rev 227, Leagues V; no
 * league rule touches these doors):
 *  - Drop the pet rock (inventory op 7) standing on a pad: the rock leaves the inventory, the
 *    player plays seq 827 and NPC 5983 "Pet rock" appears on that tile facing south.
 *  - Take on that NPC: it is removed, the pet rock returns to the inventory, synth sound 2582.
 *  - Open from the west with both pads held: the door becomes loc 8963 (same shape 10, rotation
 *    1) with area sound 1066 (range 5) on arrival, and turns back 49 ticks later, whether or not
 *    the pads stay held (rec 91 ticks 6887 -> 6936, rec 1863 5886 -> 5935).
 *  - Open from the east: 2 ticks after arrival the player steps to the door's middle row, the
 *    next tick the door opens with inviswalls (38848) on its three tiles and the player walks
 *    the two tiles west through it; 4 ticks later the door and inviswalls go back (recs 86, 91,
 *    1863).
 *
 * Ours (no source): Open from the west without both pads held does nothing (no capture tries
 * it); only the player who dropped a rock can Take it, and it goes back to their inventory
 * (the bank when full) when they log out; a teleport or walk-away cancels the east exit.
 */

/** Cache inviswall (gameval `inviswall`); nameless, so it has no ObjectIdentifiers constant. */
const INVISWALL = 38848;
const DOOR_X = 2491;
const PAD_X = 2490;
const DROP_ANIMATION = 827;
const OPEN_SOUND = 1066;
const OPEN_SOUND_RANGE = 5;
const TAKE_SOUND = 2582;
/** A door opened from the west turns back this many ticks later (captured). */
const PAD_OPEN_TICKS = 49;
/** From the east: step to the middle row at +2, through at +3, door shut at +7 (captured). */
const EXIT_STEP_TICKS = 2;
const EXIT_SHUT_TICKS = 4;
const WALK_ANIMATION = 819;
const DOOR_SHAPE = 10;
const DOOR_FACE = 1;

let core = null;
/** Closed door id -> the door's south row (its pads are this row and two north). */
let DOORS = null;
let OPEN_DOOR = null;
let PET_ROCK_NPC = null;
let PET_ROCK_ITEM = null;

/** "x,y,z" of a pad -> { npc, owner } for a dropped rock. */
const rocks = new Map();
/** Closed door id -> its open state while it is open. */
const openDoors = new Map();

function attach(api) {
  core = api.core;
  const { ObjectIdentifiers: O, NpcIdentifiers: N, ItemIdentifiers: I } = core;
  DOORS = new Map([[O.DOOR_216, 10130], [O.DOOR_215, 10146], [O.DOOR_214, 10162]]);
  OPEN_DOOR = O.DOOR_217;
  PET_ROCK_NPC = N.COL_FF9040_PET_ROCK_COL;
  PET_ROCK_ITEM = I.PET_ROCK;
}

const key = (x, y, z) => `${x},${y},${z}`;

function padRows() {
  const rows = new Set();
  for (const y of DOORS.values()) rows.add(y).add(y + 2);
  return rows;
}

function onPad(location) {
  return location.getZ() === 0 && location.getX() === PAD_X && padRows().has(location.getY());
}

function rockAt(x, y, z) {
  const rock = rocks.get(key(x, y, z));
  if (rock && rock.npc.isRegistered?.() === false) {
    rocks.delete(key(x, y, z));
    return null;
  }
  return rock ?? null;
}

function padHeld(x, y, z) {
  if (rockAt(x, y, z)) return true;
  for (const player of core.World.getPlayers?.() ?? []) {
    if (!player || player.isRegistered?.() === false) continue;
    const at = player.getLocation?.();
    if (at && at.getX() === x && at.getY() === y && at.getZ() === z) return true;
  }
  return false;
}

function padsHeld(row) {
  return padHeld(PAD_X, row, 0) && padHeld(PAD_X, row + 2, 0);
}

// ---------------------------------------------------------------------------------------------
// The pet rock
// ---------------------------------------------------------------------------------------------

function dropPetRock(event) {
  const { player, itemId, slot } = event;
  if (itemId !== PET_ROCK_ITEM || !event.dropToGround) return;
  const at = player.getLocation();
  if (!onPad(at) || rockAt(at.getX(), at.getY(), at.getZ())) return;
  event.handled = true;
  event.dropToGround = false;
  player.getInventory().setItem(slot, new core.Item(-1, 0)).refreshItems();
  player.performAnimation(new core.Animation(DROP_ANIMATION));
  const npc = new core.NPC(PET_ROCK_NPC, at.clone());
  npc.__skipDefaultRespawn = true;
  rocks.set(key(at.getX(), at.getY(), at.getZ()), { npc, owner: player });
  core.World.getAddNPCQueue().push(npc);
}

function removeRock(tileKey, rock) {
  rocks.delete(tileKey);
  core.World.getRemoveNPCQueue().push(rock.npc);
}

function takePetRock(event) {
  const { player, npc } = event;
  for (const [tileKey, rock] of rocks) {
    if (rock.npc !== npc) continue;
    if (rock.owner !== player) return true;
    if (player.getInventory().getFreeSlots() <= 0) {
      player.getInventory().full();
      return true;
    }
    removeRock(tileKey, rock);
    player.getInventory().add(new core.Item(PET_ROCK_ITEM, 1), true);
    player.getPacketSender().sendSoundEffect(TAKE_SOUND, 1, 0);
    return true;
  }
  return false;
}

function returnRocks({ player }) {
  for (const [tileKey, rock] of rocks) {
    if (rock.owner !== player) continue;
    removeRock(tileKey, rock);
    const rockItem = new core.Item(PET_ROCK_ITEM, 1);
    // A full inventory would drop the add; the bank keeps the rock instead (Ours).
    if (player.getInventory().getFreeSlots() > 0) player.getInventory().add(rockItem, true);
    else player.getBank(core.Bank.getTabForItem(player, PET_ROCK_ITEM)).add(rockItem, false);
  }
}

// ---------------------------------------------------------------------------------------------
// The doors
// ---------------------------------------------------------------------------------------------

function doorAt(id, row) {
  return core.MapObjects.get(id, new core.Location(DOOR_X, row, 0), null) ?? null;
}

/** One loc_add_change in place, as live sends it (no removal first). */
function swapDoor(fromId, toId, row) {
  const tile = new core.Location(DOOR_X, row, 0);
  const current = doorAt(fromId, row) ?? new core.GameObject(fromId, tile, DOOR_SHAPE, DOOR_FACE, null);
  core.ObjectManager.replaceInPlace(current, new core.GameObject(toId, tile.clone(), DOOR_SHAPE, DOOR_FACE, null));
}

function setInviswalls(row, present) {
  for (let dy = 0; dy < 3; dy++) {
    const tile = new core.Location(DOOR_X, row + dy, 0);
    if (present) {
      core.ObjectManager.register(new core.GameObject(INVISWALL, tile, 0, 0, null), true);
    } else {
      const wall = core.MapObjects.get(INVISWALL, tile, null);
      if (wall) core.ObjectManager.deregister(wall, true);
    }
  }
}

function later(ticks, name, fn) {
  const task = new core.Task(ticks, `waterbirth-pressure-door:${name}`, false);
  task.execute = () => {
    task.stop();
    fn();
  };
  core.TaskManager.submit(task);
}

function openDoor(doorId, row, ticks, inviswalls) {
  openDoors.set(doorId, { row, inviswalls });
  swapDoor(doorId, OPEN_DOOR, row);
  if (inviswalls) setInviswalls(row, true);
  core.Sounds.playAreaSound({ soundId: OPEN_SOUND, x: DOOR_X, y: row, level: 0, radius: OPEN_SOUND_RANGE });
  later(ticks, `shut:${doorId}`, () => shutDoor(doorId));
}

function shutDoor(doorId) {
  const state = openDoors.get(doorId);
  if (!state) return;
  openDoors.delete(doorId);
  swapDoor(OPEN_DOOR, doorId, state.row);
  if (state.inviswalls) setInviswalls(state.row, false);
}

/** Still at the door's east side: a teleport or walk-away during the exit cancels it (Ours). */
function stillBeside(player, middle) {
  if (player.isRegistered?.() === false) return false;
  const at = player.getLocation();
  return at.getZ() === middle.getZ() && at.getX() === middle.getX() && Math.abs(at.getY() - middle.getY()) <= 1;
}

/** From the east: line up on the middle row, then walk the two tiles west through the door. */
function letOut(player, doorId, row) {
  const middle = new core.Location(DOOR_X + 1, row + 1, 0);
  openDoors.set(doorId, { row, inviswalls: false, pending: true });
  later(EXIT_STEP_TICKS, `step:${doorId}`, () => {
    if (!stillBeside(player, middle)) return openDoors.delete(doorId);
    if (!player.getLocation().equals(middle)) player.moveTo(middle.clone());
    later(1, `out:${doorId}`, () => {
      openDoors.delete(doorId);
      if (!stillBeside(player, middle)) return;
      openDoor(doorId, row, EXIT_SHUT_TICKS, true);
      core.TaskManager.submit(new core.ForceMovementTask(player, 1,
        new core.ForceMovement(middle.clone(), new core.Location(-2, 0, 0), 0, 30, 3, WALK_ANIMATION)));
    });
  });
}

function openPressureDoor({ player, objectId, location }) {
  const row = DOORS.get(objectId);
  if (row === undefined || location?.x !== DOOR_X || location?.y !== row || location?.z !== 0) return false;
  if (openDoors.has(objectId)) return true;
  const at = player.getLocation();
  if (at.getX() > DOOR_X) {
    letOut(player, objectId, row);
    return true;
  }
  if (!padsHeld(row) || !doorAt(objectId, row)) return true;
  openDoor(objectId, row, PAD_OPEN_TICKS, false);
  return true;
}

module.exports = {
  name: "WaterbirthPressureDoors",
  description: "Waterbirth Island Dungeon's pressure-pad doors: two held pads (a second player or a dropped pet rock) open them, and they let players back out.",
  members: true,
  _test: { attach, rocks, openDoors, dropPetRock, takePetRock, returnRocks, openPressureDoor, padsHeld },
  register(api) {
    attach(api);
    api.onObjectInteraction("Door", { Open: openPressureDoor });
    api.onItemDropPolicy(dropPetRock);
    api.onNpcInteraction("<col=ff9040>Pet rock</col>", { Take: takePetRock });
    api.onPlayerLogout(returnRocks);
  },
};
