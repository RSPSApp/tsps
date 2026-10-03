// TODO: ported from xrsps-typescript; untested.
module.exports = function registerSaradominsBlessedSwordSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod, Priority } = api.core;

  const DRAIN = 65;
  const DAMAGE_MULTIPLIER = 1.25;
  const ANIMATION = new Animation(1133);
  const GRAPHIC = new Graphic(1204, Priority.HIGH);

  class SaradominsBlessedSwordCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(ANIMATION);
      character.performGraphic(GRAPHIC);
    }
  }

  api.registerCombatSpecial({
    id: "saradomins_blessed_sword",
    itemIds: [
      ItemIdentifiers.SARADOMINS_BLESSED_SWORD,
      ItemIdentifiers.SARADOMINS_BLESSED_SWORD_2,
    ],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      accuracyMultiplier: 1,
      damageMultiplier: DAMAGE_MULTIPLIER,
      rollAttackType: "melee",
      defenceRollAttackType: "magic",
      damageType: "magic",
      meleeAttackBonusIndex: 1,
      maximumHitSource: "magic",
    },
    combatMethod: new SaradominsBlessedSwordCombatMethod(),
  });
};
