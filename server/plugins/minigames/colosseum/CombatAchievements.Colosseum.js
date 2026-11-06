"use strict";

/**
 * The Fortis Colosseum's Combat Achievements (plugins/achievements/combatachievements/) that the run decides:
 * Sol Heredit's defeats (his own kill count), the run's total time (its waves added up), the
 * modifiers he was beaten with, and wave 11 cleared with a modifier the task names.
 */

const Shared = require("./Shared.Colosseum");
const Sol = require("./SolHeredit.Colosseum");

const SPEED = [["Colosseum Speed-Chaser", 28 * 60], ["Colosseum Speed-Runner", 24 * 60]];
const ONE_OFF_WAVE = 11;
const SECOND_TIER = 2;
const SOL_WEAPON = /spear|hasta|halberd/i;

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
  const achievements = run.solFight?.achievements;
  if (achievements?.onlyAllowedWeapons) complete(player, "I Brought Mine Too");
  if (achievements && !achievements.ran) complete(player, "Slow Dancing in the Sand");
  if (achievements?.perfectFootwork) complete(player, "Perfect Footwork");
  for (const [task, limit] of SPEED) if (run.totalTicks * 0.6 <= limit) complete(player, task);
  if (modifiers.tierOf("bees") >= SECOND_TIER && modifiers.has("quartet") && modifiers.tierOf("solarflare") >= SECOND_TIER) {
    complete(player, "Reinforcements");
  }
}

function solAttack({ player, target }) {
  const run = target?.__colosseumRun;
  const achievements = run?.solFight?.achievements;
  if (run?.solFight?.npc !== target || player !== run.player || !achievements?.onlyAllowedWeapons) return;
  const { Equipment, ItemDefinition } = Shared.core();
  const weapon = player.getEquipment?.().getItems?.()[Equipment.WEAPON_SLOT];
  const id = weapon?.getId?.() ?? -1;
  const name = id > 0 ? ItemDefinition.forId(id)?.getName?.() ?? "" : "";
  if (!SOL_WEAPON.test(name)) achievements.onlyAllowedWeapons = false;
}

function solTick(run) {
  const achievements = run.solFight?.achievements;
  if (!achievements?.ran && run.solFight && run.player.getMovementQueue?.().didRunThisCycle?.()) {
    achievements.ran = true;
  }
}

function answerKillCount({ player, counts }) {
  if (kills(player) > 0) counts["Fortis Colosseum"] = kills(player);
}

module.exports = function registerColosseumCombatAchievements(api) {
  api.onPlayerDealtDamage(solAttack);
  api.onCustomEvent("combat-achievements:kill-count", answerKillCount);
};
Object.assign(module.exports, { waveCompleted, solDefeated, solAttack, solTick });
