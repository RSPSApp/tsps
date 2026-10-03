// TODO: ported from xrsps-typescript; untested.
module.exports = function registerDragonCrossbowSpecialAttack(api) {
  const { CombatSpecial, Graphic, ItemIdentifiers, RangedCombatMethod } = api.core;

  const DRAIN = 60;
  const IMPACT_GRAPHIC = new Graphic(1468);

  // Annihilate deals 20% extra damage to the primary target.
  // TODO: the eight-target surrounding sweep and enchanted-bolt suppression
  // need engagement-level area targeting / projectile-proc hooks.
  class DragonCrossbowCombatMethod extends RangedCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
    }

    handleAfterHitEffects(hit) {
      if (hit.isAccurate()) {
        hit.getTarget().performGraphic(IMPACT_GRAPHIC);
      }
    }
  }

  api.registerCombatSpecial({
    id: "dragon_crossbow",
    itemIds: [ItemIdentifiers.DRAGON_CROSSBOW],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { hitCount: 1, damageMultiplier: 1.2 },
    combatMethod: new DragonCrossbowCombatMethod(),
  });
};
