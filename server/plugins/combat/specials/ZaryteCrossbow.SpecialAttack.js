// TODO: ported from xrsps-typescript; untested.
module.exports = function registerZaryteCrossbowSpecialAttack(api) {
  const { Animation, CombatFactory, CombatSpecial, ItemIdentifiers, PendingHit, Projectile, RangedCombatMethod, RangedWeapon, Sound, Sounds, WeaponProfiles } = api.core;

  const DRAIN = 75;
  const EVOKE_ACCURACY_MULTIPLIER = 2;
  const ANIMATION = new Animation(9166);

  class ZaryteCrossbowCombatMethod extends RangedCombatMethod {
    hits(character, target) {
      return [new PendingHit(character, target, this, 2)];
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

      // Evoke is a normal bolt shot with doubled accuracy: use the equipped bolt's travel
      // spotanim on the crossbow's trajectory (44 + 5 a tile from 41). The old 301/44->35
      // ended before it started, so the client clamped it to a single cycle at the player.
      const profile = WeaponProfiles.ranged(player);
      const shot = profile?.projectiles?.[0] ?? { delay: 41, lengthAdjustment: 5, stepMultiplier: 5, startHeight: 38.75, endHeight: 36.5, angle: 5, progress: 11 };
      const distance = character.getLocation().getDistance(target.getLocation());
      const end = RangedCombatMethod.projectileEnd(shot, distance);
      const ammo = player.getCombat().getAmmunition();
      const projectile = Projectile.createProjectile(
        character,
        target,
        profile?.projectileId ?? ammo?.getProjectileId() ?? 27,
        shot.delay,
        end,
        shot.startHeight,
        shot.endHeight,
      );
      if (shot.angle != null) projectile.withAngle(shot.angle);
      if (shot.progress != null) projectile.withProgress(shot.progress);
      projectile.sendProjectile();
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
