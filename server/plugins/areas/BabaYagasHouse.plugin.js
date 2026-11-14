/**
 * Baba Yaga's house on Lunar Isle: the walking chicken-legged House (npc 3836, size 5) and the
 * door inside it (loc 16774). See docs/baba-yagas-house.md.
 *
 * rsprox captures (local recordings 1000187, 1000268, 1000372, 1000456, 1000463, 1000480 rev 227,
 * 1000763 rev 228):
 * - **Go-inside:** the tick after the player reaches the house, they are moved to (2451, 4645, 0)
 *   inside it, with no animation or fade. A tick later the camera starts shaking (slot 1, sine
 *   amplitude 10, frequency 25: the Settings "Baba Yaga's house" shake) and sound 1692 plays.
 * - **Door, Open:** the player faces the door, and two ticks after the click they are put back
 *   outside beside the house, wherever it has walked to by then, with sound 85 and a camera reset
 *   that ends the shake. The five captured exits land one tile diagonally off the house's south-west
 *   corner, (+1, -1), (-1, +1) or (-1, -1). Ours: one of those three is picked at random, and a
 *   blocked one is skipped.
 * - **Leaving another way:** a Teleport cast inside (1000456 tick 190) also gets a camera reset, so
 *   the house's interior is an Area whose leave ends the shake once, whichever way the player went.
 *   Ours: a login inside does not start the shake again.
 */

const INSIDE = { x: 2451, y: 4645, z: 0 };
/** The house's spawn (npc-spawns.json), for an exit while no house is in the world. */
const HOUSE_SPAWN = { x: 2082, y: 3929, z: 0 };
const EXIT_OFFSETS = [[1, -1], [-1, 1], [-1, -1]];
/** NPC options run on the arrival tick, so the move is a tick after the handler. */
const ENTER_TICKS = 1;
/** Loc options run a tick after the arrival (as in LocTeleports), so two ticks from the click is one from here. */
const EXIT_TICKS = 1;
const ENTER_SOUND = 1692;
const EXIT_SOUND = 85;
/** slot, random amplitude, sine amplitude, sine frequency: captured cam_shake 1, 0, 10, 25. */
const SHAKE = [1, 0, 10, 25];
/** The house's interior; leaving it by any way ends the shake (live resets the camera on a spell out too). */
const INTERIOR = { minX: 2445, maxX: 2457, minY: 4640, maxY: 4652, z: 0 };
const SHAKING_ATTRIBUTE = "baba-yagas-house:shaking";

const CameraShake = require("../interface/CameraShake.plugin");

let api = null;
let core = null;

/**
 * Runs `step` `ticks` ticks from now with the player held in place, as the captures show no walking
 * in between. Logging out, dying or being moved elsewhere first cancels it.
 */
function after(player, ticks, step) {
  const movement = player.getMovementQueue();
  if (movement.isMovementBlocked()) return;
  const start = player.getLocation().clone();
  let left = ticks;
  movement.setBlockMovement(true).reset();
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(1, player, false); }
    execute() {
      if (!player.isRegistered() || player.getHitpoints() <= 0 || !player.getLocation().equals(start)) {
        this.stop();
        return;
      }
      if (--left > 0) return;
      this.stop();
      step();
    }
    stop() {
      movement.setBlockMovement(false);
      super.stop();
    }
  })());
}

/** The house's Go-inside: inside a tick later, the shake and its sound a tick after that. */
function goInside({ player, npc }) {
  if (npc?.getId?.() !== core.NpcIdentifiers.HOUSE) return false;
  after(player, ENTER_TICKS, () => {
    player.moveTo(new core.Location(INSIDE.x, INSIDE.y, INSIDE.z));
    core.TaskManager.submit(new core.CountdownTask(player, 1, () => startShake(player)));
  });
  return true;
}

