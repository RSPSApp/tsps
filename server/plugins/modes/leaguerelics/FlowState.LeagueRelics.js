/**
 * Flow State (https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Relics), Demonic Pacts' tier 7
 * relic: the listed skilling actions happen every 2 ticks (1.2 seconds). Here, Fishing's catch
 * rolls (`fishing:interval`).
 * Not here: Mining, Woodcutting, Cooking, Firemaking, bone offering, Fletching, Smithing,
 * Crafting, Farming, the alchemy and superheat spells and the minigame actions, whose loops ask
 * no hook for their pace.
 */
const Common = require("./Common.LeagueRelics");

let effect;

function interval(request) {
  if (Common.effectActive(request.player, effect)) request.ticks = Math.min(request.ticks, effect.ticks);
}

module.exports = function attach(api) {
  effect = Common.data.effects.flowState;
  api.onCustomEvent("fishing:interval", interval);
};
