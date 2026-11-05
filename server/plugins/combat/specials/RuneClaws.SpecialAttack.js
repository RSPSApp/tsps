// TODO: ported from xrsps-typescript; untested.
// TODO: Impale special attack animation/graphic ids not found; skipped.
module.exports = function registerRuneClawsSpecialAttack(api) {
  const { Animation, CombatSpecial, ItemIdentifiers, MeleeCombatMethod, Sound, Sounds } = api.core;

  const DRAIN = 25;
  const LEVEL_MULTIPLIER = 1.1;
  const EXTRA_ATTACK_DELAY_TICKS = 2;

  class RuneClawsCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      // Impale keeps the claws' attack animation but has its own sound (Wiki: Impale.wav).
      const animation = character.getAttackAnim(target);
      if (animation !== -1) {
        character.performAnimation(new Animation(animation));
      }
      Sounds.playAreaSoundAt(character, Sound.RUNE_CLAWS_SPECIAL);
    }

    attackSpeed(character) {
      return super.attackSpeed(character) + EXTRA_ATTACK_DELAY_TICKS;
    }
  }

  api.registerCombatSpecial({
    id: "rune_claws",
    itemIds: [
      ItemIdentifiers.RUNE_CLAWS,
      ItemIdentifiers.RUNE_CLAWS_2,
      ItemIdentifiers.RUNE_CLAWS_3,
    ],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      accuracyMultiplier: 1,
      damageMultiplier: 1,
      attackLevelMultiplier: LEVEL_MULTIPLIER,
      strengthLevelMultiplier: LEVEL_MULTIPLIER,
      attackSpeedTicks: 6,
    },
    combatMethod: new RuneClawsCombatMethod(),
  });
};
