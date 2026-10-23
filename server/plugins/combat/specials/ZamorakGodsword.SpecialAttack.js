module.exports = function registerZamorakGodswordSpecialAttack(api) {
  const { Animation, CombatFactory, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod, PendingHit, Priority, Sounds } = api.core;

  const DRAIN = 50;
  const FREEZE_SECONDS = 19.2; // 32 ticks, as Ice Barrage
  const SLASH_DEFENCE_BONUS_INDEX = 1;
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
        CombatFactory.freeze(hit.getTarget(), FREEZE_SECONDS);
      }
    }
  }

  api.registerCombatSpecial({
    id: "zamorak_godsword",
    itemIds: [ItemIdentifiers.ZAMORAK_GODSWORD],
    drainAmount: DRAIN,
    strengthMultiplier: 1.1,
    accuracyMultiplier: 2,
    traits: {
      hitCount: 1,
      accuracyMultiplier: 2,
      damageMultiplier: 1.1,
      meleeDefenceBonusIndex: SLASH_DEFENCE_BONUS_INDEX,
    },
    combatMethod: new ZamorakGodswordCombatMethod(),
  });
};
