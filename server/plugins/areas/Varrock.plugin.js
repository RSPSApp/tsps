/**
 * Varrock area interactions.
 *
 * Manhole (object 881 at 3237,3458) > Open: reveal the open manhole (882) and play
 * the ladder climb-down animation. > Close: put the closed manhole (881) back.
 * > Climb-down: descend into the sewer at 3237,9858.
 *
 * The dungeon Ladder at 3237,9858 > Climb-up returns the player to the manhole.
 *
 * The open loc is the object's resolved transformation when its definition has a
 * transform list, otherwise the paired same-named loc that offers "Climb-down"
 * (881 -> 882). Object 881 itself has no transform field, so it takes the
 * paired-loc path.
 */
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { GameObject } = require("../../src/main/typescript/elvarg/game/entity/impl/object/GameObject");
const { CacheDefinitions } = require("../../src/main/typescript/elvarg/game/cache/CacheDefinitions");
const {
  ObjectIdentifiers,
} = require("../../src/main/typescript/elvarg/util/ObjectIdentifiers");

const CLIMB_DOWN_ANIMATION = new Animation(827);

const MANHOLE_POSITION = new Location(3237, 3458, 0);
const SEWER_LADDER_POSITION = new Location(3237, 9858, 0);

let pluginApi;
let ObjectManager;

function hasClimbDown(definition) {
  return Array.isArray(definition?.actions) && definition.actions.includes("Climb-down");
}

function isAt(location, position) {
  return location.x === position.x && location.y === position.y && (location.z ?? 0) === position.z;
}

/** The loc shown while the object is open, or null if it has no open state. */
function resolveOpenId(objectId) {
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
  const position = object.getLocation?.() ?? new Location(0, 0, 0);
  const privateArea = player.getPrivateArea?.() ?? null;
  const replacement = new GameObject(newId, position, object.getType(), object.getFace(), privateArea);
  ObjectManager.deregister(object, true);
  ObjectManager.register(replacement, true);
}

function openManhole(event) {
  const { player, object, objectId } = event;
  const openId = resolveOpenId(objectId);
  if (openId === null || openId === objectId) return false;
  replaceObject(object, openId, player);
  player.performAnimation(CLIMB_DOWN_ANIMATION);
  event.handled = true;
}

function closeManhole(event) {
  const { player, object, objectId, location } = event;
  if (objectId !== ObjectIdentifiers.MANHOLE_2 || !isAt(location, MANHOLE_POSITION)) return false;
  replaceObject(object, ObjectIdentifiers.MANHOLE, player);
  event.handled = true;
}

function climbDownManhole(event) {
  const { player, location } = event;
  if (!isAt(location, MANHOLE_POSITION)) return false;
  pluginApi.emitCustomEvent("ladders:climbDown", {
    player,
    destination: SEWER_LADDER_POSITION.clone(),
  });
  event.handled = true;
}

function climbUpToManhole(event) {
  const { player, location } = event;
  if (!isAt(location, SEWER_LADDER_POSITION)) return false;
  pluginApi.emitCustomEvent("ladders:climbUp", {
    player,
    destination: MANHOLE_POSITION.clone(),
  });
  event.handled = true;
}

module.exports = {
  name: "Varrock",
  register(api) {
    pluginApi = api;
    ObjectManager = api.getObjectManager();
    api.onObjectInteraction("Manhole", {
      Open: openManhole,
      Close: closeManhole,
      "Climb-down": climbDownManhole,
    });
    api.onObjectInteraction("Ladder", { "Climb-up": climbUpToManhole });
  },
};
