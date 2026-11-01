/**
 * Culling Spree (https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Relics), Demonic Pacts'
 * tier 6 relic: every Slayer reward shop perk (unlocks, extensions, cancelling and blocking) and
 * its rune pouch, herb sack and looting bag cost no points, and a superior Slayer monster always
 * drops 1 to 3 elite clues (as scroll boxes, the form the tier-1 passive gives every clue: ours).
 * Not here: the choice of three tasks with a chosen kill count (only Mortimer's choice exists),
 * a second superior from a slain one, and the Slayer helmet (i)'s effects without one (the helmet
 * asks no hook for the headwear it counts).
 */
const Common = require("./Common.LeagueRelics");

let core;
let effect;
let freeItems;

function active(player) {
  return Common.effectActive(player, effect);
}

function rewardCost(request) {
  if (!active(request.player)) return;
  if (request.kind === "buy" ? freeItems.has(request.itemId) : effect.freeKinds.includes(request.kind)) request.cost = 0;
}

function superiorClues({ player, drops }) {
  if (!Array.isArray(drops) || !active(player)) return;
  const [low, high] = effect.superiorClues;
  const amount = low + Math.floor(Math.random() * (high - low + 1));
  drops.push({ itemId: core.ItemIdentifiers[effect.superiorClue], amount, noted: false });
}

module.exports = function attach(api) {
  core = api.core;
  effect = Common.data.effects.cullingSpree;
  freeItems = new Set(effect.freeItems.map((name) => core.ItemIdentifiers[name]));
  api.onCustomEvent("slayer:reward-cost", rewardCost);
  api.onCustomEvent("slayer:superior-rewards", superiorClues);
};
