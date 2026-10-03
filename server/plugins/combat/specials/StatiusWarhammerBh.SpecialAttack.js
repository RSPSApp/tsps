// TODO: ported from xrsps-typescript; untested.
module.exports = function registerStatiusWarhammerBhSpecialAttack(api) {
  const { CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod, Skill } = api.core;

  const DRAIN = 35;
  const SPECIAL_VFX = new Graphic(844);
  const DEFENCE_DRAIN_FRACTION = 0.75;

  class StatiusWarhammerBhCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performGraphic(SPECIAL_VFX);
    }

    handleAfterHitEffects(hit) {
      if (Math.floor(hit.getTotalDamage()) <= 0) {
        return;
      }
      const target = hit.getTarget();
      if (!target.isPlayer()) {
        // TODO: NPC combat-stat drain is not exposed by our core NPC state.
        return;
      }
      const skillManager = target.getAsPlayer().getSkillManager();
      const current = skillManager.getCurrentLevel(Skill.DEFENCE);
      const drainAmount = Math.floor(current * DEFENCE_DRAIN_FRACTION);
      skillManager.setCurrentLevels(Skill.DEFENCE, Math.max(0, current - drainAmount));
    }
  }

  api.registerCombatSpecial({
    id: "statius_warhammer_bh",
    itemIds: [ItemIdentifiers.STATIUSS_WARHAMMER_BH_],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      minimumDamageMultiplier: 0.25,
      maximumDamageMultiplier: 1.25,
    },
    combatMethod: new StatiusWarhammerBhCombatMethod(),
  });
};
