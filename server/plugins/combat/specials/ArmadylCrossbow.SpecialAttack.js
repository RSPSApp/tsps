// TODO: ported from xrsps-typescript; untested.
module.exports = function registerArmadylCrossbowSpecialAttack(api) {
  const { Animation, CombatFactory, CombatSpecial, ItemIdentifiers, PendingHit, Projectile, RangedCombatMethod, RangedWeapon, Sound, Sounds } = api.core;

  const DRAIN = 50;
  const ARMADYL_EYE_ACCURACY_MULTIPLIER = 2;
  const ARMADYL_EYE_BOLT_CHANCE_MULTIPLIER = 2;
  const ANIMATION = new Animation(4230);
  // SpotanimID.ACB_SPECIALATTACK. Captured (recording 3277): start 41, end 75 at both 7 and
  // 8 tiles, angle 5, progress 11, heights 155 -> 146. The special is a flat 75, not the
  // normal crossbow's 46 + 5 a tile.
  const SPECIAL_PROJECTILE = 301;
  const SHOT = { delay: 41, speed: 75, startHeight: 38.75, endHeight: 36.5, angle: 5, progress: 11 };

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
      Sounds.playAreaSoundAt(character, Sound.ARMADYL_CROSSBOW_SPECIAL, 1);
      const distance = character.getLocation().getDistance(target.getLocation());
      const end = RangedCombatMethod.projectileEnd(SHOT, distance);
      Projectile.createProjectile(
        character,
        target,
        SPECIAL_PROJECTILE,
        SHOT.delay,
        end,
        SHOT.startHeight,
        SHOT.endHeight,
      ).withAngle(SHOT.angle).withProgress(SHOT.progress).sendProjectile();
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
