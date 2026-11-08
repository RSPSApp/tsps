module.exports = function registerMagicLongbowSpecialAttack(api) {
  const { Animation, CombatFactory, CombatPosition, CombatSpecial, Equipment, Graphic, ItemIdentifiers, Misc, PendingHit, Projectile, RangedCombatMethod, Skill, Sound, Sounds, WeaponProfiles } = api.core;

  const DRAIN = 35;
  const RANGED_STRENGTH_BONUS_INDEX = 11;

  // RSProx 4017 and 4031 (players wielding a magic longbow): Powershot plays the normal bow
  // draw (426) with the glowing arrow's launch spotanim (sp_attack_glow_arrow_launch, 250) in
  // slot 1 at height 96, and fires projectile 249 (sp_attack_glow_arrow_travel) from 41 to
  // 46 + 5 per tile, heights 163/146 quarter-units (40.75/36.5), angle 15, progress 11. The
  // shot replaces the ammunition's own draw graphic and projectile.
  const LAUNCH_GRAPHIC = new Graphic(250, 0, 96);
  const PROJECTILE_ID = 249;
  const PROJECTILE = { delay: 41, lengthAdjustment: 5, stepMultiplier: 5, startHeight: 40.75, endHeight: 36.5 };

  // Powershot uses the visible Ranged level and only the equipped arrow's Ranged Strength.
  function resolvePowershotMaxHit(player) {
    const level = player.getSkillManager().getCurrentLevel(Skill.RANGED);
    const ammo = player.getEquipment().get(Equipment.AMMUNITION_SLOT);
    const strength = ammo?.getDefinition?.()?.getBonuses?.()?.[RANGED_STRENGTH_BONUS_INDEX] ?? 0;
    return Math.max(0, Math.floor(0.5 + ((level + 10) * (strength + 64)) / 640));
  }

  function isMagicCompBow(player) {
    const weaponId = player.getEquipment().get(Equipment.WEAPON_SLOT).getId();
    return (
      weaponId === ItemIdentifiers.MAGIC_COMP_BOW ||
      weaponId === ItemIdentifiers.MAGIC_COMP_BOW_2 ||
      weaponId === ItemIdentifiers.MAGIC_COMP_BOW_3
    );
  }

  class MagicLongbowCombatMethod extends RangedCombatMethod {
    hits(character, target) {
      const player = character.getAsPlayer();
      const delay = RangedCombatMethod.playerHitDelays(character, target, CombatPosition.projectileDistance(character, target))[0];
      // Supply the custom roll before the shared pipeline applies protection
      // prayers and defensive equipment. Powershot guarantees accuracy, not
      // unmitigated damage.
      return [new PendingHit(character, target, this, {
        delay,
        rollAccuracy: false,
        damage: Misc.randomInclusive(0, resolvePowershotMaxHit(player)),
      })];
    }

    attackSpeed(character) {
      const player = character.getAsPlayer();
      const base = super.attackSpeed(character);
      return isMagicCompBow(player) ? base + 1 : base;
    }

    start(character, target) {
      const player = character.getAsPlayer();
      CombatSpecial.drain(character, DRAIN);
      const animation = character.getAttackAnim(target);
      if (animation !== -1) character.performAnimation(new Animation(animation));
      character.performGraphicInSlot(1, LAUNCH_GRAPHIC);

      const end = RangedCombatMethod.projectileEnd(PROJECTILE, CombatPosition.edgeDistance(character, target));
      Projectile.createProjectile(character, target, PROJECTILE_ID, PROJECTILE.delay, end, PROJECTILE.startHeight, PROJECTILE.endHeight)
        .withAngle(15).withProgress(11).sendProjectile();
      Sounds.sendSound(character, this.fireSound(character));

      // The arrow is consumed when the hit lands, like an ordinary shot.
      const flightTicks = Math.max(1, ...RangedCombatMethod.landingDelays(character, target).map((ticks) => ticks + (target.isNpc() ? 1 : 0)));
      CombatFactory.decrementAmmo(player, target.getLocation(), WeaponProfiles.ranged(player)?.ammoRequired ?? 1, flightTicks);
    }

    fireSound() {
      return Sound.MAGIC_LONGBOW_SPECIAL;
    }
  }

  api.registerCombatSpecial({
    id: "magic_longbow",
    itemIds: [
      ItemIdentifiers.MAGIC_LONGBOW,
      ItemIdentifiers.MAGIC_LONGBOW_2,
      ItemIdentifiers.MAGIC_LONGBOW_3,
      ItemIdentifiers.MAGIC_COMP_BOW,
      ItemIdentifiers.MAGIC_COMP_BOW_2,
      ItemIdentifiers.MAGIC_COMP_BOW_3,
    ],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      accuracyMultiplier: 1,
      damageMultiplier: 1,
      guaranteedHit: true,
      rollAttackType: "ranged",
      damageType: "ranged",
    },
    combatMethod: new MagicLongbowCombatMethod(),
  });
};
