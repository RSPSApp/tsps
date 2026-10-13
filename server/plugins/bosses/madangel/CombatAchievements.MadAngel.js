/**
 * The Mad Angel's Combat Achievements (plugins/combatachievements/): its kill count and best
 * fight time are the plugin's own (Kills.MadAngel). Its death counts through the NPC's name; the
 * fight rules are in plugins/combatachievements/tasks/.
 */
const Common = require("./Common.MadAngel");

const MONSTER = "Mad Angel, The";

function answerKillCount({ player, counts }) {
  const kills = Number(player.getAttribute(Common.KILLS_ATTRIBUTE)) || 0;
  if (kills > 0) counts[MONSTER] = kills;
}

function answerPersonalBest(request) {
  const best = Number(request.player.getAttribute(Common.BEST_TICKS_ATTRIBUTE)) || 0;
  if (request.monster === MONSTER && best > 0) request.best = best;
}

function resetBest(request) {
  if (request.monster !== MONSTER) return;
  request.player.setAttribute(Common.BEST_TICKS_ATTRIBUTE, 0);
  request.handled = true;
}

module.exports = function registerMadAngelCombatAchievements(api) {
  api.onCustomEvent("combat-achievements:kill-count", answerKillCount);
  api.onCustomEvent("combat-achievements:personal-best", answerPersonalBest);
  api.onCustomEvent("combat-achievements:reset-best", resetBest);
};
