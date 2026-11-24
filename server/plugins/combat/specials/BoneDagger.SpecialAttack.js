const { mechanicSchema, mechanicSettings } = require("./Mechanics.SpecialAttack");
// Backstab (https://oldschool.runescape.wiki/w/Bone_dagger): never misses a target nobody, or
// another player, damaged last, and lowers the Defence of a player or NPC by the damage dealt
// when it is at (or above) its base level.
function buildSpecial(core) {
  const { CombatSpecial, ItemIdentifiers, MeleeCombatMethod, Skill } = core;

  const DRAIN = 75;

  class BoneDaggerCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
    }

    handleAfterHitEffects(hit) {
      const config = mechanicSettings(this, "damage-drain", { skill: "defence", percent: 100, requireUnreduced: true, playerFloor: 1 });
      if (!config.enabled) return;
      if (!hit.isAccurate()) {
        return;
      }
      const damage = Math.max(0, Math.floor(hit.getTotalDamage()));
      if (damage <= 0) {
        return;
      }
      const target = hit.getTarget();
      const skillManager = target.isPlayer() ? target.getAsPlayer().getSkillManager() : target.getAsNpc();
      const skill = Skill[config.skill.toUpperCase()];
      if (config.skill === "prayer" && !target.isPlayer()) return;
      const current = skillManager.getCurrentLevel(skill);
      if (config.requireUnreduced && current < skillManager.getMaxLevel(skill)) return;
      skillManager.setCurrentLevels(skill, Math.min(current, Math.max(target.isPlayer() ? config.playerFloor : 0, current - Math.floor(damage * config.percent / 100))));
    }
  }

  return {
    id: "bone_dagger",
    itemIds: [
      ItemIdentifiers.BONE_DAGGER,
      ItemIdentifiers.BONE_DAGGER_P_,
      ItemIdentifiers.BONE_DAGGER_P_PLUS_,
      ItemIdentifiers.BONE_DAGGER_P_PLUS_PLUS_,
    ],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { hitCount: 1, guaranteedHitOnUnsuspectingTarget: true },
    metadata: { editorMechanics: mechanicSchema("damage-drain", { skill: "defence", percent: 100, requireUnreduced: true, playerFloor: 1 }) },
    combatMethod: new BoneDaggerCombatMethod(),
  };
}

module.exports = function registerBoneDaggerSpecialAttack(api) {
  api.registerCombatSpecial(buildSpecial(api.core));
};
