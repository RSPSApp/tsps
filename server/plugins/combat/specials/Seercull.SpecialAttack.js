// TODO: base implementation — exact max-hit formula still needs an ammo-only ranged evaluator source. Ported from xrsps-typescript; untested.
// TODO: Soulshot special attack animation/graphic ids not found; skipped.
function buildSpecial(core) {
  const { CombatSpecial, ItemIdentifiers, RangedCombatMethod, Skill } = core;

  const DRAIN = 100;

  function soulshot(target, damage) {
    if (damage <= 0) {
      return;
    }
    const skillManager = target.isPlayer() ? target.getAsPlayer().getSkillManager() : target.getAsNpc();
    const current = skillManager.getCurrentLevel(Skill.MAGIC);
    const max = skillManager.getMaxLevel(Skill.MAGIC);
    // Only drains while Magic has not already been reduced.
    if (current < max) {
      return;
    }
    skillManager.setCurrentLevels(Skill.MAGIC, Math.max(0, current - damage));
  }

  class SeercullCombatMethod extends RangedCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
    }

    handleAfterHitEffects(hit) {
      if (!hit.isAccurate()) {
        return;
      }
      soulshot(hit.getTarget(), Math.floor(hit.getTotalDamage()));
    }
  }

  return {
    id: "seercull",
    itemIds: [ItemIdentifiers.SEERCULL],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { guaranteedHit: true },
    combatMethod: new SeercullCombatMethod(),
  };
}

module.exports = function registerSeercullSpecialAttack(api) {
  api.registerCombatSpecial(buildSpecial(api.core));
};
