"use strict";

/**
 * The escape crystal on a Hardcore world. Hardcore guides describe it as working anywhere and
 * clearing poison, venom and burn when it saves the player; the Wiki doesn't say either, so both
 * are UNVERIFIED (user's choice, 2026-11-09). Elsewhere it works where the Wiki says. The crystal
 * itself is the EscapeCrystal plugin's (`escape-crystal:anywhere`, `escape-crystal:escaped`).
 */
const Common = require("./Common.HardcoreWorld");

/** `escape-crystal:anywhere`: wherever a teleport is allowed, not only in the Wiki's activities. */
function anywhere(query) {
  if (Common.isHardcore(query.player)) query.allowed = true;
}

/** `escape-crystal:escaped`: the saved player is cleansed too. */
function escaped({ player }) {
  if (!Common.isHardcore(player)) return;
  player.setPoisonDamage?.(0);
  player.setVenomed?.(false);
  Common.api().emitCustomEvent("combat:clear-burn", { target: player });
}

module.exports = function attach(api) {
  api.onCustomEvent("escape-crystal:anywhere", anywhere);
  api.onCustomEvent("escape-crystal:escaped", escaped);
};

Object.assign(module.exports, { anywhere, escaped });
