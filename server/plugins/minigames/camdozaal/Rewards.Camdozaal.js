"use strict";

const S = require("./Shared.Camdozaal");
const RELICS = [1, 2, 3, 4, 5].map(index => `camdozaal_relic_${index}`);

/** Wiki rates are approximate and do not form a complete normalized table.
 * Anchor the head/relic marginals to those estimates and preserve Ash's conditional
 * 1/15 member hammer roll. This implies a lower hammer marginal than "about 1/300";
 * no undocumented extra nonshard items are invented to fill that difference.
 */
function rareMultiplier(player) {
  return 1 / (1 - (S.purchased(player, 4) ? 0.05 : 0) - (S.boostTicks(player) > 0 ? 0.05 : 0));
}
function depositReward(request) {
  const { player } = request;
  if (request.reward || !S.inRuins(player)) return;
  const multiplier = rareMultiplier(player);
  const headWeight = 1 / 200;
  const relicWeight = 1 / 350;
  const knownRareMass = (headWeight + RELICS.length * relicWeight) * multiplier;
  const hammerChance = S.core().WorldDefinition.isMembersWorld() ? 1 / 15 : 0;
  const nonShardMass = knownRareMass / (1 - hammerChance);
  if (Math.random() < nonShardMass) {
    if (hammerChance > 0 && Math.random() < hammerChance) {
      request.reward = { itemId: S.obj("imcando_hammer_broken"), amount: 1 };
      return;
    }
    const roll = Math.random() * (headWeight + RELICS.length * relicWeight);
    const name = roll < headWeight ? "barronite_mace_1"
      : RELICS[Math.min(RELICS.length - 1, Math.floor((roll - headWeight) / relicWeight))];
    request.reward = { itemId: S.obj(name), amount: 1 };
    return;
  }
  // Keep the published large-shard marginal near 1/20. Small shards take the remainder.
  const large = Math.random() < (1 / 20) / (1 - nonShardMass);
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
