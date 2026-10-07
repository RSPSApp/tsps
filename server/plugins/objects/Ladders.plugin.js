const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { RegionManager } = require("../../src/main/typescript/elvarg/game/collision/RegionManager");
const { MapObjects } = require("../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
const { ObjectDefinition } = require("../../src/main/typescript/elvarg/game/definition/ObjectDefinition");
const ClimbLinks = require("./ClimbLinks");

const CLIMB_UP = new Animation(828);
const CLIMB_DOWN = new Animation(827);
/**
 * Objects climbed with the generic handlers below, exact names as the cache spells them (from a
 * survey of every placed object with a climb option). Where the map has nothing at the other
 * end, a click still does nothing, as before.
 */
const CLIMBABLE_NAMES = [
  "Ladder", "ladder", "Staircase", "Stairs", "Steps", "Trapdoor", "Manhole", "Spiral staircase",
  "Vine ladder", "Ship's ladder", "Bamboo Ladder", "Metal ladder", "Iron ladder", "Rope ladder", "Stone ladder",
  "Stone Ladder", "Copper Ladder", "Tower ladder", "Boney ladder", "Kings' ladder", "Troll ladder", "Ladder top",
  "Rope", "Climbing rope", "Escape rope", "Anchor rope", "Rope anchor",
  "Stairs up", "Stairs down", "Wooden Stair", "Stone Staircase", "Crystal Staircase", "Crypt staircase",
  "Broken stairs", "Cellar stairs", "Stairwell",
];
/** Option spellings for each direction, as the cache has them. */
const UP_OPTIONS = ["Climb-up", "Climb up", "Climb Up", "Walk-up", "Walk-Up", "Ascend"];
const DOWN_OPTIONS = ["Climb-down", "Climb down", "Climb Down", "Walk-down", "Walk-Down", "Descend"];
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

/** Moves the player a cycle after the op (after `animation`, when there is one). */
function climb({ player, destination }, animation) {
  const movement = player.getMovementQueue();
  if (movement.isMovementBlocked()) return false;
  const start = player.getLocation().clone();
  const target = destination.clone();
  const privateArea = player.getPrivateArea();
  let animated = false;
  movement.setBlockMovement(true).reset();
  TaskManager.submit(new (class extends Task {
    // An op that moves the player waits a cycle after arriving; the climb itself
    // changes plane one cycle after starting the animation, before it finishes.
    constructor() { super(1, player, !movement.didMovePreviousCycle()); }
    execute() {
      if (player.getLocation().equals(start) && player.getHitpoints() > 0 && player.getPrivateArea() === privateArea) {
        if (animation && !animated) {
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
 * Without one, the map decides (ClimbLinks): the object at the other end and a tile it can be
 * used from. The last resort is the player's own tile one plane up/down, when an object of the
 * same name is right above/below. A climb never lands on the ladder's own (blocked) tile.
 */
function mapDestination(event, delta, toEnd = false) {
  if (!event.object) return null;
  const from = event.player.getLocation();
  return ClimbLinks.destination(event.object, delta > 0 ? ClimbLinks.UP : ClimbLinks.DOWN, from,
    event.player.getPrivateArea?.() ?? null, toEnd);
}

function resolveDestination(event, delta) {
  if (event.destination) return event.destination;
  const base = event.sourceLocation ?? event.location;
  if (!base) return null;
  const z = (base.z | 0) + delta;
  if (z < 0 || z > 3) return null;
  return new Location(base.x, base.y, z);
}

function climbUp(event, toEnd = false) {
  // Explicit destinations (ladders:climbUp custom event) are trusted; then the map's other end;
  // then the same object straight above.
  const mapped = event.destination ? null : mapDestination(event, 1, toEnd);
  if (mapped) return climb({ player: event.player, destination: mapped }, CLIMB_UP);
  const destination = resolveDestination(event, 1);
  if (!destination) return false;
  if (!event.destination && !hasObjectAbove(event.location, interactObjectName(event))) return false;
  return climb({ player: event.player, destination }, CLIMB_UP);
}

function climbDown(event, toEnd = false) {
  // Mirror of climbUp.
  const mapped = event.destination ? null : mapDestination(event, -1, toEnd);
  if (mapped) return climb({ player: event.player, destination: mapped }, CLIMB_DOWN);
  const destination = resolveDestination(event, -1);
  if (!destination) return false;
  if (!event.destination && !hasObjectBelow(event.location, interactObjectName(event))) return false;
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

/**
 * Content that owns a ladder or staircase (Castle Wars) claims the click before the
 * generic fallback below guesses a direction.
 */
function claimedElsewhere(event) {
  const request = { player: event.player, object: event.object, objectId: event.objectId, clickType: event.clickType, handled: false };
  pluginApi.emitCustomEvent("ladders:climb", request);
  return request.handled;
}

function climbOption(event) {
  return claimedElsewhere(event) || promptClimb(event);
}

function climbUpOption(event) {
  return claimedElsewhere(event) || climbUp(event);
}

function climbDownOption(event) {
  return claimedElsewhere(event) || climbDown(event);
}

/** Gangplank "Cross": between a dock and the ship's deck beside it, without a climb animation. */
function crossOption(event) {
  if (claimedElsewhere(event)) return true;
  const destination = ClimbLinks.crossDestination(event.object, event.player.getPrivateArea?.() ?? null);
  return destination ? climb({ player: event.player, destination }, null) : false;
}

/** Top-floor / Bottom-floor (Lumbridge castle's staircases): straight to the last floor. */
function topFloorOption(event) {
  return claimedElsewhere(event) || climbUp(event, true);
}

function bottomFloorOption(event) {
  return claimedElsewhere(event) || climbDown(event, true);
}

module.exports = {
  name: "Ladders",
  register(api) {
    pluginApi = api;
    TaskManager = api.getTaskManager();
    api.onCustomEvent("ladders:climbUp", climbUp);
    api.onCustomEvent("ladders:climbDown", climbDown);
    const options = { "Climb": climbOption, "Top-floor": topFloorOption, "Bottom-floor": bottomFloorOption };
    for (const option of UP_OPTIONS) options[option] = climbUpOption;
    for (const option of DOWN_OPTIONS) options[option] = climbDownOption;
    for (const name of CLIMBABLE_NAMES) api.onObjectInteraction(name, options);
    api.onObjectInteraction("Gangplank", { Cross: crossOption });
  },
};
