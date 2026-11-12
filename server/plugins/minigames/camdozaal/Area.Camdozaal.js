"use strict";

const S = require("./Shared.Camdozaal");
const previousBoost = new WeakMap();
const WARNINGS = [
  [500, "You have less than 5 mins of Boosted buff left in Camdozaal."],
  [200, "You have less than 2 mins of Boosted buff left in Camdozaal."],
  [100, "You have less than 1 min of Boosted buff left in Camdozaal."],
  [0, "Your Camdozaal Boosted buff has run out."],
];
function processBoost(player) {
  const remaining = S.boostTicks(player);
  const previous = previousBoost.get(player) ?? remaining;
  for (const [threshold, message] of WARNINGS) {
    if (previous > threshold && remaining <= threshold) player.sendMessage(message);
  }
  previousBoost.set(player, remaining);
  if (Math.ceil(previous / 100) !== Math.ceil(remaining / 100)) S.sync(player);
}
function createArea() {
  const { Area, Boundary } = S.core();
  class Camdozaal extends Area {
    process(mobile) {
      if (mobile.isPlayer()) processBoost(mobile.getAsPlayer());
    }
    postEnter(mobile) {
      if (!mobile.isPlayer()) return;
      const player = mobile.getAsPlayer();
      previousBoost.set(player, S.boostTicks(player));
      S.sync(player);
    }
    postLeave(mobile) {
      if (mobile.isPlayer()) previousBoost.delete(mobile.getAsPlayer());
    }
  }
  return new Camdozaal([new Boundary(2897, 3047, 5757, 5869, 0)]);
}
// The pre-existing members golem Area owns this same public rectangle first.
// It publishes its lifecycle; the standalone Area above remains the F2P fallback.
function processExistingArea({ player }) { processBoost(player); }
function enterExistingArea({ player }) { previousBoost.set(player, S.boostTicks(player)); S.sync(player); }
function leaveExistingArea({ player }) { previousBoost.delete(player); }
function startup() { S.pluginApi().registerArea(createArea()); }
module.exports = function attach(api) {
  api.onCustomEvent("camdozaal:area-process", processExistingArea);
  api.onCustomEvent("camdozaal:area-enter", enterExistingArea);
  api.onCustomEvent("camdozaal:area-leave", leaveExistingArea);
  api.onServerStartup(startup);
};
