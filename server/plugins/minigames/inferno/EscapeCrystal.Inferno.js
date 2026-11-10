"use strict";

/**
 * The escape crystal in the Inferno (Wiki: Escape crystal, "Where it works"): it ends the run as
 * leaving through the cave does, by TzHaar-Ket-Keh, with the failed run's TokKul. The shared
 * EscapeCrystal plugin decides when it fires and uses it up (`escape-crystal:escape`).
 */
const Run = require("./Run.Inferno");

function escape(request) {
  if (request.handled || !Run.sessionOf(request.player)) return;
  request.handled = true;
  Run.leave(request.player);
  request.escaped = true;
}

module.exports = function attach(api) {
  api.onCustomEvent("escape-crystal:escape", escape);
};

Object.assign(module.exports, { escape });
