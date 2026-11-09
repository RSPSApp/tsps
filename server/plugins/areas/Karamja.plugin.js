/**
 * Karamja area interactions: the way down through the Karamja volcano to the TzHaar city.
 *
 * - Rocks at 2856,3168 > Climb-down: into the volcano dungeon, below the side the player stands
 *   on (rsprox captures: from 2855,3168 to 2855,9568 and from 2858,3168 to 2858,9568, on the
 *   tick, with no animation).
 * - Cave entrance at 2863,9571 > Enter: the TzHaar city at 2480,5175 (the tile the city's exit
 *   is used from in the captures; the entrance itself has none).
 * - Climbing rope at 2856,9569 > Climb: back up beside the rocks, on the side the player
 *   climbs from (no capture; it mirrors the way down). It only goes up, so Ladders isn't left
 *   to ask which way.
 */
const VOLCANO_ROCKS = { x: 2856, y: 3168, z: 0 };
/** The rocks cover x 2856-2857; each side has its own spot below. */
const ROCKS_WEST_X = 2855;
const ROCKS_EAST_X = 2858;
const DUNGEON_LANDING_Y = 9568;
const SURFACE_Y = 3168;
const CAVE_ENTRANCE = { x: 2863, y: 9571, z: 0 };
const TZHAAR_CITY_ENTRANCE = [2480, 5175, 0];
const CLIMBING_ROPE = { x: 2856, y: 9569, z: 0 };

let core;
let pluginApi;

function isAt(location, position) {
  return location.x === position.x && location.y === position.y && (location.z ?? 0) === position.z;
}

const sideX = (player) => (player.getLocation().getX() <= VOLCANO_ROCKS.x ? ROCKS_WEST_X : ROCKS_EAST_X);

function climbDownRocks(event) {
  const { player, location } = event;
  if (!isAt(location, VOLCANO_ROCKS)) return false;
  player.moveTo(new core.Location(sideX(player), DUNGEON_LANDING_Y, 0));
  event.handled = true;
}

function enterTzhaarCity(event) {
  const { player, location } = event;
  if (!isAt(location, CAVE_ENTRANCE)) return false;
  player.moveTo(new core.Location(...TZHAAR_CITY_ENTRANCE));
  event.handled = true;
}

/** Ladders' "does anyone own this?" for the rope: it climbs up, beside the rocks. */
function claimClimbingRope(request) {
  const location = request.object?.getLocation?.();
  if (request.handled || !location || !isAt({ x: location.getX(), y: location.getY(), z: location.getZ() }, CLIMBING_ROPE)) return;
  request.handled = true;
  pluginApi.emitCustomEvent("ladders:climbUp", {
    player: request.player,
    destination: new core.Location(sideX(request.player), SURFACE_Y, 0),
  });
}

module.exports = {
  name: "Karamja",
  description: "Karamja volcano access: the rocks, cave entrance and climbing rope between the surface and the TzHaar city.",
  register(api) {
    core = api.core;
    pluginApi = api;
    api.onObjectInteraction("Rocks", { "Climb-down": climbDownRocks });
    api.onObjectInteraction("Cave entrance", { Enter: enterTzhaarCity });
    api.onCustomEvent("ladders:climb", claimClimbingRope);
  },
};
