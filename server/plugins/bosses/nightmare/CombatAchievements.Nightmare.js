/**
 * Kill counts and best times for Combat Achievements: kills are announced as they happen
 * (Fight.Nightmare); these answer the counts at login and the best times when asked.
 */
const Common = require("./Common.Nightmare");

const MONSTERS = {
  "The Nightmare": [Common.KILLS_ATTRIBUTE, Common.BEST_ATTRIBUTE],
  "Phosani's Nightmare": [Common.PHOSANI_KILLS_ATTRIBUTE, Common.PHOSANI_BEST_ATTRIBUTE],
};
const fights = new WeakMap();

function stateOf(fight, player) {
  let states = fights.get(fight);
  if (!states) {
    states = new Map();
    fights.set(fight, states);
  }
  if (!states.has(player)) {
    states.set(player, { prayerDisabled: false, desperateWalkerReached: false, walkerReached: false, crushHourFailed: false,
      forbiddenDamage: false, sporesSlowed: false });
  }
  return states.get(player);
}

function forPlayers(fight, action) {
  for (const player of fight.players()) action(stateOf(fight, player));
}

function damageTaken(fight, player, amount) {
  if (fight?.phosani && amount > 0 && player?.isPlayer?.()) stateOf(fight, player).forbiddenDamage = true;
}

function prayerDisabled(fight, player) {
  if (fight?.phosani) stateOf(fight, player).prayerDisabled = true;
}

function sleepwalkerReached(fight, desperate) {
  if (!fight?.phosani) return;
  forPlayers(fight, (state) => {
    state.walkerReached = true;
    if (desperate) state.desperateWalkerReached = true;
  });
}

function crushHourFailed(fight) {
  if (fight?.phosani) forPlayers(fight, (state) => { state.crushHourFailed = true; });
}

function sporesSlowed(fight, player) {
  if (fight?.phosani) stateOf(fight, player).sporesSlowed = true;
}

function judge(fight, player) {
  if (!fight.phosani) return;
  const state = stateOf(fight, player);
  const complete = (task) => Common.api.emitCustomEvent("combat-achievements:complete", { player, task });
  if (!state.prayerDisabled) complete("I Would Simply React");
  if (!state.desperateWalkerReached) complete("Dreamland Express");
  if (!state.crushHourFailed) complete("Crush Hour");
  if (!state.forbiddenDamage && !state.walkerReached && !state.sporesSlowed) complete("Perfect Phosani's Nightmare");
}

function reset(fight) {
  fights.set(fight, new Map());
}

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

function registerNightmareCombatAchievements(api) {
  api.onCustomEvent("combat-achievements:kill-count", answerKillCount);
  api.onCustomEvent("combat-achievements:personal-best", answerPersonalBest);
}

module.exports = registerNightmareCombatAchievements;
Object.assign(module.exports, { damageTaken, prayerDisabled, sleepwalkerReached, crushHourFailed, sporesSlowed, judge, reset });
