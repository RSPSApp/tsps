// TODO: ported from xrsps-typescript; untested.
module.exports = function registerZaryteCrossbowSpecialAttack(api) {
  const { Animation, CombatFactory, CombatPosition, CombatSpecial, ItemIdentifiers, PendingHit, Projectile, RangedCombatMethod, RangedWeapon, Sound, Sounds } = api.core;

  const DRAIN = 75;
  const EVOKE_ACCURACY_MULTIPLIER = 2;
  const ANIMATION = new Animation(9166);
  const SPECIAL_PROJECTILE = 1995;
  const SHOT = { delay: 41, speed: 75, startHeight: 44, endHeight: 36.5, angle: 5, progress: 11 };

  class ZaryteCrossbowCombatMethod extends RangedCombatMethod {
    hits(character, target) {
      if (character.getLocation().getZ() === target.getLocation().getZ()) {
        return [new PendingHit(character, target, this, 2)];
      }
      const distance = CombatPosition.projectileDistance(character, target);
      const delay = RangedCombatMethod.playerHitDelays(character, target, distance)[0];
      return [new PendingHit(character, target, this, Math.max(2, delay))];
    }

    canAttack(character, target) {
      if (!character.isPlayer()) {
        return false;
      }
      const player = character.getAsPlayer();
      if (player.getCombat().getRangedWeapon() !== RangedWeapon.ZARYTE_CROSSBOW) {
        return false;
      }
      return CombatFactory.checkAmmo(player, 1);
    }

    start(character, target) {
      const player = character.getAsPlayer();
      CombatSpecial.drain(player, DRAIN);
      player.performAnimation(ANIMATION);
      Sounds.sendSound(character, Sound.SHOOT_CROSSBOW);

      // Evoke flies its own zcb_specialattack spotanim on a flat path, as Armadyl Eye does:
      // rsprox_transcripts/227/01752.txt shows 1995, start 41, end 75, angle 5, heights 44->36.
      const distance = CombatPosition.projectileDistance(character, target);
      Projectile.createProjectile(
        character,
        target,
        SPECIAL_PROJECTILE,
        SHOT.delay,
        RangedCombatMethod.projectileEnd(SHOT, distance),
        SHOT.startHeight,
        SHOT.endHeight,
      ).withAngle(SHOT.angle).withProgress(SHOT.progress).sendProjectile();
      CombatFactory.decrementAmmo(player, target.getLocation(), 1);
    }
  }

  api.registerCombatSpecial({
    id: "zaryte_crossbow",
    itemIds: [ItemIdentifiers.ZARYTE_CROSSBOW],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: EVOKE_ACCURACY_MULTIPLIER,
    traits: {
      hitCount: 1,
      rollAttackType: "ranged",
      damageType: "ranged",
      accuracyMultiplier: EVOKE_ACCURACY_MULTIPLIER,
      guaranteedEnchantedBoltEffect: true,
    },
    combatMethod: new ZaryteCrossbowCombatMethod(),
  });
};
