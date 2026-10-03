// TODO: ported from xrsps-typescript; untested.
module.exports = function registerDragonThrownaxeSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, GraphicHeight, ItemIdentifiers, RangedCombatMethod } = api.core;

  const DRAIN = 25;
  const SPECIAL_ANIMATION = new Animation(7521);
  const SPECIAL_VFX = new Graphic(1317, 0, GraphicHeight.HIGH);
  const IMPACT_GRAPHIC = new Graphic(1318);

  class DragonThrownaxeCombatMethod extends RangedCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
    }

    handleAfterHitEffects(hit) {
      if (hit.isAccurate()) {
        hit.getTarget().performGraphic(IMPACT_GRAPHIC);
      }
    }
  }

  api.registerCombatSpecial({
    id: "dragon_thrownaxe",
    itemIds: [ItemIdentifiers.DRAGON_THROWNAXE],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      accuracyMultiplier: 1.25,
      rollAttackType: "ranged",
      damageType: "ranged",
      bypassAttackDelay: true,
    },
    combatMethod: new DragonThrownaxeCombatMethod(),
  });
};
