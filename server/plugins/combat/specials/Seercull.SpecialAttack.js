const { mechanicSchema, mechanicSettings } = require("./Mechanics.SpecialAttack");
// TODO: Soulshot special attack animation/graphic ids not found; skipped.
function buildSpecial(core) {
  const { CombatPosition, CombatSpecial, Equipment, ItemIdentifiers, Misc, PendingHit, RangedCombatMethod, Skill, Sound } = core;

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

  function soulshot(target, damage, config) {
    if (damage <= 0) {
      return;
    }
    const skillManager = target.isPlayer() ? target.getAsPlayer().getSkillManager() : target.getAsNpc();
    const skill = Skill[config.skill.toUpperCase()];
    if (config.skill === "prayer" && !target.isPlayer()) return;
    const current = skillManager.getCurrentLevel(skill);
    const max = skillManager.getMaxLevel(skill);
    // Only drains while Magic has not already been reduced.
    if (config.requireUnreduced && current < max) {
      return;
    }
    skillManager.setCurrentLevels(skill, Math.min(current, Math.max(target.isPlayer() ? config.playerFloor : 0, current - Math.floor(damage * config.percent / 100))));
  }

  class SeercullCombatMethod extends RangedCombatMethod {
    hits(character, target) {
      const player = character.getAsPlayer();
      const delay = RangedCombatMethod.playerHitDelays(character, target, CombatPosition.projectileDistance(character, target))[0];
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
      const config = mechanicSettings(this, "damage-drain", { skill: "magic", percent: 100, requireUnreduced: true, playerFloor: 0 });
      if (!config.enabled) return;
      if (!hit.isAccurate()) {
        return;
      }
      soulshot(hit.getTarget(), Math.floor(hit.getTotalDamage()), config);
    }
  }

  return {
    id: "seercull",
    itemIds: [ItemIdentifiers.SEERCULL],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { guaranteedHit: true },
    metadata: { editorMechanics: mechanicSchema("damage-drain", { skill: "magic", percent: 100, requireUnreduced: true, playerFloor: 0 }) },
    combatMethod: new SeercullCombatMethod(),
  };
}

module.exports = function registerSeercullSpecialAttack(api) {
  api.registerCombatSpecial(buildSpecial(api.core));
};
