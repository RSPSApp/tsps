/**
 * Flow State (https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Relics), Demonic Pacts' tier 7
 * relic: the listed skilling actions happen every 2 ticks (1.2 seconds). Here, Fishing's catch
 * rolls (`fishing:interval`) and every skill loop that asks `skills:action-interval` for its pace,
 * for the skills (and loop kinds) in the effect's `skills`: Mining's rock rolls, Woodcutting's
 * chops, Cooking on fires and ranges, Firemaking's lighting retries and campfire tending, bone
 * offerings on an altar, Fletching's batches, Smithing at a furnace or an anvil and cannonballs,
 * Crafting's make-many loops and pottery, Farming's rake swings and harvest picks, the alchemy,
 * Superheat Item, jewellery enchanting and transmutation casts, and the minigames' loops the Wiki
 * names: Wintertodt's root chopping and fletching and brazier lighting, Tempoross's harpooning. A
 * pace already under 2 (a recipe's own) stays as it is. The Wiki's "stacks with the fletching
 * knife": the knife's tick comes off after the relic's 2 (SkillActions' `saving`), 1 tick a fletch.
 * Not here: diabolic worms, which no Fishing spot here takes as bait; stealing valuables (not on
 * the server); and the mining that asks `mining:roll-interval` without a player (shooting stars,
 * Guardians of the Rift, Volcanic Mine).
 */
const Common = require("./Common.LeagueRelics");

let effect;

function interval(request) {
  if (Common.effectActive(request.player, effect)) request.ticks = Math.min(request.ticks, effect.ticks);
}

/** Whether the effect paces this skill's loop: its skill listed with true, or with the loop's kind. */
function paced(request) {
  const name = Object.keys(effect.skills).find((key) => Common.core.Skill[key] === request.skill);
  const kinds = name === undefined ? null : effect.skills[name];
  return kinds === true || (Array.isArray(kinds) && kinds.includes(request.kind));
}

function actionInterval(request) {
  if (paced(request)) interval(request);
}

module.exports = function attach(api) {
  effect = Common.data.effects.flowState;
  api.onCustomEvent("fishing:interval", interval);
  api.onCustomEvent("skills:action-interval", actionInterval);
};
