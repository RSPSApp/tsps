// TODO: base implementation — "Sunspear" is not in our cache/ItemIdentifiers, so this does not register yet. Ported from xrsps-typescript; untested.
// TODO: special attack animation/graphic ids not found; skipped.
module.exports = function registerSunspearSpecialAttack(api) {
  const { CombatSpecial, MeleeCombatMethod } = api.core;

  const ITEM_IDS = []; // TODO: add the id once the item exists in our cache.
  if (ITEM_IDS.length === 0) {
    return;
  }

  const DRAIN = 50;

  class SunspearCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
    }
  }

  api.registerCombatSpecial({
    id: "sunspear",
    itemIds: ITEM_IDS,
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      accuracyMultiplier: 1,
      damageMultiplier: 1,
      minimumDamageMultiplier: 0.7,
      maximumDamageMultiplier: 0.7,
      fixedAccuracyRollMultiplierWhenTargetAtOrBelowMaximumDamage: 0.7,
    },
    combatMethod: new SunspearCombatMethod(),
  });
};
