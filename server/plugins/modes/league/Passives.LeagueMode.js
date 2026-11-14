/**
 * The relic tiers' passive effects other than the XP rate (docs/leagues.md; the Wiki's Relics
 * pages' "Tier N" bullets; data: leagues.json `passives`). Each applies to a league character
 * from the 1-based tier its `fromTier` names, read from the highest tier the character chose
 * (`league:highest-tier`, LeagueRelics), and never to a main character or a plain world. The
 * effects live where the game decides them: running's energy drain (the drain modifier), the
 * combat skills' XP (the can-gain-experience hook), minigame points (`minigame:points`, asked by
 * each minigame as it awards them), Slayer task points and superiors (`slayer:task-reward`,
 * `slayer:superior-spawn`, asked by the Slayer plugin) and clue scrolls dropping as scroll boxes
 * (`treasure-trails:scroll-boxes`, asked by ClueCapacity). The drop boost is
 * BoostedDrops.LeagueMode.js.
 */
const Common = require("./Common.LeagueMode");

/** The passive `key` of the player's league if its gate tier (`fromTier`, a number) is reached, else null. */
function passive(player, key) {
  const type = Common.leagueOf(player);
  if (type === null) return null;
  const entry = Common.passives(type)[key];
  if (!entry || typeof entry.fromTier !== "number") return null;
  return Common.highestTier(player) + 1 >= entry.fromTier ? entry : null;
}

/** The value of the passive `key` for the highest tier reached (`fromTier` a map of tier -> value), or null below its first tier. */
function tierValue(player, key) {
  const type = Common.leagueOf(player);
  if (type === null) return null;
  const entry = Common.passives(type)[key];
  if (!entry || typeof entry.fromTier !== "object") return null;
  const reached = Common.highestTier(player) + 1;
  let best = null;
  for (const [from, value] of Object.entries(entry.fromTier)) {
    if (reached >= Number(from) && (best === null || Number(from) > best.from)) best = { from: Number(from), value: Number(value) };
  }
  return best?.value ?? null;
}

/** Run energy is never drained whilst running (tier 1 of both leagues). */
function runEnergyDrain(entity, amount) {
  return passive(entity, "runEnergy") ? 0 : amount;
}

/** Raging Echoes tier 3: the combat skills' XP, Hitpoints and Prayer included, x2 on top of the league's rate. */
function combatExperience(event) {
  const combat = passive(event.player, "combatXp");
  if (!combat) return;
  const { Skill } = Common.core;
  if (combat.skills.some((name) => Skill[name] === event.skill)) event.multiplier *= combat.multiplier;
}

/** `minigame:points` { player, minigame, points }: the points a minigame the passive lists is about to award, multiplied. */
function minigamePoints(request) {
  if (!request?.player || !(request.points > 0)) return;
  const type = Common.leagueOf(request.player);
  if (type === null || !Common.passives(type).minigamePoints?.minigames?.includes(request.minigame)) return;
  const multiplier = tierValue(request.player, "minigamePoints");
  if (multiplier) request.points = Math.floor(request.points * multiplier);
}

/** `slayer:task-reward` { player, master, freeTasks, multiplier }: 5x task points, from the first task. */
function slayerTaskReward(request) {
  const slayer = request?.player ? passive(request.player, "slayer") : null;
  if (!slayer) return;
  request.freeTasks = Math.min(request.freeTasks, slayer.freeTasks);
  request.multiplier *= slayer.pointsMultiplier;
}

/** `slayer:superior-spawn` { player, npc, unlocked, chance }: Bigger and Badder for free, superiors 1 in 50. */
function superiorSpawn(request) {
  const slayer = request?.player ? passive(request.player, "slayer") : null;
  if (!slayer) return;
  if (slayer.biggerAndBadder) request.unlocked = true;
  request.chance = Math.min(request.chance, slayer.superiorChance);
}

/** `treasure-trails:scroll-boxes` { player, unlocked, capacity }: every clue drops as a stackable scroll box, without a limit. */
function scrollBoxes(request) {
  if (!request?.player || !passive(request.player, "scrollBoxes")) return;
  request.unlocked = true;
  request.capacity = Number.POSITIVE_INFINITY;
}

module.exports = function attach(api) {
  api.registerRunEnergyDrainModifier(runEnergyDrain);
  api.onCanGainExperience(combatExperience);
  api.onCustomEvent("minigame:points", minigamePoints);
  api.onCustomEvent("slayer:task-reward", slayerTaskReward);
  api.onCustomEvent("slayer:superior-spawn", superiorSpawn);
  api.onCustomEvent("treasure-trails:scroll-boxes", scrollBoxes);
};

module.exports.passive = passive;
module.exports.tierValue = tierValue;
