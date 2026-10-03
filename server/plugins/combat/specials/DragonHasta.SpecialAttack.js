// TODO: ported from xrsps-typescript; untested.
module.exports = function registerDragonHastaSpecialAttack(api) {
  const { CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod } = api.core;

  const MIN_DRAIN = 5;
  const IMPACT_GRAPHIC = new Graphic(2823);

  // Unleash consumes every available special-attack point (minimum 5%).
  // TODO: the dynamic +5% accuracy / +2.5% damage per energy step cannot be
  // expressed as static roll traits; only the static stab/anti-prayer parts are applied.
  function unleashDrain(character) {
    const current = Math.max(0, Math.floor(character.getSpecialPercentage()));
    return Math.max(MIN_DRAIN, current);
  }

  class DragonHastaCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, unleashDrain(character));
      super.start(character, target);
    }

    handleAfterHitEffects(hit) {
      if (hit.isAccurate()) {
        hit.getTarget().performGraphic(IMPACT_GRAPHIC);
      }
    }
  }

  api.registerCombatSpecial({
    id: "dragon_hasta",
    itemIds: [
      ItemIdentifiers.DRAGON_HASTA,
      ItemIdentifiers.DRAGON_HASTA_P_,
      ItemIdentifiers.DRAGON_HASTA_P_PLUS_,
      ItemIdentifiers.DRAGON_HASTA_P_PLUS_PLUS_,
      ItemIdentifiers.DRAGON_HASTA_KP_,
    ],
    drainAmount: MIN_DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      meleeAttackBonusIndex: 0,
      ignoreProtectionPrayer: true,
    },
    combatMethod: new DragonHastaCombatMethod(),
  });
};
