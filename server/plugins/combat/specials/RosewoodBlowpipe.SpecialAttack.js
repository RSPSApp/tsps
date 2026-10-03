// TODO: ported from xrsps-typescript; untested.
module.exports = function registerRosewoodBlowpipeSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, RangedCombatMethod } = api.core;

  const DRAIN = 25;
  const SPECIAL_ANIMATION = new Animation(13145);
  const SPECIAL_VFX = new Graphic(3486);
  const ACCURACY_MULTIPLIER = 0.8;
  const DAMAGE_MULTIPLIER = 1.1;

  // Note: upstream used item id 31586 for the charged blowpipe; our constant named
  // ROSEWOOD_BLOWPIPE is 31583, so the charged ids below follow our naming.
  class RosewoodBlowpipeCombatMethod extends RangedCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
    }
  }

  api.registerCombatSpecial({
    id: "rosewood_blowpipe",
    itemIds: [ItemIdentifiers.ROSEWOOD_BLOWPIPE, ItemIdentifiers.ROSEWOOD_BLOWPIPE_2],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: ACCURACY_MULTIPLIER,
    traits: {
      hitCount: 2,
      accuracyMultiplier: ACCURACY_MULTIPLIER,
      damageMultiplier: DAMAGE_MULTIPLIER,
      rollAttackType: "ranged",
      damageType: "ranged",
      hitDelayTicks: [0, 1],
    },
    combatMethod: new RosewoodBlowpipeCombatMethod(),
  });
};
