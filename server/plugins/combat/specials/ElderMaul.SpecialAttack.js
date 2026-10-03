// TODO: ported from xrsps-typescript; untested.
module.exports = function registerElderMaulSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod, Skill } = api.core;

  const DRAIN = 50;
  const DEFENCE_DRAIN_FRACTION = 0.35;
  // Pulverize: dedicated player animation + self VFX + target impact (RuneLite
  // AnimationID HUMAN_ELDER_MAUL_SPEC / VFX_ELDER_MAUL_SPECIAL / ..._IMPACT).
  const SPECIAL_ANIMATION = new Animation(11124);
  const SPECIAL_VFX = new Graphic(2804);
  const IMPACT_GRAPHIC = new Graphic(2805);

  function pulverize(hit) {
    if (!hit.isAccurate() || Math.floor(hit.getTotalDamage()) <= 0) {
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
    skillManager.setCurrentLevels(Skill.DEFENCE, Math.max(1, current - drainAmount));
  }

  class ElderMaulCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
    }

    handleAfterHitEffects(hit) {
      if (hit.isAccurate()) {
        hit.getTarget().performGraphic(IMPACT_GRAPHIC);
      }
      pulverize(hit);
    }
  }

  api.registerCombatSpecial({
    id: "elder_maul",
    itemIds: [ItemIdentifiers.ELDER_MAUL_3, ItemIdentifiers.ELDER_MAUL, ItemIdentifiers.ELDER_MAUL_OR_],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    // Pulverize's animation runs a tick slower than a normal elder maul attack.
    traits: { hitCount: 1, accuracyMultiplier: 1.25, attackSpeedTicks: 7 },
    combatMethod: new ElderMaulCombatMethod(),
  });
};
