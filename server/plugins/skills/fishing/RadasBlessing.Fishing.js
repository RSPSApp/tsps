const { ItemIds } = require("../../../src/main/typescript/elvarg/util/IdEnums");

// Wiki (Kourend & Kebos Diary rewards): Rada's blessing 1 to 4, worn in the ammunition slot,
// give a 2%, 4%, 6% or 8% chance to catch two fish at once, with no additional experience.
const EXTRA_FISH_CHANCES = [
  [ItemIds.RADAS_BLESSING_4, 0.08],
  [ItemIds.RADAS_BLESSING_3, 0.06],
  [ItemIds.RADAS_BLESSING_2, 0.04],
  [ItemIds.RADAS_BLESSING_1, 0.02],
];

// Wiki (Rada's blessing 1 to 4); no capture of it exists, so the chat channel is Fishing's own.
const EXTRA_FISH_MESSAGE = "Rada's blessing enabled you to catch an extra fish.";

/** The worn tier's chance of a second fish, 0 without a blessing. */
function extraFishChance(player) {
  const worn = EXTRA_FISH_CHANCES.find(([id]) => player.getEquipment().contains(id));
  return worn ? worn[1] : 0;
}

/** Rolls the blessing for one landed fish. */
function rollExtraFish(player) {
  const chance = extraFishChance(player);
  return chance > 0 && Math.random() < chance;
}

module.exports = { extraFishChance, rollExtraFish, EXTRA_FISH_MESSAGE };
