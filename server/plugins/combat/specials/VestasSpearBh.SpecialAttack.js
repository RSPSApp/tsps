// TODO: ported from xrsps-typescript; untested.
module.exports = function registerVestasSpearBhSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod } = api.core;

  const DRAIN = 50;
  const SPECIAL_ANIMATION = new Animation(8184);
  const SPECIAL_VFX = new Graphic(1627);

  class VestasSpearBhCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
    }
  }

  api.registerCombatSpecial({
    id: "vestas_spear_bh",
    itemIds: [ItemIdentifiers.VESTAS_SPEAR_BH_],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      accuracyMultiplier: 1,
      damageMultiplier: 1,
      rollAttackType: "melee",
      damageType: "melee",
    },
    combatMethod: new VestasSpearBhCombatMethod(),
  });
};
