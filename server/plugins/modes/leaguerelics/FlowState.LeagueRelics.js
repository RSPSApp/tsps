/**
 * Flow State (https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Relics), Demonic Pacts' tier 7
 * relic: the listed skilling actions happen every 2 ticks (1.2 seconds). Here, Fishing's catch
 * rolls (`fishing:interval`) and every skill loop that asks `skills:action-interval` for its pace,
 * for the skills (and loop kinds) in the effect's `skills`: Mining's rock rolls, Woodcutting's
 * chops, Cooking on fires and ranges, Firemaking's lighting retries and campfire tending, bone
 * offerings on an altar, Fletching's batches, furnace smelting (bars and molten glass), Crafting's
 * make-many loops and pottery, Farming's rake swings and harvest picks, and the alchemy, Superheat
 * Item and jewellery enchanting casts. A pace already under 2 (a fletching knife's, a recipe's
 * own) stays as it is.
 * Not here: the minigame actions (Wintertodt, Tempoross, stealing valuables), whose loops each
 * keep several paces of their own; the mining that asks `mining:roll-interval` without a player
 * (shooting stars, Guardians of the Rift, Volcanic Mine); and anvil smithing, which the Wiki
 * leaves out.
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
