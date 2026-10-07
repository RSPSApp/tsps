/**
 * Misthalin area interactions: Edgeville, Varrock and the Wizards' Tower.
 *
 * Edgeville
 *  - Ladder at 3097,9867 (dungeon) > Climb-up: surface at 3096,3468.
 *  - Trapdoor at 3097,3468 > Open: dungeon at 3096,9867.
 *  - Lever at 3090,3475 > Pull: warn, then teleport to deep Wilderness (3153,3923).
 *
 * Varrock
 *  - Manhole at 3237,3458 > Open/Close: swap the closed (881) and open (882) locs.
 *  - Manhole > Climb-down: sewer landing at 3237,9858; the sewer Ladder > Climb-up
 *    returns to the manhole.
 *
 * Wizards' Tower basement (a y+6400 dungeon, so the generic Ladders plugin can't
 * link it): the ground-floor Ladder at 3104,3162 climbs down to the basement
 * landing at 3104,9576, and the basement Ladder at 3103,9576 climbs back up in
 * front of the ground-floor ladder at 3105,3162.
 */
let pluginApi;
let Location, Animation, GameObject, CacheDefinitions, ObjectManager, Objects;
let climbDownAnimation;

// Edgeville
const EDGEVILLE_DUNGEON_LADDER = { x: 3097, y: 9867, z: 0 };
const EDGEVILLE_SURFACE = { x: 3096, y: 3468, z: 0 };
const EDGEVILLE_TRAPDOOR = { x: 3097, y: 3468, z: 0 };
const EDGEVILLE_DUNGEON_LANDING = { x: 3096, y: 9867, z: 0 };
const EDGEVILLE_LEVER = { x: 3090, y: 3475, z: 0 };
const DEEP_WILDERNESS = { x: 3153, y: 3923, z: 0 };

// Varrock
const VARROCK_MANHOLE = { x: 3237, y: 3458, z: 0 };
const VARROCK_SEWER_LADDER = { x: 3237, y: 9858, z: 0 };

// Wizards' Tower basement
const TOWER_LADDER = { x: 3104, y: 3162, z: 0 };
const TOWER_BASEMENT_LADDER = { x: 3103, y: 9576, z: 0 };
const TOWER_BASEMENT_LANDING = { x: 3104, y: 9576, z: 0 };
const TOWER_SURFACE_LANDING = { x: 3105, y: 3162, z: 0 };

function initialize(api) {
  pluginApi = api;
  ({ Location, Animation, GameObject, CacheDefinitions, ObjectManager, ObjectIdentifiers: Objects } = api.core);
  climbDownAnimation = new Animation(827);
}

function isAt(location, position) {
  return location.x === position.x && location.y === position.y && (location.z ?? 0) === position.z;
}

const toLocation = (position) => new Location(position.x, position.y, position.z ?? 0);

// Edgeville: dungeon ladder back up to the surface.
function edgevilleLadderUp(event) {
  const { player, location } = event;
  if (!isAt(location, EDGEVILLE_DUNGEON_LADDER)) return false;
  pluginApi.emitCustomEvent("ladders:climbUp", { player, destination: toLocation(EDGEVILLE_SURFACE) });
  event.handled = true;
}

// Edgeville: trapdoor down into the dungeon.
function edgevilleTrapdoorOpen(event) {
  const { player, location } = event;
  if (!isAt(location, EDGEVILLE_TRAPDOOR)) return false;
  pluginApi.emitCustomEvent("ladders:climbDown", { player, destination: toLocation(EDGEVILLE_DUNGEON_LANDING) });
  event.handled = true;
}

// Edgeville: lever to the deep Wilderness, after the warning prompt.
function edgevilleLeverPull(event) {
  const { player, location } = event;
  if (!isAt(location, EDGEVILLE_LEVER)) return false;
  const start = player.getLocation().clone();
  pluginApi.sendMultiChatboxPrompt(
    player,
    "Warning: deep Wilderness! Players can attack you.",
    "Yes, teleport me into deep Wilderness.",
    () => {
      if (player.getLocation().equals(start)) {
        pluginApi.emitCustomEvent("lever:teleport", { player, destination: toLocation(DEEP_WILDERNESS) });
      }
    },
    "No, stay here.",
    () => {},
  );
  event.handled = true;
}

