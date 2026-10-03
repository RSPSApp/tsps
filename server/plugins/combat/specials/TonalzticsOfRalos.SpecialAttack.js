// TODO: ported from xrsps-typescript; untested.
module.exports = function registerTonalzticsOfRalosSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, PendingHit, RangedCombatMethod, Skill, WeaponProfiles } = api.core;

  const DRAIN = 50;
  const SPECIAL_ANIMATION = new Animation(10914);
  const SPECIAL_VFX = new Graphic(2725);
  const IMPACT_GRAPHIC = new Graphic(2731);
  const HIT_COUNT = 2;
  const DEFENCE_DRAIN_MAGIC_FRACTION = 0.1;

  class TonalzticsOfRalosCombatMethod extends RangedCombatMethod {
    hits(character, target) {
      const distance = character.getLocation().getDistance(target.getLocation());
      const hitDelay = WeaponProfiles.hitDelays(character.getAsPlayer(), distance)[0];
      return [new PendingHit(character, target, this, { delay: hitDelay, rollAccuracy: true, hitAmount: HIT_COUNT })];
    }

    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
    }

    handleAfterHitEffects(hit) {
      if (hit.isAccurate()) {
        hit.getTarget().performGraphic(IMPACT_GRAPHIC);
      }
      const target = hit.getTarget();
      if (!target.isPlayer()) {
        // TODO: NPC combat-stat drain is not exposed by our core NPC state.
        return;
      }
      const skillManager = target.getAsPlayer().getSkillManager();
      const drainAmount = Math.floor(skillManager.getCurrentLevel(Skill.MAGIC) * DEFENCE_DRAIN_MAGIC_FRACTION);
      if (drainAmount <= 0) {
        return;
      }
      for (const splat of hit.getHits()) {
        if (splat.getDamage() <= 0) {
          continue;
        }
        const currentDefence = skillManager.getCurrentLevel(Skill.DEFENCE);
        skillManager.setCurrentLevels(Skill.DEFENCE, Math.max(0, currentDefence - drainAmount));
      }
    }
  }

  api.registerCombatSpecial({
    id: "tonalztics_of_ralos",
    itemIds: [ItemIdentifiers.TONALZTICS_OF_RALOS],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { hitCount: HIT_COUNT },
    combatMethod: new TonalzticsOfRalosCombatMethod(),
  });
};
