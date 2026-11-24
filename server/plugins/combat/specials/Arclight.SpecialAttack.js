const { mechanicSchema, mechanicSettings } = require("./Mechanics.SpecialAttack");
function buildSpecial(core) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod, Skill } = core;

  const DRAIN = 50;
  const SPECIAL_ANIMATION = new Animation(2890);
  const SPECIAL_VFX = new Graphic(483);
  const DRAIN_FRACTION = 0.05;
  const FLAT_DRAIN = 1;
  const DRAINED_SKILLS = [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE];

  function weaken(target, config) {
    const skillManager = target.isPlayer() ? target.getAsPlayer().getSkillManager() : target.getAsNpc();
    const demon = target.isNpc?.() && target.getAsNpc().getCurrentDefinition().hasAttribute("demon");
    const fraction = (demon ? config.demonPercent : config.percent) / 100;
    for (const name of ["attack", "strength", "defence", "magic", "ranged", "prayer"]) {
      if (!config[name] || name === "prayer" && !target.isPlayer()) continue;
      const skill = Skill[name.toUpperCase()];
      const baseLevel = skillManager.getMaxLevel(skill);
      const current = skillManager.getCurrentLevel(skill);
      const drainAmount = Math.floor(baseLevel * fraction) + config.flat;
      skillManager.setCurrentLevels(skill, Math.max(target.isPlayer() ? 1 : 0, current - drainAmount));
    }
  }

  class ArclightCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
    }

    handleAfterHitEffects(hit) {
      const config = mechanicSettings(this, "stat-drain", { percent: DRAIN_FRACTION * 100, demonPercent: 10, flat: FLAT_DRAIN, attack: true, strength: true, defence: true });
      if (!config.enabled) return;
      if (!hit.isAccurate()) {
        return;
      }
      weaken(hit.getTarget(), config);
    }
  }

  return {
    id: "arclight",
    itemIds: [ItemIdentifiers.ARCLIGHT],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { hitCount: 1, meleeDefenceBonusIndex: 0 },
    metadata: { editorMechanics: mechanicSchema("stat-drain", { percent: DRAIN_FRACTION * 100, demonPercent: 10, flat: FLAT_DRAIN }) },
    combatMethod: new ArclightCombatMethod(),
  };
}

module.exports = function registerArclightSpecialAttack(api) {
  api.registerCombatSpecial(buildSpecial(api.core));
};
