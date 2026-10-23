"use strict";

const Rolls = require("./Rolls.RewardCaskets");

/** Mutable response: { player, tier, rolls, drops:null, handled:false, error:null }. */
function rollCasket(request) {
  if (!request || request.handled) return;
  try {
    request.drops = Rolls.roll(request.tier, request.rolls);
    request.handled = true;
  } catch (error) {
    request.error = error;
  }
}

module.exports = {
  name: "RewardCaskets",
  members: true,
  register(api) {
    api.onCustomEvent("treasure-trails:roll-casket", rollCasket);
  },
};
