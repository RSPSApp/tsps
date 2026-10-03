// TODO: ported from xrsps-typescript; untested.
module.exports = function registerArmadylCrossbowSpecialAttack(api) {
  const { Animation, CombatFactory, CombatSpecial, ItemIdentifiers, PendingHit, Projectile, RangedCombatMethod, RangedWeapon, Sound, Sounds } = api.core;

  const DRAIN = 50;
  const ARMADYL_EYE_ACCURACY_MULTIPLIER = 2;
  const ARMADYL_EYE_BOLT_CHANCE_MULTIPLIER = 2;
  const ANIMATION = new Animation(4230);

  class ArmadylCrossbowCombatMethod extends RangedCombatMethod {
    hits(character, target) {
      return [new PendingHit(character, target, this, 2)];
    }

    canAttack(character, target) {
      const player = character.getAsPlayer();
      if (player.getCombat().getRangedWeapon() != RangedWeapon.ARMADYL_CROSSBOW) {
        return false;
      }
      if (!CombatFactory.checkAmmo(player, 1)) {
        return false;
      }
      return true;
    }

    start(character, target) {
      const player = character.getAsPlayer();
      CombatSpecial.drain(player, DRAIN);
      player.performAnimation(ANIMATION);
      Sounds.sendSound(character, Sound.SHOOT_CROSSBOW);
      Projectile.createProjectile(character, target, 301, 50, 70, 44, 35).sendProjectile();
      CombatFactory.decrementAmmo(player, target.getLocation(), 1);
    }
  }

  api.registerCombatSpecial({
    id: "armadyl_crossbow",
    itemIds: [ItemIdentifiers.ARMADYL_CROSSBOW],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: ARMADYL_EYE_ACCURACY_MULTIPLIER,
    traits: {
      hitCount: 1,
      accuracyMultiplier: ARMADYL_EYE_ACCURACY_MULTIPLIER,
      enchantedBoltEffectChanceMultiplier: ARMADYL_EYE_BOLT_CHANCE_MULTIPLIER,
    },
    combatMethod: new ArmadylCrossbowCombatMethod(),
  });
};
