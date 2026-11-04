let core = null;
// Rada's blessing 4 to 1, each with its chance.
let extraFishChances = [];

/**
 * Wiki (Kourend & Kebos Diary rewards): Rada's blessing 1 to 4, worn in the ammunition slot,
 * give a 2%, 4%, 6% or 8% chance to catch two fish at once, with no additional experience.
 */
function attach(api) {
  core = api.core;
  const I = core.ItemIdentifiers;
  extraFishChances = [
    [I.RADAS_BLESSING_4, 0.08],
    [I.RADAS_BLESSING_3, 0.06],
    [I.RADAS_BLESSING_2, 0.04],
    [I.RADAS_BLESSING_1, 0.02],
  ];
}

// Wiki (Rada's blessing 1 to 4); no capture of it exists, so the chat channel is Fishing's own.
const EXTRA_FISH_MESSAGE = "Rada's blessing enabled you to catch an extra fish.";

/**
 * The worn tier's chance of a second fish, 0 without a blessing. It is a members' benefit: a
 * blessing saved as worn stays on a free world, where FreeToPlay only blocks equipping it.
 */
function extraFishChance(player) {
  if (!core.WorldDefinition.isMembersWorld()) return 0;
  const worn = extraFishChances.find(([id]) => player.getEquipment().contains(id));
  return worn ? worn[1] : 0;
}

/** Rolls the blessing for one landed fish. */
function rollExtraFish(player) {
  const chance = extraFishChance(player);
  return chance > 0 && Math.random() < chance;
}

module.exports = { attach, extraFishChance, rollExtraFish, EXTRA_FISH_MESSAGE };
