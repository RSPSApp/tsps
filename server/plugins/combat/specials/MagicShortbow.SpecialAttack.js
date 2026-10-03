// TODO: ported from xrsps-typescript; untested.
module.exports = function registerMagicShortbowSpecialAttack(api) {
  const { Animation, CombatFactory, CombatSpecial, Graphic, GraphicHeight, ItemIdentifiers, Projectile, RangedCombatMethod, RangedWeapon, Sound, Sounds } = api.core;

  const DRAIN = 55;
  const ACCURACY_MULTIPLIER = 10 / 7;
  const ANIMATION = new Animation(1074);
  const GRAPHIC = new Graphic(250, GraphicHeight.HIGH);

  class MagicShortbowCombatMethod extends RangedCombatMethod {
    canAttack(character, target) {
      const player = character.getAsPlayer();
      if (player.getCombat().getRangedWeapon() != RangedWeapon.MAGIC_SHORTBOW) {
        return false;
      }
      if (!CombatFactory.checkAmmo(player, 2)) {
        return false;
      }
      return true;
    }

    start(character, target) {
      const player = character.getAsPlayer();
      CombatSpecial.drain(player, DRAIN);
      player.performAnimation(ANIMATION);
      player.performGraphic(GRAPHIC);
      Sounds.sendSound(player, Sound.MAGIC_SHORTBOW_SPECIAL);
      Projectile.createProjectile(player, target, 249, 40, 57, 43, 31).sendProjectile();
      Projectile.createProjectile(character, target, 249, 33, 57, 48, 31).sendProjectile();
      CombatFactory.decrementAmmo(player, target.getLocation(), 2);
    }

    attackSpeed(character) {
      return super.attackSpeed(character) + 1;
    }
  }

  // TODO: Snapshot's max hit is a standalone formula (visible Ranged level and
  // equipped ammo Ranged Strength) exposed upstream as maxHitOverride; our
  // plugin core has no ammo-bonus/trait-at-attack hook to compute it.
  // TODO: the (i) variant drains 50%, but a single registration covers 55.
  api.registerCombatSpecial({
    id: "magic_shortbow",
    itemIds: [
      ItemIdentifiers.MAGIC_SHORTBOW,
      ItemIdentifiers.MAGIC_SHORTBOW_I_,
      ItemIdentifiers.MAGIC_SHORTBOW_3,
    ],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: ACCURACY_MULTIPLIER,
    traits: {
      hitCount: 2,
      accuracyMultiplier: ACCURACY_MULTIPLIER,
      damageMultiplier: 1,
    },
    combatMethod: new MagicShortbowCombatMethod(),
    metadata: { finisherDamageMultiplier: 2 },
  });
};
