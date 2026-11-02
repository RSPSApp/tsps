// TODO: Soulshot special attack animation/graphic ids not found; skipped.
function buildSpecial(core) {
  const { CombatSpecial, Equipment, ItemIdentifiers, Misc, PendingHit, RangedCombatMethod, Skill, Sound, WeaponProfiles } = core;

  const DRAIN = 100;
  const RANGED_STRENGTH_BONUS_INDEX = 11;

  // Soulshot ignores stance, prayer and equipment bonuses other than the arrow.
  // https://oldschool.runescape.wiki/w/Seercull
  function soulshotMaxHit(player) {
    const level = player.getSkillManager().getCurrentLevel(Skill.RANGED);
    const ammo = player.getEquipment().get(Equipment.AMMUNITION_SLOT);
    const strength = ammo?.getDefinition()?.getBonuses()?.[RANGED_STRENGTH_BONUS_INDEX] ?? 0;
    return Math.max(0, Math.floor(0.5 + ((level + 10) * (strength + 64)) / 640));
  }

  function soulshot(target, damage) {
    if (damage <= 0) {
      return;
    }
    const skillManager = target.isPlayer() ? target.getAsPlayer().getSkillManager() : target.getAsNpc();
    const current = skillManager.getCurrentLevel(Skill.MAGIC);
    const max = skillManager.getMaxLevel(Skill.MAGIC);
    // Only drains while Magic has not already been reduced.
    if (current < max) {
      return;
    }
    skillManager.setCurrentLevels(Skill.MAGIC, Math.max(0, current - damage));
  }

  class SeercullCombatMethod extends RangedCombatMethod {
    hits(character, target) {
      const player = character.getAsPlayer();
      const distance = character.getLocation().getDistance(target.getLocation());
      const delay = WeaponProfiles.hitDelays(player, distance)[0];
      // Keep defensive reductions and the target's HP cap in the shared pipeline.
      return [new PendingHit(character, target, this, {
        delay,
        rollAccuracy: false,
        damage: Misc.randomInclusive(0, soulshotMaxHit(player)),
      })];
    }

    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
    }

    fireSound() {
      return Sound.SEERCULL_SPECIAL;
    }

    handleAfterHitEffects(hit) {
      if (!hit.isAccurate()) {
        return;
      }
      soulshot(hit.getTarget(), Math.floor(hit.getTotalDamage()));
    }
  }

  return {
    id: "seercull",
    itemIds: [ItemIdentifiers.SEERCULL],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { guaranteedHit: true },
    combatMethod: new SeercullCombatMethod(),
  };
}

module.exports = function registerSeercullSpecialAttack(api) {
  api.registerCombatSpecial(buildSpecial(api.core));
};
