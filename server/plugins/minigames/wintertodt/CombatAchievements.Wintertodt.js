"use strict";

/**
 * Wintertodt's Combat Achievements (plugins/combatachievements/): the subdued count, and the tasks
 * the round decides - by the points earned, the warm clothing worn and what happened to the
 * pyromancers and braziers - plus healing a fallen pyromancer and fixing a broken brazier.
 */

const Shared = require("./WintertodtShared");
const Corners = require("./WintertodtCorners");
const Warmth = require("./WintertodtWarmth");

const WHY_FLETCH_POINTS = 3000;
const COSY_WARM_ITEMS = 4;

const complete = (player, task) => Shared.api()?.emitCustomEvent("combat-achievements:complete", { player, task });

/** At the round's end, for a player rewarded with these points and this subdued count. */
function subdued(player, points, kills) {
  Shared.api()?.emitCustomEvent("combat-achievements:kill", { player, monster: "Wintertodt", count: kills });
  if (points >= WHY_FLETCH_POINTS) complete(player, "Why Fletch?");
  if (Warmth.warmItems(player) >= COSY_WARM_ITEMS) complete(player, "Cosy");
  if (!Corners.roundEvents.pyromancerFell) complete(player, "Leaving No One Behind");
  if (!Corners.roundEvents.allBrokenAtOnce) complete(player, "Can We Fix It?");
}

/** At login: the subdued count, so earlier rounds finish their kill-count tasks. */
function answerKillCount(request) {
  // Required here: the round requires this unit.
  const kills = Number(request.player.getAttribute(require("./WintertodtRound").ATTR_KILLS)) || 0;
  if (kills > 0) request.counts.Wintertodt = kills;
}

module.exports = function registerWintertodtCombatAchievements(api) {
  api.onCustomEvent("combat-achievements:kill-count", answerKillCount);
};
module.exports.subdued = subdued;
module.exports.healedFallenPyromancer = (player) => complete(player, "Mummy!");
module.exports.fixedBrokenBrazier = (player) => complete(player, "Handyman");