function hasClimbDown(definition) {
  return Array.isArray(definition?.actions) && definition.actions.includes("Climb-down");
}

/** The loc shown while the manhole is open, or null if it has no open state. */
function resolveManholeOpenId(objectId) {
  const definition = CacheDefinitions.getObject(objectId);
  if (!definition) return null;

  // Transform list: the last entry is the revealed (open) variant.
  if (Array.isArray(definition.transforms) && definition.transforms.length > 0) {
    const openId = definition.transforms[definition.transforms.length - 1];
    if (Number.isInteger(openId) && openId >= 0 && openId !== objectId) return openId;
  }

  // Otherwise the open state is the paired same-named loc (881 -> 882).
  const paired = CacheDefinitions.getObject(objectId + 1);
  if (paired && paired.name === definition.name && hasClimbDown(paired)) return objectId + 1;
  return null;
}

/** Swap the loc on a tile, despawning before spawning so the shared tile is not wiped. */
function replaceObject(object, newId, player) {
  const position = object.getLocation?.() ?? toLocation({ x: 0, y: 0, z: 0 });
  const privateArea = player.getPrivateArea?.() ?? null;
  const replacement = new GameObject(newId, position, object.getType(), object.getFace(), privateArea);
  ObjectManager.deregister(object, true);
  ObjectManager.register(replacement, true);
}

// Varrock: reveal the open manhole and play the climb-down animation.
function varrockManholeOpen(event) {
  const { player, object, objectId } = event;
  const openId = resolveManholeOpenId(objectId);
  if (openId === null || openId === objectId) return false;
  replaceObject(object, openId, player);
  player.performAnimation(climbDownAnimation);
  event.handled = true;
}

// Varrock: put the closed manhole back.
function varrockManholeClose(event) {
  const { player, object, objectId, location } = event;
  if (objectId !== Objects.MANHOLE_2 || !isAt(location, VARROCK_MANHOLE)) return false;
  replaceObject(object, Objects.MANHOLE, player);
  event.handled = true;
}

// Varrock: descend through the manhole into the sewer.
function varrockClimbDownManhole(event) {
  const { player, location } = event;
  if (!isAt(location, VARROCK_MANHOLE)) return false;
  pluginApi.emitCustomEvent("ladders:climbDown", { player, destination: toLocation(VARROCK_SEWER_LADDER) });
  event.handled = true;
}

// Varrock: sewer ladder back up to the manhole.
function varrockClimbUpToManhole(event) {
  const { player, location } = event;
  if (!isAt(location, VARROCK_SEWER_LADDER)) return false;
  pluginApi.emitCustomEvent("ladders:climbUp", { player, destination: toLocation(VARROCK_MANHOLE) });
  event.handled = true;
}

// Wizards tower basement
function wizardsTowerClimbDown(event) {
  const { player, objectId, location } = event;
  if (objectId !== Objects.LADDER_10 || !isAt(location, TOWER_LADDER)) return false;
  pluginApi.emitCustomEvent("ladders:climbDown", { player, destination: toLocation(TOWER_BASEMENT_LANDING) });
  event.handled = true;
}

// Wizards tower basement
function wizardsTowerClimbUp(event) {
  const { player, objectId, location } = event;
  if (objectId !== Objects.LADDER_11 || !isAt(location, TOWER_BASEMENT_LADDER)) return false;
  pluginApi.emitCustomEvent("ladders:climbUp", { player, destination: toLocation(TOWER_SURFACE_LANDING) });
  event.handled = true;
}

module.exports = {
  name: "Misthalin",
  register(api) {
    initialize(api);
    // Edgeville
    api.onObjectInteraction("Ladder", { "Climb-up": edgevilleLadderUp });
    api.onObjectInteraction("Trapdoor", { Open: edgevilleTrapdoorOpen });
    api.onObjectInteraction("Lever", { Pull: edgevilleLeverPull });
    // Varrock
    api.onObjectInteraction("Manhole", {
      Open: varrockManholeOpen,
      Close: varrockManholeClose,
      "Climb-down": varrockClimbDownManhole,
    });
    api.onObjectInteraction("Ladder", { "Climb-up": varrockClimbUpToManhole });
    // Wizards tower basement
    api.onObjectInteraction("Ladder", {
      "Climb-down": wizardsTowerClimbDown,
      "Climb-up": wizardsTowerClimbUp,
    });
  },
};
