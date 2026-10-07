// Binding Tentacle (https://oldschool.runescape.wiki/w/Abyssal_tentacle):
// 50% special energy, an 8-tick bind (4.8s) and a ~50% chance to poison for 4
// damage. Both the bind and the poison apply on activation, hit or miss.
module.exports = function registerAbyssalTentacleSpecialAttack(api) {
  const { Animation, CombatFactory, CombatSpecial, Graphic, GraphicHeight, ItemIdentifiers, MeleeCombatMethod, Misc, Sounds } = api.core;

  const DRAIN = 50;
  const ACCURACY_MULTIPLIER = 1.25;
  const BIND_DURATION_TICKS = 8;
  const POISON_CHANCE = 0.5;
  const POISON_POTENCY = 4;
  const POISON_ORB_TYPE = 1;
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
      if (Math.random() < POISON_CHANCE) {
        CombatFactory.poisonEntity(target, POISON_POTENCY, POISON_ORB_TYPE);
      }
    }
  }

  api.registerCombatSpecial({
    id: "abyssal_tentacle",
    itemIds: [ItemIdentifiers.ABYSSAL_TENTACLE, ItemIdentifiers.ABYSSAL_TENTACLE_OR_],
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
