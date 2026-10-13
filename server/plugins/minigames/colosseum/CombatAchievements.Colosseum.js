"use strict";

/**
 * The Fortis Colosseum's Combat Achievements (plugins/combatachievements/) that the run decides:
 * Sol Heredit's defeats (his own kill count), the run's total time (its waves added up), the
 * modifiers he was beaten with, and wave 11 cleared with a modifier the task names.
 */

const Shared = require("./ColosseumShared");
const Sol = require("./SolHeredit.Colosseum");

const SPEED = [["Colosseum Speed-Chaser", 28 * 60], ["Colosseum Speed-Runner", 24 * 60]];
const ONE_OFF_WAVE = 11;
const SECOND_TIER = 2;

const complete = (player, task) => Shared.api().emitCustomEvent("combat-achievements:complete", { player, task });
const kills = (player) => Number(player.getAttribute(Sol.ATTR.KILLS)) || 0;

/** A wave cleared; `wave` is the one just completed. */
function waveCompleted(run, wave) {
  const { modifiers } = run;
  if (wave === ONE_OFF_WAVE && (modifiers.has("red-flag") || modifiers.has("dynamic-duo") || modifiers.tierOf("doom") >= SECOND_TIER)) {
    complete(run.player, "One-off");
  }
}

function solDefeated(run) {
  const { player, modifiers } = run;
  Shared.api().emitCustomEvent("combat-achievements:kill", { player, monster: "Fortis Colosseum", count: kills(player) });
  for (const [task, limit] of SPEED) if (run.totalTicks * 0.6 <= limit) complete(player, task);
  if (modifiers.tierOf("bees") >= SECOND_TIER && modifiers.has("quartet") && modifiers.tierOf("solarflare") >= SECOND_TIER) {
    complete(player, "Reinforcements");
  }
}

function answerKillCount({ player, counts }) {
  if (kills(player) > 0) counts["Fortis Colosseum"] = kills(player);
}

module.exports = function registerColosseumCombatAchievements(api) {
  api.onCustomEvent("combat-achievements:kill-count", answerKillCount);
};
Object.assign(module.exports, { waveCompleted, solDefeated });
