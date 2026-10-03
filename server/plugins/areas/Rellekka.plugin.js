/**
 * Rellekka area interactions.
 *
 * Tunnel at 2731,3712 > Enter: into Keldagrim's entrance cave at 2773,10162 (tile from
 * Offline_Scape, RSPS; loc 5008). The way back out is in Keldagrim.plugin.js.
 */
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");

const TUNNELS = new Map([
  ["2731,3712", new Location(2773, 10162, 0)],
]);

function enterTunnel(event) {
  const { player, location } = event;
  const destination = (location.z ?? 0) === 0 && TUNNELS.get(`${location.x},${location.y}`);
  if (!destination) return false;
  player.moveTo(destination.clone());
  event.handled = true;
}

module.exports = {
  name: "Rellekka",
  members: true,
  register(api) {
    api.onObjectInteraction("Tunnel", { Enter: enterTunnel });
  },
};
