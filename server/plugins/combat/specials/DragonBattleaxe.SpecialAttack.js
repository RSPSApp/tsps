// TODO: ported from xrsps-typescript; untested.
module.exports = function registerDragonBattleaxeSpecialAttack(api) {
  const { CombatMethod, CombatSpecial, CombatType, ItemIdentifiers, Skill } = api.core;

  const DRAIN = 100;
  const DRAIN_FRACTION = 0.1;
  const BASE_STRENGTH_BOOST = 10;
  const DRAIN_TO_STRENGTH_DIVISOR = 4;
  const DRAINED_SKILLS = [Skill.ATTACK, Skill.DEFENCE, Skill.RANGED, Skill.MAGIC];

  // Rampage is an instant utility special: drain 10% of Attack/Defence/Ranged/Magic,
  // then add 10 + a quarter of the total drained levels to Strength. No attack roll.
  class DragonBattleaxeCombatMethod extends CombatMethod {
    hits() {
      return null;
    }

    type() {
      return CombatType.MELEE;
    }

    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      if (!character.isPlayer()) {
        return;
      }
      const skillManager = character.getAsPlayer().getSkillManager();

      let totalDrained = 0;
      for (const skill of DRAINED_SKILLS) {
        const current = skillManager.getCurrentLevel(skill);
        const drainAmount = Math.max(0, Math.floor(current * DRAIN_FRACTION));
        skillManager.setCurrentLevels(skill, current - drainAmount);
        totalDrained += drainAmount;
      }

      const currentStrength = skillManager.getCurrentLevel(Skill.STRENGTH);
      const strengthBoost = Math.floor(
        BASE_STRENGTH_BOOST + Math.floor(totalDrained / DRAIN_TO_STRENGTH_DIVISOR),
      );
      skillManager.setCurrentLevels(Skill.STRENGTH, currentStrength + strengthBoost);
    }
  }

  api.registerCombatSpecial({
    id: "dragon_battleaxe",
    itemIds: [ItemIdentifiers.DRAGON_BATTLEAXE],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { skipAttack: true },
    combatMethod: new DragonBattleaxeCombatMethod(),
  });
};
