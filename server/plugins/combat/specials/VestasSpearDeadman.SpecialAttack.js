// TODO: ported from xrsps-typescript; untested.
module.exports = function registerVestasSpearDeadmanSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod } = api.core;

  const DRAIN = 50;
  const SPECIAL_ANIMATION = new Animation(8184);
  const SPECIAL_VFX = new Graphic(1627);

  // Spear Wall's unmodified primary roll; the multi-target sweep (up to 16
  // targets in multi-combat) and 8-tick melee immunity are not ported.
  class VestasSpearDeadmanCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
    }
  }

  api.registerCombatSpecial({
    id: "vestas_spear_deadman",
    itemIds: [ItemIdentifiers.VESTAS_SPEAR],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { hitCount: 1 },
    combatMethod: new VestasSpearDeadmanCombatMethod(),
  });
};
