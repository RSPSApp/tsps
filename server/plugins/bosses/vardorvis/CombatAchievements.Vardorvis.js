/**
 * Vardorvis' Combat Achievements (plugins/achievements/combatachievements/): his kill count is the
 * plugin's own (counted by event, so the kill-count message comes first and the tasks after the
 * fight's time, as captured), and the fight's tasks are judged here:
 * - Vardorvis Speed-Trialist / Speed-Chaser / Speed-Runner: under 1:15, 1:05 and 0:55, off a slayer
 *   task, timed like the "Fight duration" message.
 * - Vardorvis Sleeper: a kill of the awakened Vardorvis.
 * The kill-count tasks (Vardorvis Adept, Vardorvis Master) finish from the count. An awakened kill
 * has its own count (varp 3971) and isn't one of these.
 */
const Common = require("./Common.Vardorvis");

const MONSTER = "Vardorvis";
const SPEED_TASKS = [["Vardorvis Speed-Trialist", 75], ["Vardorvis Speed-Chaser", 65], ["Vardorvis Speed-Runner", 55]];
const SLEEPER = "Vardorvis Sleeper";
const PERFECT_KILLS = 5;
const AXE_SURVIVAL_TICKS = 300;

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
  return Number.isInteger(request.total) ? request.total : null;
}

function onSlayerTask(player, npc) {
  const request = { player, npc, onTask: false };
  Common.api.emitCustomEvent("slayer:on-task", request);
  return request.onTask === true;
}

/** The fight's own tasks, judged after the kill's messages. */
function judge(fight, ticks) {
  const { player } = fight;
  const complete = (task) => Common.api.emitCustomEvent("combat-achievements:complete", { player, task });
  if (fight.awakened) {
    complete(SLEEPER);
    return;
  }
  if (fight.perfectKill) {
    fight.session.perfectKills = (fight.session.perfectKills ?? 0) + 1;
    if (fight.session.perfectKills >= PERFECT_KILLS) complete("Perfect Vardorvis");
  }
  if (fight.axeEnrageTicks >= AXE_SURVIVAL_TICKS && !fight.leftAxeCentre) complete("Axe Enthusiast");
  if (onSlayerTask(player, fight.boss)) return;
  for (const [task, seconds] of SPEED_TASKS) if (ticks * 0.6 < seconds) complete(task);
}

/** Axe Enthusiast tracks the three-minute enrage while the player stays in the middle 5x5. */
function tick(fight) {
  if (fight.awakened || !fight.engaged || !fight.enraged) return;
  const [x, y] = Common.siteTile(fight.session.area, fight.player.getLocation());
  const [centreX, centreY] = Common.data.axes.centre;
  if (Math.abs(x - centreX) > 2 || Math.abs(y - centreY) > 2) fight.leftAxeCentre = true;
  fight.axeEnrageTicks++;
}

function answerKillCount({ player, counts }) {
  const kills = Common.count(player, Common.KILLS_ATTRIBUTE);
  if (kills > 0) counts[MONSTER] = kills;
}

function answerPersonalBest(request) {
  if (request.monster !== MONSTER) return;
  const best = Common.count(request.player, Common.BEST_TICKS_ATTRIBUTE);
  if (best > 0) request.best = best;
}

function attachCombatAchievements(api) {
  api.onCustomEvent("combat-achievements:kill-count", answerKillCount);
  api.onCustomEvent("combat-achievements:personal-best", answerPersonalBest);
}

module.exports = { attachCombatAchievements, killed, judge, tick };
