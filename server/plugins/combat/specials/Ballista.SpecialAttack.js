module.exports = function registerBallistaSpecialAttack(api) {
  const { Animation, CombatFactory, CombatSpecial, Graphic, ItemIdentifiers, PendingHit, Projectile, RangedCombatMethod, RangedWeapon, Sound, Sounds, WeaponProfiles } = api.core;

  const DRAIN = 65;
  const ANIMATION = new Animation(7222);
  /** The ballista's impact burst (SpotanimID.BALLISTA_SPECIAL). */
  const IMPACT_GRAPHIC = 344;
  const IMPACT_HEIGHT = 177;

  class BallistaCombatMethod extends RangedCombatMethod {
    hits(character, target) {
      const distance = character.getLocation().getDistance(target.getLocation());
      const delay = WeaponProfiles.hitDelays(character.getAsPlayer(), distance)[0];
      return [new PendingHit(character, target, this, delay)];
    }

    canAttack(character, target) {
      if (!character.isPlayer()) {
        return false;
      }
      const player = character.getAsPlayer();
      if (player.getCombat().getRangedWeapon() !== RangedWeapon.BALLISTA) {
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
      character.performAnimation(ANIMATION);
      Sounds.sendSound(character, Sound.MAGIC_LONGBOW_SPECIAL);

      // Concentrated Shot is an ordinary javelin with +25% accuracy and damage: the same
      // projectile as the equipped ammunition, on the ballista's own trajectory, then its
      // burst where it lands. A hardcoded dragon javelin (1301) showed the wrong model, and
      // an end before the start made it vanish at the player after one cycle.
      const profile = WeaponProfiles.ranged(player);
      const shot = profile?.projectiles?.[0] ?? { delay: 42, lengthAdjustment: 2, stepMultiplier: 3, startHeight: 38.75, endHeight: 44.25, angle: 14, progress: 120 };
      const distance = character.getLocation().getDistance(target.getLocation());
      const end = RangedCombatMethod.projectileEnd(shot, distance);
      const ammo = player.getCombat().getAmmunition();
      const projectileId = profile?.projectileId ?? ammo?.getProjectileId() ?? 205;
      const projectile = Projectile.createProjectile(
        player,
        target,
        projectileId,
        shot.delay,
        end,
        shot.startHeight,
        shot.endHeight,
      );
      if (shot.angle != null) projectile.withAngle(shot.angle);
      if (shot.progress != null) projectile.withProgress(shot.progress);
      projectile.sendProjectile();
      target.performGraphic(new Graphic(IMPACT_GRAPHIC, end, IMPACT_HEIGHT));

      CombatFactory.decrementAmmo(player, target.getLocation(), 1);
    }
  }

  api.registerCombatSpecial({
    id: "ballista",
    itemIds: [
      ItemIdentifiers.LIGHT_BALLISTA,
      ItemIdentifiers.HEAVY_BALLISTA,
      ItemIdentifiers.LIGHT_BALLISTA_4,
      ItemIdentifiers.HEAVY_BALLISTA_OR_,
    ],
    drainAmount: DRAIN,
    strengthMultiplier: 1.25,
    accuracyMultiplier: 1.25,
    combatMethod: new BallistaCombatMethod(),
  });
};
