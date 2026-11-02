/**
 * Culling Spree (https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Relics), Demonic Pacts'
 * tier 6 relic: every Slayer reward shop perk (unlocks, extensions, cancelling and blocking) and
 * its rune pouch, herb sack and looting bag cost no points, and a superior Slayer monster always
 * drops 1 to 3 elite clues (as scroll boxes, the form the tier-1 passive gives every clue: ours).
 * A slain superior has a 50% chance of another where it died (`slayer:superior-again`), and the
 * Slayer helmet (i)'s effects come without one (`slayer:helmet`): its on-task melee, Ranged and
 * Magic boosts and its protection from banshees, spectres, devils and wall beasts.
 * Not here: the choice of three tasks with a chosen kill count (only Mortimer's choice exists, and
 * no Leagues VI capture shows the relic's), and the helmet's other uses that read the worn item's
 * name (Nex's gas, the equipment screen's on-task stats).
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

function superiorAgain(rule) {
  if (active(rule.player)) rule.chance = Math.max(rule.chance, effect.superiorAgainChance);
}

function helmet(request) {
  if (active(request.player) && request.worn !== "imbued") request.worn = effect.helmet;
}

module.exports = function attach(api) {
  core = api.core;
  effect = Common.data.effects.cullingSpree;
  freeItems = new Set(effect.freeItems.map((name) => core.ItemIdentifiers[name]));
  api.onCustomEvent("slayer:reward-cost", rewardCost);
  api.onCustomEvent("slayer:superior-rewards", superiorClues);
  api.onCustomEvent("slayer:superior-again", superiorAgain);
  api.onCustomEvent("slayer:helmet", helmet);
};
