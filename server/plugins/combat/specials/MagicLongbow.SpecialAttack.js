// TODO: ported from xrsps-typescript; untested.
// TODO: Powershot special attack animation/graphic ids not found; skipped.
module.exports = function registerMagicLongbowSpecialAttack(api) {
  const { CombatSpecial, Equipment, ItemIdentifiers, Misc, PendingHit, RangedCombatMethod, Skill, WeaponProfiles } = api.core;

  const DRAIN = 35;
  const RANGED_STRENGTH_BONUS_INDEX = 11;

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
      const distance = character.getLocation().getDistance(target.getLocation());
      const delay = WeaponProfiles.hitDelays(player, distance)[0];
      const hit = new PendingHit(character, target, this, delay);
      if (hit.isAccurate()) {
        hit.getHits()[0].setDamage(Misc.randomInclusive(0, resolvePowershotMaxHit(player)));
        hit.updateTotalDamage();
      }
      return [hit];
    }

    attackSpeed(character) {
      const player = character.getAsPlayer();
      const base = super.attackSpeed(character);
      return isMagicCompBow(player) ? base + 1 : base;
    }

    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
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
