// TODO: ported from xrsps-typescript; untested.
module.exports = function registerDragonHastaSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod, Sounds } = api.core;

  const MIN_DRAIN = 5;
  const IMPACT_GRAPHIC = new Graphic(2823);

  // Unleash consumes every available special-attack point (minimum 5%). Every 5% spent adds 5%
  // accuracy and 2.5% damage (Wiki: Dragon_hasta), so the rolls read the energy this swing spent.
  const ACCURACY_PER_PERCENT = 0.01;
  const DAMAGE_PER_PERCENT = 0.005;
  /** Energy each wielder's current Unleash spent: the bar is already drained when the hit rolls. */
  const spent = new WeakMap();
  const SPECIAL_ANIMATION = new Animation(11171); // SPECIALATTACK_UNLEASH

  function unleashDrain(character) {
    const current = Math.max(0, Math.floor(character.getSpecialPercentage()));
    return Math.max(MIN_DRAIN, current);
  }

  function spentEnergy(player) {
    return spent.get(player) ?? unleashDrain(player);
  }

  function traitsFor(player) {
    const energy = spentEnergy(player);
    return {
      hitCount: 1,
      meleeAttackBonusIndex: 0,
      ignoreProtectionPrayer: true,
      accuracyMultiplier: 1 + energy * ACCURACY_PER_PERCENT,
      damageMultiplier: 1 + energy * DAMAGE_PER_PERCENT,
    };
  }

  class DragonHastaCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      // All the energy, not the special's cost: a cost cap (a league fragment) leaves it alone.
      const energy = unleashDrain(character);
      spent.set(character, energy);
      CombatSpecial.drain(character, energy, false);
      character.performAnimation(SPECIAL_ANIMATION);
      Sounds.sendSound(character, character.getAttackSound());
    }

    handleAfterHitEffects(hit) {
      spent.delete(hit.getAttacker());
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
    traitsFor,
    combatMethod: new DragonHastaCombatMethod(),
  });
};
