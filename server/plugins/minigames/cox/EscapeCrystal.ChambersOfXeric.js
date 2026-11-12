"use strict";

/**
 * The escape crystal in the Chambers of Xeric (Wiki: Escape crystal, "Where it works"): it takes
 * the player out of the raid as the steps do, back to Mount Quidamortem. The shared EscapeCrystal
 * plugin decides when it fires and uses it up (`escape-crystal:escape`).
 */
const Raid = require("./RaidState.ChambersOfXeric");

function inside(player) {
  const raid = Raid.raidOf(player);
  return raid?.map?.contains?.(player.getLocation()) ? raid : null;
}

function escape(request) {
  const raid = request.handled ? null : inside(request.player);
  if (!raid) return;
  request.handled = true;
  raid.leave(request.player);
  request.escaped = true;
}

module.exports = function attach(api) {
  api.onCustomEvent("escape-crystal:escape", escape);
};

Object.assign(module.exports, { escape });
