// TODO: ported from xrsps-typescript; untested.
module.exports = function registerBrineSabreSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod, Skill } = api.core;

  const DRAIN = 75;
  const SPECIAL_ANIMATION = new Animation(6118);
  const SPECIAL_VFX = new Graphic(1048);
  const BOOST_FRACTION = 0.25;
  const BASE_BOOST_CAP = 3;
  const LEVEL_CAP_FRACTION = 0.1;
  const BOOSTED_SKILLS = [Skill.STRENGTH, Skill.ATTACK, Skill.DEFENCE];

  class BrineSabreCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
    }

    handleAfterHitEffects(hit) {
      if (!hit.isAccurate()) {
        return;
      }
      const boostAmount = Math.floor(Math.floor(hit.getTotalDamage()) * BOOST_FRACTION);
      if (boostAmount <= 0) {
        return;
      }
      const attacker = hit.getAttacker();
      if (!attacker.isPlayer()) {
        return;
      }
      const skillManager = attacker.getAsPlayer().getSkillManager();
      for (const skill of BOOSTED_SKILLS) {
        const base = skillManager.getMaxLevel(skill);
        const current = skillManager.getCurrentLevel(skill);
        const cap = base + BASE_BOOST_CAP + Math.floor(base * LEVEL_CAP_FRACTION);
        skillManager.setCurrentLevels(skill, Math.min(cap, current + boostAmount));
      }
    }
  }

  api.registerCombatSpecial({
    id: "brine_sabre",
    itemIds: [ItemIdentifiers.BRINE_SABRE],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 2,
    // TODO: upstream gates use to underwater areas; that map-area restriction is
    // not available to combat plugins yet.
    traits: { hitCount: 1, accuracyMultiplier: 2 },
    combatMethod: new BrineSabreCombatMethod(),
  });
};
