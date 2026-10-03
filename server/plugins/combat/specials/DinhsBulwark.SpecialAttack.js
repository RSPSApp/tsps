// TODO: ported from xrsps-typescript; untested.
module.exports = function registerDinhsBulwarkSpecialAttack(api) {
  const { Animation, CombatSpecial, ItemIdentifiers, MeleeCombatMethod, Skill } = api.core;

  const DRAIN = 50;
  const SPECIAL_ANIMATION = new Animation(7511);
  const DRAIN_FRACTION = 0.05;

  function drainPlayerSkill(skillManager, skill) {
    const current = skillManager.getCurrentLevel(skill);
    const drainAmount = Math.floor(current * DRAIN_FRACTION);
    skillManager.setCurrentLevels(skill, current - drainAmount);
  }

  function drainHighestOffensiveStyle(target) {
    if (!target.isPlayer()) {
      // TODO: NPC offensive combat-stat lookup/drain is not exposed by our core.
      return;
    }
    const skillManager = target.getAsPlayer().getSkillManager();
    const attack = skillManager.getCurrentLevel(Skill.ATTACK);
    const strength = skillManager.getCurrentLevel(Skill.STRENGTH);
    const ranged = skillManager.getCurrentLevel(Skill.RANGED);
    const magic = skillManager.getCurrentLevel(Skill.MAGIC);
    const melee = attack + strength;
    const highest = Math.max(melee, ranged, magic);

    if (melee === highest) {
      drainPlayerSkill(skillManager, Skill.ATTACK);
      drainPlayerSkill(skillManager, Skill.STRENGTH);
    } else if (ranged === highest) {
      drainPlayerSkill(skillManager, Skill.RANGED);
    } else {
      drainPlayerSkill(skillManager, Skill.MAGIC);
    }
  }

  class DinhsBulwarkCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performAnimation(SPECIAL_ANIMATION);
    }

    handleAfterHitEffects(hit) {
      if (!hit.isAccurate() || Math.floor(hit.getTotalDamage()) <= 0) {
        return;
      }
      drainHighestOffensiveStyle(hit.getTarget());
    }
  }

  api.registerCombatSpecial({
    id: "dinhs_bulwark",
    itemIds: [ItemIdentifiers.DINHS_BULWARK],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1.2,
    // TODO: upstream picks hitCount (1 player / 2 non-player) and accuracy
    // (1.2 / 0.8 vs a defensive NPC) from the target at roll time; the static
    // PvM default is registered here.
    traits: { hitCount: 2, accuracyMultiplier: 1.2 },
    combatMethod: new DinhsBulwarkCombatMethod(),
  });
};
