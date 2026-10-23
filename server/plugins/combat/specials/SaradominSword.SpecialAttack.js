function buildSpecial(core) {
  const { Animation, CombatFactory, CombatMethod, CombatSpecial, CombatType, Graphic, ItemIdentifiers, MeleeCombatMethod, Misc, PendingHit, Priority, PrayerHandler, Skill, Sounds } = core;

  const DRAIN = 100;
  // Misc.getRandom(n) is inclusive (0..n), so the 1-16 range rolls getRandom(max - min).
  const SLASH_DEFENCE_BONUS_INDEX = 1;
  const LIGHTNING_MINIMUM_DAMAGE = 1;
  const LIGHTNING_MAXIMUM_DAMAGE = 16;
  const ANIMATION = new Animation(1132);
  const GRAPHIC = new Graphic(1213, Priority.HIGH);
  const ENEMY_GRAPHIC = new Graphic(1195);

  class LightningCombatMethod extends CombatMethod {
    type() { return CombatType.MAGIC; }
    hits() { return []; }
    handleAfterHitEffects(hit) {
      const attacker = hit.getAttacker();
      const damage = hit.getTotalDamage();
      if (attacker.isPlayer() && damage > 0) {
        const skills = attacker.getAsPlayer().getSkillManager();
        skills.addExperience(Skill.MAGIC, damage * 2, true);
        skills.addExperience(Skill.HITPOINTS, damage * 4 / 3, true);
      }
    }
  }
  const lightningMethod = new LightningCombatMethod();

  class SaradominSwordCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(ANIMATION);
      character.performGraphic(GRAPHIC);
      Sounds.sendSound(character, character.getAttackSound());
    }

    handleAfterHitEffects(hit) {
      const target = hit.getTarget();
      if (!hit.isAccurate() || (!target.isPlayer() && !target.isNpc())) {
        return;
      }
      target.performGraphic(ENEMY_GRAPHIC);

      const splashed = target.isPlayer() && PrayerHandler.isActivated(target.getAsPlayer(), PrayerHandler.PROTECT_FROM_MAGIC);
      const lightningDamage = splashed ? 0 : LIGHTNING_MINIMUM_DAMAGE
        + Misc.getRandom(LIGHTNING_MAXIMUM_DAMAGE - LIGHTNING_MINIMUM_DAMAGE);
      CombatFactory.addPendingHit(new PendingHit(hit.getAttacker(), target, lightningMethod, {
        delay: 1,
        rollAccuracy: false,
        experience: false,
        damage: lightningDamage,
      }));
    }
  }

  return {
    id: "saradomin_sword",
    itemIds: [ItemIdentifiers.SARADOMIN_SWORD],
    drainAmount: DRAIN,
    strengthMultiplier: 1.1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      accuracyMultiplier: 1,
      damageMultiplier: 1.1,
      rollAttackType: "melee",
      meleeDefenceBonusIndex: SLASH_DEFENCE_BONUS_INDEX,
    },
    combatMethod: new SaradominSwordCombatMethod(),
  };
}

module.exports = function registerSaradominSwordSpecialAttack(api) {
  api.registerCombatSpecial(buildSpecial(api.core));
};
