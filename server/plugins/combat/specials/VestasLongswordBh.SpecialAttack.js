// TODO: ported from xrsps-typescript; untested.
// TODO: Feint special attack animation/graphic ids not found; skipped.
module.exports = function registerVestasLongswordBhSpecialAttack(api) {
  const { CombatSpecial, ItemIdentifiers, MeleeCombatMethod } = api.core;

  const DRAIN = 25;

  class VestasLongswordBhCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
    }
  }

  api.registerCombatSpecial({
    id: "vestas_longsword_bh",
    itemIds: [
      ItemIdentifiers.VESTAS_LONGSWORD_BH_,
      ItemIdentifiers.VESTAS_BLIGHTED_LONGSWORD,
    ],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      accuracyMultiplier: 1,
      damageMultiplier: 1,
      minimumDamageMultiplier: 0.2,
      maximumDamageMultiplier: 1.2,
      meleeDefenceBonusIndex: 0,
      defenceRollMultiplier: 0.25,
    },
    combatMethod: new VestasLongswordBhCombatMethod(),
  });
};
