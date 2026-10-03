// TODO: ported from xrsps-typescript; untested.
module.exports = function registerAbyssalTentacleSpecialAttack(api) {
  const { Animation, CombatFactory, CombatSpecial, Graphic, GraphicHeight, ItemIdentifiers, MeleeCombatMethod, Misc, Sounds } = api.core;

  const DRAIN = 50;
  const ACCURACY_MULTIPLIER = 1.25;
  const BIND_DURATION_TICKS = 8;
  const POISON_CHANCE_PERCENT = 50;
  const POISON_POTENCY = 4;
  const SLASH_BONUS_INDEX = 1;
  const ANIMATION = new Animation(1658);
  const GRAPHIC = new Graphic(181, GraphicHeight.HIGH);

  class AbyssalTentacleCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(ANIMATION);
      Sounds.sendSound(character, character.getAttackSound());

      // Binding Tentacle binds and poisons on activation, so even an inaccurate
      // special still applies both rolls.
      if (!target) {
        return;
      }
      target.performGraphic(GRAPHIC);
      CombatFactory.freeze(target, Misc.getSeconds(BIND_DURATION_TICKS));
      if (Misc.getRandom(100) < POISON_CHANCE_PERCENT) {
        CombatFactory.poisonEntity(target, POISON_POTENCY);
      }
    }
  }

  api.registerCombatSpecial({
    id: "abyssal_tentacle",
    itemIds: [ItemIdentifiers.ABYSSAL_TENTACLE],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: ACCURACY_MULTIPLIER,
    traits: {
      hitCount: 1,
      accuracyMultiplier: ACCURACY_MULTIPLIER,
      meleeAttackBonusIndex: SLASH_BONUS_INDEX,
      meleeDefenceBonusIndex: SLASH_BONUS_INDEX,
    },
    combatMethod: new AbyssalTentacleCombatMethod(),
  });
};
