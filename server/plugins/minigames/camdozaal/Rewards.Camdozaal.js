"use strict";

const S = require("./Shared.Camdozaal");
const RELICS = [1, 2, 3, 4, 5].map(index => `camdozaal_relic_${index}`);

/** Roll the Wiki's published overall rare marginals directly. Its quoted conditional
 * 1/15 member hammer wording does not normalize with those approximate marginals;
 * use the published 1/300 overall hammer rate rather than deriving a rarer rate.
 */
function rareMultiplier(player) {
  return 1 / (1 - (S.purchased(player, 4) ? 0.05 : 0) - (S.boostTicks(player) > 0 ? 0.05 : 0));
}
function depositReward(request) {
  const { player } = request;
  if (request.reward || !S.inRuins(player)) return;
  const multiplier = rareMultiplier(player);
  const roll = Math.random();
  let boundary = multiplier / 200;
  if (roll < boundary) {
    request.reward = { itemId: S.obj("barronite_mace_1"), amount: 1 };
    return;
  }
  for (const name of RELICS) {
    boundary += multiplier / 350;
    if (roll < boundary) {
      request.reward = { itemId: S.obj(name), amount: 1 };
      return;
    }
  }
  if (S.core().WorldDefinition.isMembersWorld()) {
    boundary += multiplier / 300;
    if (roll < boundary) {
      request.reward = { itemId: S.obj("imcando_hammer_broken"), amount: 1 };
      return;
    }
  }
  // Large shards retain their published 1/20 marginal; small shards take the remainder.
  const large = roll < boundary + 1 / 20;
  request.reward = { itemId: S.obj("camdozaal_barronite_shard"),
    amount: large ? 15 + Math.floor(Math.random() * 21) : 6 + Math.floor(Math.random() * 3) };
}

function fishingCatch(request) {
  const { player } = request;
  if (![1, 2, 3].some(index => request.npcId === S.core().CacheDefinitions.getNpcId(`camdozaal_fishingspot_${index}`)) || !S.inRuins(player) || !request.caught.length) return;
  let name, amount;
  if (Math.random() < rareMultiplier(player) / 512) {
    name = "barronite_mace_2";
    amount = 1;
  } else if (Math.random() < 0.2) {
    // Wiki lists shards as common but publishes no weight. One in five is a TSPS estimate.
    name = "camdozaal_barronite_shard";
    amount = 3;
  } else return;
  const original = request.caught[0];
  request.caught = [Object.assign(Object.create(Object.getPrototypeOf(original)), original, {
    id: S.obj(name), experience: 0, extraXp: [], amount: () => amount, junk: true, big: null, petBase: null,
    message: () => name === "barronite_mace_2" ? "You catch a barronite handle." : "You catch some barronite shards.",
  })];
}

module.exports = function attach(api) {
  api.onCustomEvent("camdozaal:deposit-reward", depositReward);
  api.onCustomEvent("fishing:catch", fishingCatch);
};
module.exports.rareMultiplier = rareMultiplier;
