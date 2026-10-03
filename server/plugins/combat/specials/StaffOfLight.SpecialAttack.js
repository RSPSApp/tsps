// TODO: ported from xrsps-typescript; untested.
module.exports = function registerStaffOfLightSpecialAttack(api) {
  const { Animation, CombatMethod, CombatSpecial, CombatType, Graphic, ItemIdentifiers } = api.core;

  const DRAIN = 100;
  const SPECIAL_ANIMATION = new Animation(7967);
  const SPECIAL_VFX = new Graphic(1516);

  // Power of Death is a utility special: half incoming melee damage for 100 ticks.
  class StaffOfLightCombatMethod extends CombatMethod {
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
    id: "staff_of_light",
    itemIds: [ItemIdentifiers.STAFF_OF_LIGHT],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { skipAttack: true },
    combatMethod: new StaffOfLightCombatMethod(),
  });
};
