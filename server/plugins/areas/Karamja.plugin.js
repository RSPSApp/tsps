/**
 * Karamja area interactions.
 *
 * Rocks at 2856,3168 > Climb-down: descend into the TzHaar city at 2480,5175.
 */
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");

const TZHAAR_ROCKS_POSITION = new Location(2856, 3168, 0);
const TZHAAR_CITY_ENTRANCE = new Location(2480, 5175, 0);

let pluginApi;

function isAt(location, position) {
  return location.x === position.x && location.y === position.y && (location.z ?? 0) === position.z;
}

function climbDownToTzhaar(event) {
  const { player, location } = event;
  if (!isAt(location, TZHAAR_ROCKS_POSITION)) return false;
  pluginApi.emitCustomEvent("ladders:climbDown", {
    player,
    destination: TZHAAR_CITY_ENTRANCE.clone(),
  });
  event.handled = true;
}

module.exports = {
  name: "Karamja",
  register(api) {
    pluginApi = api;
    api.onObjectInteraction("Rocks", { "Climb-down": climbDownToTzhaar });
  },
};
