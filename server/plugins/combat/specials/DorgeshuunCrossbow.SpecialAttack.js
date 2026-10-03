// TODO: base implementation — guaranteed accuracy when the target was never hit / last hit by someone else needs live engagement state. Ported from xrsps-typescript; untested.
module.exports = function registerDorgeshuunCrossbowSpecialAttack(api) {
  const { CombatSpecial, ItemIdentifiers, RangedCombatMethod, Skill } = api.core;

  const DRAIN = 75;

  function snipe(target, damage) {
    if (damage <= 0 || !target.isPlayer()) {
      return;
    }
    const skillManager = target.getAsPlayer().getSkillManager();
    const current = skillManager.getCurrentLevel(Skill.DEFENCE);
    const max = skillManager.getMaxLevel(Skill.DEFENCE);
    // Only drains while Defence has not already been reduced.
    if (current < max) {
      return;
    }
    skillManager.setCurrentLevels(Skill.DEFENCE, Math.max(1, current - damage));
  }

  class DorgeshuunCrossbowCombatMethod extends RangedCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
    }

    handleAfterHitEffects(hit) {
      if (!hit.isAccurate()) {
        return;
      }
      snipe(hit.getTarget(), Math.floor(hit.getTotalDamage()));
    }
  }

  api.registerCombatSpecial({
    id: "dorgeshuun_crossbow",
    itemIds: [ItemIdentifiers.DORGESHUUN_CROSSBOW],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    combatMethod: new DorgeshuunCrossbowCombatMethod(),
  });
};
