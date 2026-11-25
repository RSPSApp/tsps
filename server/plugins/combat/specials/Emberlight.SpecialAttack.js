const { mechanicSchema, mechanicSettings } = require("./Mechanics.SpecialAttack");
function buildSpecial(core) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod, Skill, Sound, Sounds } = core;

  const DRAIN = 50;
  const SPECIAL_ANIMATION = new Animation(11138);
  const SPECIAL_VFX = new Graphic(2810);
  const DRAIN_FRACTION = 0.05;
  const FLAT_DRAIN = 1;
  const DRAINED_SKILLS = [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE];

  function weaken(hit, config) {
    if (!hit.isAccurate()) {
      return;
    }
    const target = hit.getTarget();
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

  class EmberlightCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
      // The three-part special, staggered as in rsprox recording 3333.
      Sounds.sendSound(character, Sound.EMBERLIGHT_SPECIAL_1);
      Sounds.sendSound(character, Sound.EMBERLIGHT_SPECIAL_2);
      Sounds.sendSound(character, Sound.EMBERLIGHT_SPECIAL_3);
    }

    handleAfterHitEffects(hit) {
      const config = mechanicSettings(this, "stat-drain", { percent: DRAIN_FRACTION * 100, demonPercent: 15, flat: FLAT_DRAIN, attack: true, strength: true, defence: true });
      if (!config.enabled) return;
      weaken(hit, config);
    }
  }

  return {
    id: "emberlight",
    itemIds: [ItemIdentifiers.EMBERLIGHT],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { hitCount: 1, meleeDefenceBonusIndex: 0 },
    metadata: { editorMechanics: mechanicSchema("stat-drain", { percent: DRAIN_FRACTION * 100, demonPercent: 15, flat: FLAT_DRAIN }) },
    combatMethod: new EmberlightCombatMethod(),
  };
}

module.exports = function registerEmberlightSpecialAttack(api) {
  api.registerCombatSpecial(buildSpecial(api.core));
};
