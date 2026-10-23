/** Wiki: Hamstring multiplies the target's running drain by six for one minute. */
const HAMSTRING_ATTRIBUTE = "morrigans-throwing-axe:hamstring-until";
const DURATION_MS = 60_000;

function hamstringDrain(player, drain) {
  return Number(player.getAttribute(HAMSTRING_ATTRIBUTE) ?? 0) > Date.now() ? drain * 6 : drain;
}
function buildMorrigansThrowingAxeBhSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, GraphicHeight, ItemIdentifiers, RangedCombatMethod } = api.core;

  const DRAIN = 50;
  const SPECIAL_ANIMATION = new Animation(11468);
  const SPECIAL_VFX = new Graphic(2921, 0, GraphicHeight.HIGH);
  const IMPACT_GRAPHIC = new Graphic(2922);
  const ACCURACY_MULTIPLIER = 1.5;
  const MINIMUM_DAMAGE_MULTIPLIER = 0.5;
  const MAXIMUM_DAMAGE_MULTIPLIER = 1.5;

  class MorrigansThrowingAxeBhCombatMethod extends RangedCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
    }

    handleAfterHitEffects(hit) {
      if (hit.isAccurate()) {
        hit.getTarget().performGraphic(IMPACT_GRAPHIC);
      }
      if (!hit.isAccurate() || Math.floor(hit.getTotalDamage()) <= 0) {
        return;
      }
      const target = hit.getTarget();
      if (!target.isPlayer()) {
        return;
      }
      const targetPlayer = target.getAsPlayer();

      targetPlayer.setAttribute(HAMSTRING_ATTRIBUTE, Date.now() + DURATION_MS);
      targetPlayer.sendMessage("You've been hamstrung! For the next minute, your run energy will drain 6x faster.");
    }
  }

  return {
    id: "morrigans_throwing_axe_bh",
    itemIds: [
      ItemIdentifiers.MORRIGANS_THROWING_AXE,
      ItemIdentifiers.MORRIGANS_THROWING_AXE_2,
      ItemIdentifiers.MORRIGANS_THROWING_AXE_BH_,
      ItemIdentifiers.MORRIGANS_THROWING_AXE_BH__2,
    ],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: ACCURACY_MULTIPLIER,
    traits: {
      hitCount: 1,
      accuracyMultiplier: ACCURACY_MULTIPLIER,
      minimumDamageMultiplier: MINIMUM_DAMAGE_MULTIPLIER,
      maximumDamageMultiplier: MAXIMUM_DAMAGE_MULTIPLIER,
    },
    combatMethod: new MorrigansThrowingAxeBhCombatMethod(),
  };
}

module.exports = function registerMorrigansThrowingAxeBhSpecialAttack(api) {
  api.registerCombatSpecial(buildMorrigansThrowingAxeBhSpecialAttack(api));
  api.registerRunEnergyDrainModifier(hamstringDrain);
};
