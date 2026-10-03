// TODO: ported from xrsps-typescript; untested.
module.exports = function registerVestasLongswordSpecialAttack(api) {
  const { CombatSpecial, ItemIdentifiers, MeleeCombatMethod } = api.core;

  const DRAIN = 25;
  const FEINT_MINIMUM_DAMAGE_MULTIPLIER = 0.2;
  const FEINT_MAXIMUM_DAMAGE_MULTIPLIER = 1.2;
  const FEINT_DEFENCE_ROLL_MULTIPLIER = 0.25;
  const STAB_DEFENCE_BONUS_INDEX = 0;

  class VestasLongswordCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
    }
  }

  api.registerCombatSpecial({
    id: "vestas_longsword",
    itemIds: [ItemIdentifiers.VESTAS_LONGSWORD],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      accuracyMultiplier: 1,
      damageMultiplier: 1,
      minimumDamageMultiplier: FEINT_MINIMUM_DAMAGE_MULTIPLIER,
      maximumDamageMultiplier: FEINT_MAXIMUM_DAMAGE_MULTIPLIER,
      meleeDefenceBonusIndex: STAB_DEFENCE_BONUS_INDEX,
      defenceRollMultiplier: FEINT_DEFENCE_ROLL_MULTIPLIER,
    },
    combatMethod: new VestasLongswordCombatMethod(),
  });
};
