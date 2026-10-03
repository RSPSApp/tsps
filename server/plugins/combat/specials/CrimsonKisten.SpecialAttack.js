// TODO: base implementation — "Crimson kisten" is not in our cache/ItemIdentifiers, so this does not register yet. Ported from xrsps-typescript; untested.
// TODO: special attack animation/graphic ids not found; skipped.
module.exports = function registerCrimsonKistenSpecialAttack(api) {
  const { CombatSpecial, MeleeCombatMethod } = api.core;

  const ITEM_IDS = []; // TODO: add the id once the item exists in our cache.
  if (ITEM_IDS.length === 0) {
    return;
  }

  const DRAIN = 50;
  const CRUSH_BONUS_INDEX = 2;
  const ACCURACY_ROLLS = 4;

  class CrimsonKistenCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
    }
  }

  api.registerCombatSpecial({
    id: "crimson_kisten",
    itemIds: ITEM_IDS,
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      meleeAttackBonusIndex: CRUSH_BONUS_INDEX,
      accuracyRollCount: ACCURACY_ROLLS,
      damageRangeBySuccessfulAccuracyRolls: [
        { minimumDamageMultiplier: 0.7, maximumDamageMultiplier: 1.1 },
        { minimumDamageMultiplier: 0.9, maximumDamageMultiplier: 1.3 },
        { minimumDamageMultiplier: 1.1, maximumDamageMultiplier: 1.5 },
        { minimumDamageMultiplier: 1.3, maximumDamageMultiplier: 1.7 },
      ],
      maximumHitReductionOnFullAccuracyRolls: 1,
    },
    combatMethod: new CrimsonKistenCombatMethod(),
  });
};
