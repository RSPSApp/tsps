// Spear Wall (https://oldschool.runescape.wiki/w/Vesta%27s_spear): 50% energy. The first hit rolls up to
// the full max hit; two ticks later a second hit deals 50-75% of the first one's damage. For 8 ticks
// from the use the wielder is immune to melee and ranged hits, even after swapping weapons, and a
// successful hit takes one tick off their next attack delay. The Deadman variant keeps its own file.
module.exports = function registerVestasSpearBhSpecialAttack(api) {
  const { Animation, CombatSpecial, CombatType, Graphic, ItemIdentifiers, MeleeCombatMethod, World } = api.core;

  const DRAIN = 50;
  const SPECIAL_ANIMATION = new Animation(8184);
  const SPECIAL_VFX = new Graphic(1627);
  const SECOND_HIT_DELAY_TICKS = 2;
  const SECOND_HIT_MINIMUM = 0.5;
  const SECOND_HIT_MAXIMUM = 0.75;
  const IMMUNITY_TICKS = 8;
  const ATTACK_DELAY_REDUCTION = 1;
  const IMMUNE_UNTIL_ATTRIBUTE = "vestas-spear:immune-until";

  /** The first hit as rolled, then a second of 50-75% of it. */
  function spearWallDamage(rolledDamage) {
    const fraction = SECOND_HIT_MINIMUM + Math.random() * (SECOND_HIT_MAXIMUM - SECOND_HIT_MINIMUM);
    return [rolledDamage, Math.floor(rolledDamage * fraction)];
  }

  function immune(player) {
    return World.getProcessCycle() < (player.getAttribute?.(IMMUNE_UNTIL_ATTRIBUTE) ?? 0);
  }

  /** Melee and ranged hits do nothing to a wielder inside the 8 ticks; magic is not mentioned. */
  function blockPhysicalHits({ player, hit }) {
    const type = hit.getCombatType?.();
    if (immune(player) && (type === CombatType.MELEE || type === CombatType.RANGED)) hit.setTotalDamage(0);
  }

  class VestasSpearBhCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
      character.setAttribute(IMMUNE_UNTIL_ATTRIBUTE, World.getProcessCycle() + IMMUNITY_TICKS);
    }

    handleAfterHitEffects(hit) {
      if (!hit.isAccurate() || Math.floor(hit.getTotalDamage()) <= 0) return;
      const combat = hit.getAttacker().getCombat();
      combat.setAttackDelay(combat.getAttackDelay() - ATTACK_DELAY_REDUCTION);
    }
  }

  api.registerCombatSpecial({
    id: "vestas_spear_bh",
    itemIds: [ItemIdentifiers.VESTAS_SPEAR_BH_],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 2,
      hitDelayTicks: [0, SECOND_HIT_DELAY_TICKS],
      accuracyMultiplier: 1,
      damageMultiplier: 1,
      rollAttackType: "melee",
      damageType: "melee",
      firstSuccessfulAccuracyDamageRanges: [
        {
          minimumDamageMultiplier: 0,
          maximumDamageMultiplier: 1,
          hitDamageMultipliers: [1, 0],
          distributeDamage: spearWallDamage,
        },
      ],
      allMissDamagePatterns: [[0, 0]],
    },
    combatMethod: new VestasSpearBhCombatMethod(),
  });

  api.onPlayerHitModify(blockPhysicalHits);
};
