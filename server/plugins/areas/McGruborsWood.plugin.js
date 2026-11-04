"use strict";

// Gate ids 52/53 are reused elsewhere, so scope the lock to McGrubor's cache tiles.
const MAIN_GATE_TILES = new Set(["2649,3470,0", "2650,3470,0"]);
const REFUSAL_VARIANT = "standard-dialogue-when-attempting-to-enter-mcgrubor-s-wood";
const ENTRANCE_Y = 3470;

let api;
let core;

/**
 * McGrubor's Wood is entered through the loose railing or fairy ring; its main gate stays locked.
 * https://oldschool.runescape.wiki/w/McGrubor%27s_Wood
 */
function guardMainGate(request) {
  if (request.handled || !request.player || !request.object) return;
  if (request.objectId !== core.ObjectIdentifiers.GATE_8 &&
      request.objectId !== core.ObjectIdentifiers.GATE_9) return;

  const location = request.object.getLocation();
  const x = location.getX();
  const y = location.getY();
  const z = location.getZ();
  if (!MAIN_GATE_TILES.has(`${x},${y},${z}`)) return;

  request.handled = true;
  if (request.player.getLocation().getY() < ENTRANCE_Y) {
    api.emitCustomEvent("npc-dialogue:start", {
      player: request.player,
      npcId: core.NpcIdentifiers.FORESTER_2,
      variant: REFUSAL_VARIANT,
      handled: false,
    });
  }
}

module.exports = {
  name: "McGruborsWood",
  _test: { guardMainGate },
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.onCustomEvent("door:toggle", guardMainGate);
  },
};
