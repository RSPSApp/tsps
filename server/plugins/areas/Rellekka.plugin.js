/**
 * Rellekka area interactions.
 *
 * Tunnel at 2731,3712 > Enter: into Keldagrim's entrance cave at 2773,10162 (tile from
 * Offline_Scape, RSPS; loc 5008). The way back out is in Keldagrim.plugin.js.
 */
const TUNNELS = new Map([
  ["2731,3712", [2773, 10162]],
]);

let core;

function enterTunnel(event) {
  const { player, location } = event;
  const destination = (location.z ?? 0) === 0 && TUNNELS.get(`${location.x},${location.y}`);
  if (!destination) return false;
  player.moveTo(new core.Location(destination[0], destination[1], 0));
  event.handled = true;
}

module.exports = {
  name: "Rellekka",
  members: true,
  _test: { enterTunnel },
  register(api) {
    core = api.core;
    api.onObjectInteraction("Tunnel", { Enter: enterTunnel });
  },
};
