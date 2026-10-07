/**
 * Mor Ul Rek (TzHaar city) area interactions.
 *
 * Cave exit at 2479,5176 > Enter: return to Karamja, on the tile east of the Rocks (2856,3168).
 */
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");

const CAVE_EXIT_POSITION = new Location(2479, 5176, 0);
const KARAMJA_ROCKS_EAST = new Location(2857, 3168, 0);

function isAt(location, position) {
  return location.x === position.x && location.y === position.y && (location.z ?? 0) === position.z;
}

function exitToKaramja(event) {
  const { player, location } = event;
  if (!isAt(location, CAVE_EXIT_POSITION)) return false;
  player.moveTo(KARAMJA_ROCKS_EAST.clone());
  event.handled = true;
}

module.exports = {
  name: "MorUiRek",
  members: true,
  register(api) {
    api.onObjectInteraction("Cave exit", { Enter: exitToKaramja });
  },
};
