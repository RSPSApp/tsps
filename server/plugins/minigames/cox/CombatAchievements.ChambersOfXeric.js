"use strict";

/**
 * The Chambers of Xeric's Combat Achievements (plugins/achievements/combatachievements/).
 *
 * This unit decides what the raid's end decides (Wiki, Combat Achievements/All tasks): the
 * completion counts per mode, the raids without deaths, Solo / Trio / 5-scale speed tasks by the
 * raid's scale, Dust Seeker and Putting It Olm on the Line. Tasks about how a room went are
 * finished by that room's unit, through `complete`.
 */

const Shared = require("./Shared.ChambersOfXeric");
const Raid = require("./RaidState.ChambersOfXeric");
const Rewards = require("./Rewards.ChambersOfXeric");

const MONSTER = { normal: "Chambers of Xeric", challenge: "CM: Chambers of Xeric" };
const SOLO_POINTS_TASK = 40000;

/** Speed tasks: the raid's scale, then [task, minutes] for each mode. */
const SPEED = [
  { scale: 1,
    normal: [["Chambers of Xeric (Solo) Speed-Chaser", 21], ["Chambers of Xeric (Solo) Speed-Runner", 17]],
    challenge: [["Chambers of Xeric: CM (Solo) Speed-Chaser", 45], ["Chambers of Xeric: CM (Solo) Speed-Runner", 38.5]] },
  { scale: 3,
    normal: [["Chambers of Xeric (Trio) Speed-Chaser", 16.5], ["Chambers of Xeric (Trio) Speed-Runner", 14.5]],
    challenge: [["Chambers of Xeric: CM (Trio) Speed-Chaser", 35], ["Chambers of Xeric: CM (Trio) Speed-Runner", 27]] },
  { scale: 5,
    normal: [["Chambers of Xeric (5-Scale) Speed-Chaser", 15], ["Chambers of Xeric (5-Scale) Speed-Runner", 12.5]],
    challenge: [["Chambers of Xeric: CM (5-Scale) Speed-Chaser", 30], ["Chambers of Xeric: CM (5-Scale) Speed-Runner", 25]] },
];

const ticksOf = (minutes) => Math.round((minutes * 60) / 0.6);

/** Finishes a task for each of these players. */
function complete(players, task) {
  for (const player of [].concat(players)) Shared.api().emitCustomEvent("combat-achievements:complete", { player, task });
}

function completed(raid) {
  const mode = raid.challenge ? "challenge" : "normal";
  const solo = raid.scale === 1;
  const deathless = raid.deaths.length === 0;
  const speed = SPEED.find((entry) => entry.scale === raid.scale)?.[mode] ?? [];
  for (const player of raid.players) {
    const attribute = raid.challenge ? Shared.ATTR.CHALLENGE_KILLS : Shared.ATTR.KILLS;
    const count = Number(player.getAttribute(attribute)) || 0;
    Shared.api().emitCustomEvent("combat-achievements:kill", { player, monster: MONSTER[mode], count });
    if (deathless) complete(player, raid.challenge ? "Immortal Raid Team" : "Undying Raid Team");
    if (deathless && solo) complete(player, raid.challenge ? "Immortal Raider" : "Undying Raider");
    for (const [task, minutes] of speed) if (raid.duration < ticksOf(minutes)) complete(player, task);
    if (raid.challenge && raid.duration <= Rewards.targetTicks(raid.scale)) complete(player, "Dust Seeker");
    if (!raid.challenge && solo && raid.pointsOf(player) > SOLO_POINTS_TASK) complete(player, "Putting It Olm on the Line");
  }
}

/** At login: the completion counts, so earlier raids finish their kill-count tasks. */
function answerKillCount({ player, counts }) {
  const normal = Number(player.getAttribute(Shared.ATTR.KILLS)) || 0;
  const challenge = Number(player.getAttribute(Shared.ATTR.CHALLENGE_KILLS)) || 0;
  if (normal > 0) counts[MONSTER.normal] = normal;
  if (challenge > 0) counts[MONSTER.challenge] = challenge;
}

module.exports = function registerCoxCombatAchievements(api) {
  Shared.bind(api);
  Raid.onComplete(completed);
  api.onCustomEvent("combat-achievements:kill-count", answerKillCount);
};

Object.assign(module.exports, { complete, completed, answerKillCount });
