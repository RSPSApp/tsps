/**
 * Nex's Combat Achievements (plugins/achievements/combatachievements/), task names and wording from
 * the cache. Her kill count is the plugin's own, counted by event so the kill-count message comes
 * first; Nex Veteran and Nex Master finish from it. Judged here after each kill, for everyone there:
 * - Nex Survivors: nobody died. Nex Trio / Nex Duo: three / two or fewer in the arena at the start.
 * - A siphon will solve this: she never healed from Blood Siphon. Contain this!: nobody hurt by an
 *   ice special. There is no escape!: nobody hit by Smoke Dash. Shadows Move...: nobody hit by
 *   Shadow Smash. Perfect Nex: all four.
 * - I should see a doctor: someone was coughing as she died.
 */
const Common = require("./Common.Nex");

const MONSTER = "Nex";

/** Counts the kill; `announce(kills)` tells the player the count before any task finishes. */
function killed(player, ownKills, announce) {
  let announced = false;
  const request = {
    player,
    monster: MONSTER,
    count: ownKills,
    announce: (kills) => {
      announced = true;
      announce(kills);
    },
  };
  Common.api.emitCustomEvent("combat-achievements:kill", request);
  if (!announced) announce(ownKills);
}

function anyoneHitBy(fight, specials) {
  for (const hits of fight.record.hitBy.values()) {
    if (specials.some((special) => hits.has(special))) return true;
  }
  return false;
}

/** The fight's own tasks, judged after the kill's messages. */
function judge(fight, players) {
  const tasks = [];
  if (fight.deaths === 0) tasks.push("Nex Survivors");
  if (fight.startPlayers <= 3) tasks.push("Nex Trio");
  if (fight.startPlayers <= 2) tasks.push("Nex Duo");
  const siphon = !fight.record.siphonHealed;
  const ice = !anyoneHitBy(fight, ["containment", "prison"]);
  const dash = !anyoneHitBy(fight, ["dash"]);
  const smash = !anyoneHitBy(fight, ["smash"]);
  if (siphon) tasks.push("A siphon will solve this");
  if (ice) tasks.push("Contain this!");
  if (dash) tasks.push("There is no escape!");
  if (smash) tasks.push("Shadows Move...");
  if (siphon && ice && dash && smash) tasks.push("Perfect Nex");
  if (fight.record.coughing.size > 0) tasks.push("I should see a doctor");
  for (const player of players) {
    for (const task of tasks) Common.api.emitCustomEvent("combat-achievements:complete", { player, task });
  }
}

function answerKillCount({ player, counts }) {
  const kills = Common.count(player, Common.KILLS_ATTRIBUTE);
  if (kills > 0) counts[MONSTER] = kills;
}

function answerPersonalBest(request) {
  if (request.monster !== MONSTER) return;
  const best = Common.count(request.player, Common.BEST_ATTRIBUTE);
  if (best > 0) request.best = best;
}

function attachCombatAchievements(api) {
  api.onCustomEvent("combat-achievements:kill-count", answerKillCount);
  api.onCustomEvent("combat-achievements:personal-best", answerPersonalBest);
}

module.exports = { attachCombatAchievements, killed, judge };
