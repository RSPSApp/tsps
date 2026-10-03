// TODO: ported from xrsps-typescript; untested.
module.exports = function registerSoulflameHornSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod } = api.core;

  const DRAIN = 25;
  const SPECIAL_ANIMATION = new Animation(12150);
  const SPECIAL_VFX = new Graphic(3282);
  const IMPACT_GRAPHIC = new Graphic(3283);

  class SoulflameHornCombatMethod extends MeleeCombatMethod {
    hits() {
      return null;
    }

    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
      // TODO: Entice should grant the user and up to three nearby allies a buff that
      // raises the next melee accuracy roll, spending 25% energy per affected player.
      // No nearby-ally buff hook is exposed, so only the base cost is drained here.
    }

    handleAfterHitEffects(hit) {
      if (hit.isAccurate()) {
        hit.getTarget().performGraphic(IMPACT_GRAPHIC);
      }
    }
  }

  api.registerCombatSpecial({
    id: "soulflame_horn",
    itemIds: [
      ItemIdentifiers.SOULFLAME_HORN,
      ItemIdentifiers.SOULFLAME_HORN_2,
      ItemIdentifiers.SOULFLAME_HORN_3,
    ],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { skipAttack: true },
    combatMethod: new SoulflameHornCombatMethod(),
  });
};
