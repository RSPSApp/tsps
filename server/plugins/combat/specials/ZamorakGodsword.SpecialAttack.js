module.exports = function registerZamorakGodswordSpecialAttack(api) {
  const { Animation, CombatFactory, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod, PendingHit, Priority, Sounds } = api.core;

  const DRAIN = 50;
  const ANIMATION = new Animation(7638);
  const GRAPHIC = new Graphic(1210, Priority.HIGH);

  class ZamorakGodswordCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(ANIMATION);
      Sounds.sendSound(character, character.getAttackSound());
    }

    handleAfterHitEffects(hit) {
      if (hit.isAccurate()) {
        hit.getTarget().performGraphic(GRAPHIC);
        CombatFactory.freeze(hit.getTarget(), 15);
      }
    }
  }

  api.registerCombatSpecial({
    id: "zamorak_godsword",
    itemIds: [ItemIdentifiers.ZAMORAK_GODSWORD],
    drainAmount: DRAIN,
    strengthMultiplier: 1.1,
    accuracyMultiplier: 2,
    combatMethod: new ZamorakGodswordCombatMethod(),
  });
};
