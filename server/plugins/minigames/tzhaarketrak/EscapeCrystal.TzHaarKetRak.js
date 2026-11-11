"use strict";

/**
 * The escape crystal in TzHaar-Ket-Rak's Challenges (Wiki: Escape crystal, "Where it works"): it
 * ends the challenge as leaving by the cave does, out by TzHaar-Ket-Rak, with what the kills earned.
 * The shared EscapeCrystal plugin decides when it fires and uses it up (`escape-crystal:escape`).
 */
const Challenge = require("./Challenge.TzHaarKetRak");

function escape(request) {
  if (request.handled || !Challenge.challengeOf(request.player)) return;
  request.handled = true;
  Challenge.fail(request.player);
  request.escaped = true;
}

function attach(api) {
  api.onCustomEvent("escape-crystal:escape", escape);
}

module.exports = { attach, escape };