function inside(location) {
  return location.getZ() === INTERIOR.z && location.getX() >= INTERIOR.minX && location.getX() <= INTERIOR.maxX
    && location.getY() >= INTERIOR.minY && location.getY() <= INTERIOR.maxY;
}

function startShake(player) {
  if (!player.isRegistered() || !inside(player.getLocation())) return;
  const sender = player.getPacketSender();
  CameraShake.send(sender, "babaYaga", ...SHAKE);
  sender.sendSound(ENTER_SOUND, 1, 0);
  player.setAttribute(SHAKING_ATTRIBUTE, true);
}

/** The camera reset that ends the house's shake, once, however the player left. */
function stopShake(player) {
  if (player.getAttribute(SHAKING_ATTRIBUTE) !== true) return;
  player.setAttribute(SHAKING_ATTRIBUTE, null);
  player.getPacketSender().sendCameraReset();
}

/** Where the house stands now: the nearest House NPC to its spawn, or the spawn itself. */
function houseCorner() {
  let best = null;
  let bestDistance = Infinity;
  for (const npc of core.World.getNpcs()) {
    if (npc?.getId?.() !== core.NpcIdentifiers.HOUSE || !npc.isRegistered?.()) continue;
    const at = npc.getLocation();
    if (at.getZ() !== HOUSE_SPAWN.z) continue;
    const distance = Math.max(Math.abs(at.getX() - HOUSE_SPAWN.x), Math.abs(at.getY() - HOUSE_SPAWN.y));
    if (distance < bestDistance) {
      best = at;
      bestDistance = distance;
    }
  }
  return best ? { x: best.getX(), y: best.getY(), z: best.getZ() } : HOUSE_SPAWN;
}

/** A captured exit tile beside the house's south-west corner, a random open one first. */
function exitTile(corner = houseCorner()) {
  const start = Math.floor(Math.random() * EXIT_OFFSETS.length);
  const offsets = EXIT_OFFSETS.map((_, i) => EXIT_OFFSETS[(start + i) % EXIT_OFFSETS.length]);
  const tiles = offsets.map(([dx, dy]) => new core.Location(corner.x + dx, corner.y + dy, corner.z));
  return tiles.find((tile) => !core.RegionManager.blocked(tile, null)) ?? tiles[0];
}

/** The door inside: claimed from the door system, out beside the house two ticks after the click. */
function openDoor(request) {
  if (request.handled || request.objectId !== core.ObjectIdentifiers.DOOR_363) return;
  request.handled = true;
  const { player, object } = request;
  const door = object?.getLocation?.();
  if (door) player.setPositionToFace(door);
  after(player, EXIT_TICKS, () => {
    player.moveTo(exitTile());
    player.getPacketSender().sendSound(EXIT_SOUND, 1, 0);
    stopShake(player);
  });
}

function createInterior() {
  class BabaYagasHouseInterior extends core.Area {
    postLeave(mobile, logout) {
      if (!logout && mobile.isPlayer()) stopShake(mobile.getAsPlayer());
    }
  }
  return new BabaYagasHouseInterior([new core.Boundary(INTERIOR.minX, INTERIOR.maxX, INTERIOR.minY, INTERIOR.maxY, INTERIOR.z)]);
}

module.exports = {
  name: "BabaYagasHouse",
  description: "Baba Yaga's walking house on Lunar Isle: Go-inside, its camera shake, and the door back out beside wherever the house has walked.",
  members: true,
  _test: { goInside, openDoor, exitTile, houseCorner, stopShake, createInterior, INSIDE, SHAKING_ATTRIBUTE, HOUSE_SPAWN, EXIT_OFFSETS, ENTER_SOUND, EXIT_SOUND, SHAKE },
  register(pluginApi) {
    api = pluginApi;
    core = api.core;
    api.onNpcInteraction("House", { "Go-inside": goInside });
    api.onCustomEvent("door:toggle", openDoor);
    api.registerArea(createInterior());
  },
};
