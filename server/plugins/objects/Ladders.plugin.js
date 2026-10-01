const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { RegionManager } = require("../../src/main/typescript/elvarg/game/collision/RegionManager");
const { MapObjects } = require("../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
const { ObjectDefinition } = require("../../src/main/typescript/elvarg/game/definition/ObjectDefinition");

const CLIMB_UP = new Animation(828);
const CLIMB_DOWN = new Animation(827);
let pluginApi;
let TaskManager;

/**
 * True when an object named `name` sits on the plane `delta` away (within the
 * 3x3 tiles around `location`). A ladder/staircase only climbs if the matching
 * object exists on the destination floor; dungeons have no upper floor, and the
 * old fallback teleported the player a level up into thin air. Area plugins wire
 * those one-way shafts explicitly through the ladders:climbUp custom event.
 */
function hasObjectOnFloor(location, name, delta) {
  if (!location || !name) return false;
  const z = (location.z ?? 0) + delta;
  if (z < 0 || z > 3) return false;
  RegionManager.loadMapFiles(location.x, location.y);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const hash = MapObjects.getHash(location.x + dx, location.y + dy, z);
      const objects = MapObjects.mapObjects.get(hash) ?? [];
      if (objects.some((object) => ObjectDefinition.forId(object.getId())?.getName() === name)) {
        return true;
      }
    }
  }
  return false;
}

function hasObjectAbove(location, name) {
  return hasObjectOnFloor(location, name, 1);
}

function hasObjectBelow(location, name) {
  return hasObjectOnFloor(location, name, -1);
}

/** Name of the interacted object, so a climb requires the same object on the
 * destination floor (Ladder above/below a Ladder, Staircase above/below one). */
function interactObjectName(event) {
  return event.definition?.getName?.()
    ?? event.object?.getDefinition?.()?.getName?.()
    ?? null;
}

function climb({ player, destination }, animation) {
  const movement = player.getMovementQueue();
  if (movement.isMovementBlocked()) return false;
  const start = player.getLocation().clone();
  const target = destination.clone();
  const privateArea = player.getPrivateArea();
  let animated = false;
  movement.setBlockMovement(true).reset();
  TaskManager.submit(new (class extends Task {
    // OpenRune's arriveDelay waits a cycle after movement; the climb itself
    // changes plane one cycle after starting the animation, before it finishes.
    constructor() { super(1, player, !movement.didMovePreviousCycle()); }
    execute() {
      if (player.getLocation().equals(start) && player.getHitpoints() > 0 && player.getPrivateArea() === privateArea) {
        if (!animated) {
          player.performAnimation(animation);
          animated = true;
          return;
        }
        player.moveTo(target);
      }
      this.stop();
    }
    stop() {
      movement.setBlockMovement(false);
      super.stop();
    }
  })());
}

/**
 * Callers may pass an explicit `destination` (ladders:climbUp custom event), or
 * an object interaction event carrying the ladder's `location` and the tile the
 * player operated from (`sourceLocation`).
 *
 * A climb must land on the tile in front of the ladder, never on the ladder's
 * own (blocked) tile - otherwise the player stands inside a clipped tile and the
 * client lets them walk onto the ladder. So the generic fallback is the player's
 * source tile one plane up/down. Edgeville registers its own "Ladder" handler
 * first for its fixed link.
 */
function resolveDestination(event, delta) {
  if (event.destination) return event.destination;
  const base = event.sourceLocation ?? event.location;
  if (!base) return null;
  const z = (base.z | 0) + delta;
  if (z < 0 || z > 3) return null;
  return new Location(base.x, base.y, z);
}

function climbUp(event) {
  const destination = resolveDestination(event, 1);
  if (!destination) return false;
  // Explicit destinations (ladders:climbUp custom event) are trusted; the generic
  // interaction only climbs when the same object exists on the floor above.
  if (!event.destination) {
    const name = interactObjectName(event);
    if (!hasObjectAbove(event.location, name)) {
      return false;
    }
  }
  return climb({ player: event.player, destination }, CLIMB_UP);
}

function climbDown(event) {
  const destination = resolveDestination(event, -1);
  if (!destination) return false;
  // Mirror of climbUp: only descend when the same object exists below.
  if (!event.destination) {
    const name = interactObjectName(event);
    if (!hasObjectBelow(event.location, name)) {
      return false;
    }
  }
  return climb({ player: event.player, destination }, CLIMB_DOWN);
}

/**
 * Ambiguous "Climb" option (the mill's first-floor ladder offers it as the
 * left-click). Ask which way instead of guessing, then hand off to the normal
 * named handlers; the up/down options only fire if the player hasn't moved.
 */
function promptClimb(event) {
  const { player } = event;
  const start = player.getLocation().clone();
  const sourceLocation = { x: start.getX(), y: start.getY(), z: start.getZ() };
  return pluginApi.sendMultiChatboxPrompt(
    player,
    "Which way would you like to climb?",
    "Climb up",
    () => {
      if (player.getLocation().equals(start)) climbUp({ ...event, destination: undefined, sourceLocation });
    },
    "Climb down",
    () => {
      if (player.getLocation().equals(start)) climbDown({ ...event, destination: undefined, sourceLocation });
    }
  );
}

module.exports = {
  name: "Ladders",
  register(api) {
    pluginApi = api;
    TaskManager = api.getTaskManager();
    api.onCustomEvent("ladders:climbUp", climbUp);
    api.onCustomEvent("ladders:climbDown", climbDown);
    api.onObjectInteraction("Ladder", { "Climb": promptClimb, "Climb-up": climbUp, "Climb-down": climbDown });
    api.onObjectInteraction("Staircase", { "Climb": promptClimb, "Climb-up": climbUp, "Climb-down": climbDown });
  },
};
