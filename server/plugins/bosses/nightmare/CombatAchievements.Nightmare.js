/**
 * Kill counts and best times for Combat Achievements: kills are announced as they happen
 * (Fight.Nightmare); these answer the counts at login and the best times when asked.
 */
const Common = require("./Common.Nightmare");

const MONSTERS = {
  "The Nightmare": [Common.KILLS_ATTRIBUTE, Common.BEST_ATTRIBUTE],
  "Phosani's Nightmare": [Common.PHOSANI_KILLS_ATTRIBUTE, Common.PHOSANI_BEST_ATTRIBUTE],
};

function answerKillCount({ player, counts }) {
  for (const [monster, [kills]] of Object.entries(MONSTERS)) {
    const count = Common.count(player, kills);
    if (count > 0) counts[monster] = count;
  }
}

function answerPersonalBest(request) {
  const keys = MONSTERS[request.monster];
  if (!keys) return;
  const best = Common.count(request.player, keys[1]);
  if (best > 0) request.best = best;
}

module.exports = function registerNightmareCombatAchievements(api) {
  api.onCustomEvent("combat-achievements:kill-count", answerKillCount);
  api.onCustomEvent("combat-achievements:personal-best", answerPersonalBest);
};
