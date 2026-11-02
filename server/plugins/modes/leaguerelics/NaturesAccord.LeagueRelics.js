/**
 * Nature's Accord (https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Relics), Demonic Pacts'
 * tier 5 relic: a 20% chance to keep the seed or sapling planted, crops that never die (a
 * diseased one waits for a cure, as Overgrown's), and ten times the yield of every patch, noted,
 * with the experience of all of it. Its Fairy mushroom (from the cache's relic struct) is Fairy's
 * Flight's (FairysFlight.LeagueRelics.js, alias `nature-s-accord`). Patches and plants need no
 * Farming level (`farming:level-rules`): planting a seed or sapling, making a seedling, making and
 * placing a scarecrow; harvesting asks none here.
 * Not here: the spirit tree count, which Farming's level sets rather than gates; the Tithe Farm's
 * seeds, a minigame's; and the Tree Gnome Village quest completed on unlock.
 */
const Common = require("./Common.LeagueRelics");

let core;
let effect;

function active(player) {
  return Common.effectActive(player, effect);
}

function planting(rules) {
  if (!active(rules.player)) return;
  rules.undying = true;
  if (!rules.keepSeed && Math.random() < effect.seedSaveChance) {
    rules.keepSeed = true;
    const seed = core.ItemDefinition.forId(rules.seedId)?.getName?.()?.toLowerCase?.() ?? "seed";
    rules.message = Common.message("seedKept", { seed });
  }
}

function picked(pick) {
  if (!active(pick.player)) return;
  pick.amount *= effect.yieldMultiplier;
  pick.itemId = Common.noted(pick.itemId);
  if (Number.isFinite(pick.experience)) pick.experience *= effect.yieldMultiplier;
}

function levelRules(rules) {
  if (active(rules.player)) rules.waived = true;
}

module.exports = function attach(api) {
  core = api.core;
  effect = Common.data.effects.naturesAccord;
  api.onCustomEvent("farming:plant-rules", planting);
  api.onCustomEvent("farming:pick", picked);
  api.onCustomEvent("farming:level-rules", levelRules);
};
