"use strict";

/**
 * The Gauntlet's Combat Achievements (plugins/combatachievements/): completions count for the
 * Crystalline or Corrupted Hunllef, and a completed run decides its tasks from its time, what was
 * made in it, the armour worn at the end and how the Hunllef fight went (GauntletHunllef).
 * The completion counts and best times are the run stats the Gauntlet already keeps.
 */

const Shared = require("./GauntletShared");
const Run = require("./GauntletRun");
const { armourTier } = require("./GauntletHunllef");

const PERFECTED_ARMOUR_TIER = 3;
const MONSTER = { regular: "Crystalline Hunllef", corrupted: "Corrupted Hunllef" };
/** Per mode: the task names and the speed tasks' limits, in seconds (Wiki). */
const TASKS = {
  regular: {
    noOffPrayer: "3, 2, 1 - Range", perfect: "Perfect Crystalline Hunllef", noArmour: "Defence Doesn't Matter",
    noEgniol: "Egniol Diet", perfectedArmour: "Crystalline Warrior", oneAttuned: "Wolf Puncher",
    speed: [["Gauntlet Speed-Chaser", 4 * 60 + 45], ["Gauntlet Speed-Runner", 3 * 60 + 45]],
  },
  corrupted: {
    noOffPrayer: "3, 2, 1 - Mage", perfect: "Perfect Corrupted Hunllef", noArmour: "Defence Doesn't Matter II",
    noEgniol: "Egniol Diet II", perfectedArmour: "Corrupted Warrior", oneAttuned: "Wolf Puncher II",
    speed: [["Corrupted Gauntlet Speed-Chaser", 7 * 60 + 5], ["Corrupted Gauntlet Speed-Runner", 6 * 60 + 5]],
  },
};

function completed({ run, player, reason }) {
  if (reason !== "completed" || !run || !player) return;
  const api = Shared.api();
  const complete = (task) => api.emitCustomEvent("combat-achievements:complete", { player, task });
  const tasks = TASKS[run.mode];
  api.emitCustomEvent("combat-achievements:kill", { player, monster: MONSTER[run.mode], count: Run.statsOf(player).completions[run.mode] });
  const seconds = (Shared.core().World.getProcessCycle() - run.startCycle) * 0.6;
  for (const [task, limit] of tasks.speed) if (seconds < limit) complete(task);
  const fight = run.hunllef;
  if (fight) {
    if (fight.taken.offPrayer === 0) complete(tasks.noOffPrayer);
    if (fight.taken.offPrayer === 0 && fight.taken.avoidable === 0 && fight.wrongStyleHits === 0) complete(tasks.perfect);
  }
  if (run.made.armour === 0) complete(tasks.noArmour);
  if (run.made.egniol === 0) complete(tasks.noEgniol);
  if (run.made.attunedWeapons <= 1) complete(tasks.oneAttuned);
  if (armourTier(player, run.mode) === PERFECTED_ARMOUR_TIER) complete(tasks.perfectedArmour);
}

function answerKillCount({ player, counts }) {
  const { completions } = Run.statsOf(player);
  for (const [mode, monster] of Object.entries(MONSTER)) if (completions[mode] > 0) counts[monster] = completions[mode];
}

function answerPersonalBest(request) {
  const mode = Object.keys(MONSTER).find((key) => MONSTER[key] === request.monster);
  const best = mode ? Run.statsOf(request.player).bestTicks[mode] : -1;
  if (best > 0) request.best = best;
}

module.exports = function registerGauntletCombatAchievements(api) {
  api.onCustomEvent("gauntlet:end", completed);
  api.onCustomEvent("combat-achievements:kill-count", answerKillCount);
  api.onCustomEvent("combat-achievements:personal-best", answerPersonalBest);
};
module.exports.completed = completed;
