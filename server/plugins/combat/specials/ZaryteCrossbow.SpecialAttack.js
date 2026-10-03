// TODO: ported from xrsps-typescript; untested.
module.exports = function registerZaryteCrossbowSpecialAttack(api) {
  const { Animation, CombatFactory, CombatSpecial, ItemIdentifiers, PendingHit, Projectile, RangedCombatMethod, RangedWeapon, Sound, Sounds } = api.core;

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
      Projectile.createProjectile(character, target, 301, 44, 35, 50, 70).sendProjectile();
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
