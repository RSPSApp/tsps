/** Ordinary fishing clue bottles: https://oldschool.runescape.wiki/w/Clue_bottle */
let api, core;
let tiers = [];
let imbuedRings = [];

function bottleDenominator(base, level, tierTenths, combatAchievement) {
  const adjustedBase = combatAchievement ? Math.floor(base * 95 / 100) : base;
  return Math.floor(adjustedBase * tierTenths / ((100 + level) * 10));
}

function rollClueBottles(player, base, random = Math.random) {
  if (!(base > 0)) return;
  const level = player.getSkillManager().getCurrentLevel(core.Skill.FISHING);
  const location = player.getLocation();
  const wildernessRing = location && core.Wilderness.isInLocation(location) &&
    core.Wilderness.levelAt(location.getX(), location.getY()) > 0 &&
    imbuedRings.some((id) => player.getEquipment().contains(id));
  for (const tier of tiers) {
    const capacity = { player, tier: tier.name, allowed: null };
    api.emitCustomEvent("treasure-trails:can-receive", capacity);
    if (capacity.allowed !== true) continue;

    const boost = { player, vessel: "bottle", tier: tier.name, multiplier: 1 };
    api.emitCustomEvent("treasure-trails:vessel-chance", boost);
    if (boost.allowed === false) continue;

    const achievement = { player, tier: tier.name, currentThresholdMet: false };
    if (tier.name !== "beginner") api.emitCustomEvent("combat-achievements:tier", achievement);
    const denominator = bottleDenominator(base, level, tier.tenths, achievement.currentThresholdMet === true);
    if (denominator < 1) continue;
    const multiplier = Number.isFinite(boost.multiplier) && boost.multiplier > 1 ? boost.multiplier : 1;
    // https://oldschool.runescape.wiki/w/Clue_bottle_%28beginner%29: no imbued-ring bonus.
    const chanceMultiplier = multiplier * (wildernessRing && tier.name !== "beginner" ? 2 : 1);
    if (random() * denominator >= chanceMultiplier) continue;

    const reward = { player, itemId: tier.itemId, box: false };
    api.emitCustomEvent("treasure-trails:clue-item", reward);
    player.getInventory().forceAdd(player, new core.Item(reward.itemId, 1));
  }
}

function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  const I = core.ItemIdentifiers;
  tiers = [
    { name: "beginner", tenths: 2, itemId: I.CLUE_BOTTLE_BEGINNER_ },
    { name: "easy", tenths: 17, itemId: I.CLUE_BOTTLE_EASY_ },
    { name: "medium", tenths: 20, itemId: I.CLUE_BOTTLE_MEDIUM_ },
    { name: "hard", tenths: 33, itemId: I.CLUE_BOTTLE_HARD_ },
    { name: "elite", tenths: 100, itemId: I.CLUE_BOTTLE_ELITE_ },
  ];
  imbuedRings = [I.RING_OF_WEALTH_I_, I.RING_OF_WEALTH_I1_, I.RING_OF_WEALTH_I2_,
    I.RING_OF_WEALTH_I3_, I.RING_OF_WEALTH_I4_, I.RING_OF_WEALTH_I5_,
    I.RING_OF_WEALTH_I1__2, I.RING_OF_WEALTH_I5__2];
}

module.exports = { attach, rollClueBottles, bottleDenominator };
