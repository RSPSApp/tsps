// TODO: ported from xrsps-typescript; untested.
module.exports = function registerDragonScimitarSpecialAttack(api) {
  const { Animation, CombatFactory, CombatSpecial, Graphic, GraphicHeight, ItemIdentifiers, MeleeCombatMethod, Sounds } = api.core;

  const DRAIN = 55;
  const SEVER_ACCURACY_MULTIPLIER = 1.25;
  const ANIMATION = new Animation(1872);
  const GRAPHIC = new Graphic(347, GraphicHeight.HIGH);

  class DragonScimitarCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(ANIMATION);
      character.performGraphic(GRAPHIC);
      Sounds.sendSound(character, character.getAttackSound());
    }

    handleAfterHitEffects(hit) {
      if (!hit.isAccurate() || !hit.getTarget().isPlayer()) {
        return;
      }
      // TODO: xrsps locks protection prayers for 8 ticks; the core
      // CombatFactory.disableProtectionPrayers uses its own fixed block timer.
      CombatFactory.disableProtectionPrayers(hit.getTarget().getAsPlayer());
      hit.getAttacker().getAsPlayer().sendMessage("Your target can no longer use protection prayers.");
    }
  }

  api.registerCombatSpecial({
    id: "dragon_scimitar",
    itemIds: [
      ItemIdentifiers.DRAGON_SCIMITAR,
      ItemIdentifiers.DRAGON_SCIMITAR_OR_,
      ItemIdentifiers.DRAGON_SCIMITAR_3,
    ],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: SEVER_ACCURACY_MULTIPLIER,
    traits: {
      hitCount: 1,
      accuracyMultiplier: SEVER_ACCURACY_MULTIPLIER,
    },
    combatMethod: new DragonScimitarCombatMethod(),
  });
};
