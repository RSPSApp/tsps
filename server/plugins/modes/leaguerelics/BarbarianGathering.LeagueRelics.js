/**
 * Barbarian Gathering (https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Relics), Demonic
 * Pacts' tier 1 relic: a failed swing, chop or catch has a separate 50% chance to succeed, every
 * Mining, Woodcutting or Fishing gain brings 10% of it again in Strength and Agility (added as
 * it is, not multiplied again), and bare hands fish as the spot's best tool (its crystal version
 * where one exists) whatever the level. The Knapsack comes from the cache's relic struct.
 * Not here: chopping and mining bare-handed (Mining and Woodcutting ask no hook for a tool), no
 * bait when fishing bare-handed (Fishing takes bait without one), and the Knapsack's storage.
 */
const Common = require("./Common.LeagueRelics");

let core;
let effect;
let skills;
let bonusSkills;

/** Players whose bonus is being added, so the bonus's own gain brings nothing. */
const granting = new WeakSet();

function active(player) {
  return Common.effectActive(player, effect);
}

function secondChance(request) {
  if (!request.success && active(request.player) && Math.random() < effect.secondChance) request.success = true;
}

/** No tool for this spot? Bare hands are its best one, at any level. */
function hands(request) {
  if (request.variant || !active(request.player) || !request.variants?.length) return;
  request.variant = { ...request.variants[0], level: 1 };
}

function bonusXp({ player, skill, experience }) {
  if (granting.has(player) || !(experience > 0) || !active(player)) return;
  if (!skills) {
    skills = new Set(effect.skills.map((name) => core.Skill[name]));
    bonusSkills = effect.bonusSkills.map((name) => core.Skill[name]);
  }
  if (!skills.has(skill)) return;
  granting.add(player);
  try {
    for (const bonus of bonusSkills) player.getSkillManager().addExperience(bonus, experience * effect.bonusXpFraction, false);
  } finally {
    granting.delete(player);
  }
}

module.exports = function attach(api) {
  core = api.core;
  effect = Common.data.effects.barbarianGathering;
  api.onCustomEvent("mining:attempt", secondChance);
  api.onCustomEvent("woodcutting:attempt", secondChance);
  api.onCustomEvent("fishing:attempt", secondChance);
  api.onCustomEvent("fishing:tool", hands);
  api.onCustomEvent("skills:experience-gained", bonusXp);
};
