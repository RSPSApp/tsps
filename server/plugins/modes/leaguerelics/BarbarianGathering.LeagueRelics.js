/**
 * Barbarian Gathering (https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Relics), Demonic
 * Pacts' tier 1 relic: a failed swing, chop or catch has a separate 50% chance to succeed, every
 * Mining, Woodcutting or Fishing gain brings 10% of it again in Strength and Agility (added as
 * it is, not multiplied again), and bare hands, whatever the level, fish as the spot's best tool
 * (its crystal version where one exists) with no bait (`fishing:tool`, `baitless`), and chop and
 * mine as the crystal axe and pickaxe (`woodcutting:tool`, `mining:tool`; no item, so no task
 * that names the tool: ours). The Knapsack comes from the cache's relic struct.
 * Not here: the Knapsack's storage (three kinds of gathered item, 140 in all, and its dispose
 * toggle): a container of its own for StorageItems, with options and lines nothing records yet.
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

/** No tool for this spot? Bare hands are its best one, at any level, with no bait. */
function hands(request) {
  if (request.variant || !active(request.player) || !request.variants?.length) return;
  request.variant = { ...request.variants[0], level: 1, baitless: true };
}

/** Bare hands as the effect's crystal tool from `tools`: no item, no requirement. */
function handTool(player, tools, skill) {
  if (!active(player)) return null;
  const tool = tools?.find((entry) => entry.id === core.ItemIdentifiers[effect.handTools[skill]]);
  return tool ? { ...tool, id: null, requiredLevel: 1, requiredAgility: 1, requiredFiremaking: 1 } : null;
}

function handAxe(request) {
  request.axe ??= handTool(request.player, request.axes, "WOODCUTTING");
}

function handPickaxe(request) {
  request.pickaxe ??= handTool(request.player, request.pickaxes, "MINING");
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
  api.onCustomEvent("woodcutting:tool", handAxe);
  api.onCustomEvent("mining:tool", handPickaxe);
  api.onCustomEvent("skills:experience-gained", bonusXp);
};
