module.exports = function registerBallistaSpecialAttack(api) {
  const { Animation, CombatFactory, CombatSpecial, ItemIdentifiers, PendingHit, Projectile, RangedCombatMethod, RangedWeapon, Sound, Sounds, WeaponProfiles } = api.core;

  const DRAIN = 65;
  const ANIMATION = new Animation(7222);

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
      Sounds.sendSound(character, Sound.SHOOT_CROSSBOW);
      Projectile.createProjectile(player, target, 1301, 70, 30, 43, 31).sendProjectile();
      CombatFactory.decrementAmmo(player, target.getLocation(), 1);
    }
  }

  api.registerCombatSpecial({
    id: "ballista",
    itemIds: [ItemIdentifiers.LIGHT_BALLISTA, ItemIdentifiers.HEAVY_BALLISTA],
    drainAmount: DRAIN,
    strengthMultiplier: 1.25,
    accuracyMultiplier: 1.25,
    combatMethod: new BallistaCombatMethod(),
  });
};
