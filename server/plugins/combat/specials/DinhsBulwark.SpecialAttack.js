/**
 * Dinh's bulwark, Shield Bash (docs/dinhs-bulwark.md; https://oldschool.runescape.wiki/w/Dinh%27s_bulwark):
 * 50% energy, +20% accuracy rolled with crush attack bonuses against the target's crush defence.
 * In multicombat it strikes up to ten targets within five tiles of the player (an 11x11 square),
 * hitting the primary target twice and every other target once. Each target that takes a
 * successful hit loses 5% of its highest offensive stat, once per target, never for the
 * primary's second hit. In single combat it is one hit on one target.
 */
module.exports = function registerDinhsBulwarkSpecialAttack(api) {
  const { Animation, CombatSpecial, ItemIdentifiers, MeleeCombatMethod, PendingHit, Skill } = api.core;

  const DRAIN = 50;
  const SPECIAL_ANIMATION = new Animation(7511);
  const DRAIN_FRACTION = 0.05;
  const CRUSH = 2;
  const AREA_RADIUS = 5;
  const MAX_TARGETS = 10;
  const PRIMARY_HITS = 2;

  /** Attack and Strength, then Ranged, then Magic: the Wiki's tie order. */
  function drainSkills(skillManager) {
    const attack = skillManager.getCurrentLevel(Skill.ATTACK);
    const strength = skillManager.getCurrentLevel(Skill.STRENGTH);
    const ranged = skillManager.getCurrentLevel(Skill.RANGED);
    const magic = skillManager.getCurrentLevel(Skill.MAGIC);
    const melee = attack + strength;
    const highest = Math.max(melee, ranged, magic);
    if (melee === highest) return [Skill.ATTACK, Skill.STRENGTH];
    return ranged === highest ? [Skill.RANGED] : [Skill.MAGIC];
  }

  function drainHighestOffensiveStat(target) {
    const skillManager = target.isPlayer() ? target.getAsPlayer().getSkillManager() : target.getAsNpc();
    for (const skill of drainSkills(skillManager)) {
      const current = skillManager.getCurrentLevel(skill);
      skillManager.setCurrentLevels(skill, current - Math.floor(current * DRAIN_FRACTION));
    }
  }

  /** The double hit, like the sweep, happens only when both fighters stand in multicombat. */
  function strikesTwice(character, target) {
    const areas = api.getAreaManager();
    return target === character.getCombat().getTarget() && areas.inMulti(character) && areas.inMulti(target);
  }

  class DinhsBulwarkCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performAnimation(SPECIAL_ANIMATION);
    }

    hits(character, target) {
      const config = strikesTwice(character, target) ? { hitAmount: PRIMARY_HITS } : undefined;
      return [new PendingHit(character, target, this, config)];
    }

    /** One pending hit per target holds both of the primary's splats, so this drains once. */
    handleAfterHitEffects(hit) {
      if (Math.floor(hit.getTotalDamage()) <= 0) return;
      drainHighestOffensiveStat(hit.getTarget());
    }
  }

  api.registerCombatSpecial({
    id: "dinhs_bulwark",
    itemIds: [ItemIdentifiers.DINHS_BULWARK],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1.2,
    traits: {
      accuracyMultiplier: 1.2,
      meleeAttackBonusIndex: CRUSH,
      meleeDefenceBonusIndex: CRUSH,
      targeting: {
        pattern: "surrounding",
        radius: AREA_RADIUS,
        width: 1,
        maxTargets: MAX_TARGETS,
        maxPlayerTargets: MAX_TARGETS,
        requiresMultiCombat: true,
      },
    },
    combatMethod: new DinhsBulwarkCombatMethod(),
  });
};
