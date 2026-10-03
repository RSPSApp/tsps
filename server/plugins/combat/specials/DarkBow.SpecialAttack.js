// TODO: ported from xrsps-typescript; untested.
module.exports = function registerDarkBowSpecialAttack(api) {
  const { Ammunition, Animation, CombatFactory, CombatSpecial, Graphic, GraphicHeight, ItemIdentifiers, PendingHit, Projectile, RangedCombatMethod, RangedWeapon, Sound, Sounds, WeaponProfiles } = api.core;

  const DRAIN = 55;
  const HIT_COUNT = 2;
  const DESCENT_OF_DARKNESS_DAMAGE_MULTIPLIER = 1.3;
  const DESCENT_OF_DARKNESS_MINIMUM_DAMAGE = 5;
  const ANIMATION = new Animation(426);
  const GRAPHIC = new Graphic(1100, GraphicHeight.HIGH);

  class DarkBowCombatMethod extends RangedCombatMethod {
    hits(character, target) {
      const distance = character.getLocation().getDistance(target.getLocation());
      const delays = WeaponProfiles.hitDelays(character.getAsPlayer(), distance);
      // The dark bow profile already declares two hit delays; one PendingHit with
      // the special's hit count keeps this at two hitsplats instead of four.
      return [new PendingHit(character, target, this, { delay: delays[0], hitAmount: HIT_COUNT })];
    }

    canAttack(character, target) {
      let player = character.getAsPlayer();
      if (player.getCombat().getRangedWeapon() != RangedWeapon.DARK_BOW) {
        return false;
      }
      if (!CombatFactory.checkAmmo(player, HIT_COUNT)) {
        return false;
      }
      return true;
    }

    start(character, target) {
      let player = character.getAsPlayer();
      CombatSpecial.drain(player, DRAIN);
      player.performAnimation(ANIMATION);
      Sounds.sendSound(character, Sound.SHOOT_BOW_QUIET);
      let projectileId = 1099;
      if (player.getCombat().getAmmunition() != Ammunition.DRAGON_ARROW) {
        projectileId = 1101;
      }
      Projectile.createProjectile(player, target, projectileId, 40, 70, 43, 31).sendProjectile();
      Projectile.createProjectile(character, target, projectileId, 33, 74, 48, 31).sendProjectile();
      CombatFactory.decrementAmmo(player, target.getLocation(), HIT_COUNT);
    }

    attackSpeed(character) {
      return super.attackSpeed(character) + 1;
    }

    handleAfterHitEffects(hit) {
      hit.getTarget().performGraphic(GRAPHIC);
    }
  }

  // TODO: dragon arrows use Descent of Dragons (1.5x, minimum 8, cap 48);
  // the trait engine reads a fixed trait set per special, and the core dark bow
  // profile already clamps special damage to 8..48, so the non-dragon values
  // are registered here.
  api.registerCombatSpecial({
    id: "dark_bow",
    itemIds: [ItemIdentifiers.DARK_BOW],
    drainAmount: DRAIN,
    strengthMultiplier: DESCENT_OF_DARKNESS_DAMAGE_MULTIPLIER,
    accuracyMultiplier: 1,
    traits: {
      hitCount: HIT_COUNT,
      accuracyMultiplier: 1,
      damageMultiplier: DESCENT_OF_DARKNESS_DAMAGE_MULTIPLIER,
      minimumDamageBonus: DESCENT_OF_DARKNESS_MINIMUM_DAMAGE,
      rollAttackType: "ranged",
      damageType: "ranged",
    },
    combatMethod: new DarkBowCombatMethod(),
    metadata: { finisherDamageMultiplier: 2 },
  });
};
