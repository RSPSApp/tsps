// TODO: ported from xrsps-typescript; untested.
module.exports = function registerToxicStaffOfTheDeadSpecialAttack(api) {
  const { Animation, CombatMethod, CombatSpecial, CombatType, Graphic, ItemIdentifiers } = api.core;

  const DRAIN = 100;
  const SPECIAL_ANIMATION = new Animation(1719);
  const SPECIAL_VFX = new Graphic(1228);

  // Power of Death is a utility special: half incoming melee damage for 100 ticks.
  class ToxicStaffOfTheDeadCombatMethod extends CombatMethod {
    hits() {
      return null;
    }

    type() {
      return CombatType.MAGIC;
    }

    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
      // TODO: Power of Death (halve incoming melee damage for 100 ticks) has no
      // core incoming-damage hook; the defensive effect is not applied.
    }
  }

  api.registerCombatSpecial({
    id: "toxic_staff_of_the_dead",
    itemIds: [ItemIdentifiers.TOXIC_STAFF_OF_THE_DEAD],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { skipAttack: true },
    combatMethod: new ToxicStaffOfTheDeadCombatMethod(),
  });
};
