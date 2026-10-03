module.exports = function registerDragonKnifeSpecialAttack(api) {
  const { Animation, CombatFactory, CombatSpecial, Equipment, ItemIdentifiers, PendingHit, Projectile, RangedCombatMethod, Sound, Sounds, WeaponProfiles } = api.core;

  const DRAIN = 25;
  const SPECIAL_AMMO_COST = 2;
  const ANIMATION = new Animation(8292);

  class DragonKnifeCombatMethod extends RangedCombatMethod {
    hits(character, target) {
      const distance = character.getLocation().getDistance(target.getLocation());
      const hitDelay = WeaponProfiles.hitDelays(character.getAsPlayer(), distance)[0];
      return [
        new PendingHit(character, target, this, hitDelay),
        new PendingHit(character, target, this, hitDelay),
      ];
    }

    canAttack(character, target) {
      if (!character.isPlayer()) {
        return false;
      }
      const player = character.getAsPlayer();
      const weaponId = player.getEquipment().get(Equipment.WEAPON_SLOT).getId();
      if (!(weaponId === ItemIdentifiers.DRAGON_KNIFE
        || weaponId === ItemIdentifiers.DRAGON_KNIFE_P_
        || weaponId === ItemIdentifiers.DRAGON_KNIFE_P_PLUS_
        || weaponId === ItemIdentifiers.DRAGON_KNIFE_P_PLUS_PLUS_)) {
        return false;
      }
      return CombatFactory.checkAmmo(player, SPECIAL_AMMO_COST);
    }

    start(character, target) {
      const player = character.getAsPlayer();
      CombatSpecial.drain(player, DRAIN);
      player.performAnimation(ANIMATION);
      Sounds.sendSound(character, Sound.THROW_DART);
      Projectile.createProjectile(character, target, 1629, 30, 60, 40, 36).sendProjectile();
      Projectile.createProjectile(character, target, 1629, 26, 64, 43, 36).sendProjectile();
      CombatFactory.decrementAmmo(player, target.getLocation(), SPECIAL_AMMO_COST);
    }
  }

  api.registerCombatSpecial({
    id: "dragon_knife",
    itemIds: [
      ItemIdentifiers.DRAGON_KNIFE,
      ItemIdentifiers.DRAGON_KNIFE_P_,
      ItemIdentifiers.DRAGON_KNIFE_P_PLUS_,
      ItemIdentifiers.DRAGON_KNIFE_P_PLUS_PLUS_,
    ],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    combatMethod: new DragonKnifeCombatMethod(),
  });
};
