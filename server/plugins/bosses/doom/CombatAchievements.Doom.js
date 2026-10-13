"use strict";

/**
 * The Doom of Mokhaiotl's Combat Achievements (plugins/combatachievements/) that a won delve
 * decides: how deep it was, delve 1's time and a run from delve 1 through 8's time. Its kill
 * count is the delves completed (total_dom_levels, varp 4807), the count DoomRecords keeps.
 */

const Shared = require("./DoomShared");
const Records = require("./DoomRecords");

const DEPTH = [["Doom Adept", 3], ["Doom Veteran", 8], ["It's Dark Down Here", 16]];
const FIRST_DELVE_SECONDS = 30;
const RUN_TO_EIGHT = [["Doom Chaser", 10 * 60], ["Doom Racer", 7 * 60 + 15]];

const totalDelves = (player) => Object.values(Records.personal(player).completions).reduce((sum, value) => sum + value, 0);

/** A delve won: `ticks` its own time; the run's time so far is run.runTicks. */
function defeated(run, ticks) {
  const { player, level } = run;
  const api = Shared.api();
  const complete = (task) => api.emitCustomEvent("combat-achievements:complete", { player, task });
  api.emitCustomEvent("combat-achievements:kill", { player, monster: "Doom of Mokhaiotl", count: totalDelves(player) });
  for (const [task, depth] of DEPTH) if (level >= depth) complete(task);
  if (level === 1 && ticks * 0.6 < FIRST_DELVE_SECONDS) complete("Doom Crawler");
  if (level === 8 && run.startedAt === 1) {
    for (const [task, limit] of RUN_TO_EIGHT) if (run.runTicks * 0.6 < limit) complete(task);
  }
}

function answerKillCount({ player, counts }) {
  const total = totalDelves(player);
  if (total > 0) counts["Doom of Mokhaiotl"] = total;
}

module.exports = function registerDoomCombatAchievements(api) {
  api.onCustomEvent("combat-achievements:kill-count", answerKillCount);
};
module.exports.defeated = defeated;
