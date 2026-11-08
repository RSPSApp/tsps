/**
 * Equilibrium (https://oldschool.runescape.wiki/w/Equilibrium_(Trailblazer_Reloaded_League),
 * https://oldschool.runescape.wiki/w/Equilibrium), a relic of both leagues (Trailblazer Reloaded
 * tier 6, Raging Echoes tier 4): every gain of experience brings a bonus in the same skill of 10%
 * of the player's total level, 20% when the skill is the one they have the least experience in. The
 * bonus is not multiplied by the league's rate (nor the world's). Sailing, released after both leagues, is neither
 * the least-experienced skill nor part of the total level.
 */
const Common = require("./Common.LeagueRelics");

let core;
let effect;

/** Players whose bonus is being added, so the bonus's own gain brings no bonus. */
const granting = new WeakSet();

function active(player) {
  return Common.effectActive(player, effect);
}

/** The league skills: Sailing came after both leagues, so it takes no part (docs/leagues.md). */
function leagueSkills() {
  return core.Skill.values().filter((skill) => skill !== core.Skill.SAILING);
}

function leastExperienced(manager) {
  let least = null;
  for (const skill of leagueSkills()) {
    if (least === null || manager.getExperience(skill) < manager.getExperience(least)) least = skill;
  }
  return least;
}

/** `skills:experience-gained`: the bonus, added as a plain gain (no multipliers). */
function gained({ player, skill }) {
  if (granting.has(player) || !active(player)) return;
  const manager = player.getSkillManager();
  const fraction = skill === leastExperienced(manager) ? effect.leastExperiencedFraction : effect.bonusFraction;
  // The total level of the league skills (an untrained Sailing's 1 is not part of it).
  const total = leagueSkills().reduce((sum, each) => sum + manager.getMaxLevel(each), 0);
  const bonus = total * fraction;
  if (bonus <= 0) return;
  granting.add(player);
  try {
    manager.addExperience(skill, bonus, false);
  } finally {
    granting.delete(player);
  }
}

module.exports = function attach(api) {
  core = api.core;
  effect = Common.data.effects.equilibrium;
  api.onCustomEvent("skills:experience-gained", gained);
};
