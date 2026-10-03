// TODO: ported from xrsps-typescript; untested.
module.exports = function registerStatiusWarhammerSpecialAttack(api) {
  const { Animation, CombatSpecial, ItemIdentifiers, MeleeCombatMethod, Skill, Sounds } = api.core;

  const DRAIN = 35;
  const DEFENCE_DRAIN_FRACTION = 0.75;
  const ANIMATION = new Animation(1378);

  function smash(target, damage) {
    if (Math.floor(damage) <= 0) {
      return;
    }
    if (!target.isPlayer()) {
      // TODO: NPC combat-stat drain is not exposed by our core NPC state.
      return;
    }
    const skillManager = target.getAsPlayer().getSkillManager();
    const currentLevel = Math.max(0, Math.floor(skillManager.getCurrentLevel(Skill.DEFENCE)));
    const drainAmount = Math.floor(currentLevel * DEFENCE_DRAIN_FRACTION);
    skillManager.setCurrentLevels(Skill.DEFENCE, Math.max(0, currentLevel - drainAmount));
  }

  class StatiusWarhammerCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(ANIMATION);
      Sounds.sendSound(character, character.getAttackSound());
    }

    handleAfterHitEffects(hit) {
      smash(hit.getTarget(), hit.getTotalDamage());
    }
  }

  api.registerCombatSpecial({
    id: "statius_warhammer",
    itemIds: [ItemIdentifiers.STATIUSS_WARHAMMER],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      minimumDamageMultiplier: 0.25,
      maximumDamageMultiplier: 1.25,
    },
    combatMethod: new StatiusWarhammerCombatMethod(),
  });
};
