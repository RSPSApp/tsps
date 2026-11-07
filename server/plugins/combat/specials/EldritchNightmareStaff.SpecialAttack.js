// TODO: ported from xrsps-typescript; untested.
module.exports = function registerEldritchNightmareStaffSpecialAttack(api) {
  const { Animation, CombatMethod, CombatSpecial, CombatType, Graphic, ItemIdentifiers, MagicCombatMethod, PendingHit, Skill } = api.core;

  const DRAIN = 55;
  const BASE_MAX_HIT = 44;
  const PRAYER_RESTORE_FRACTION = 0.5;
  const MAXIMUM_PRAYER_LEVEL = 120;
  // Invocate (cache): nightmare_staff_eldritch_cast_spotanim on the caster and
  // nightmare_staff_eldritch_hit_spotanim on the target. The Wiki gives it its own attack animation;
  // nightmare_staff_special is the staff's only special attack animation in the cache.
  const CAST_ANIMATION = new Animation(8532);
  const CAST_GRAPHIC = new Graphic(1762);
  const HIT_GRAPHIC = new Graphic(1761);
  // Wiki (Eldritch nightmare staff): Invocate restores Prayer from "potential damage", not what the target's
  // Hitpoints let land - the roll as made, before PendingHit caps it to them.
  const potentialDamage = new WeakMap();

  // TODO: core's magic hit path (getMagicMaxhit) ignores maximumHitSource /
  // visibleMagicMaximumHit and damageMultiplier, so the Invocate max hit is not
  // yet scaled by the traits recorded below.
  class EldritchNightmareStaffCombatMethod extends CombatMethod {
    hits(character, target) {
      return [new PendingHit(character, target, this, 2)];
    }

    type() {
      return CombatType.MAGIC;
    }

    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(CAST_ANIMATION);
      character.performGraphic(CAST_GRAPHIC);
    }

    handleAfterHitEffects(hit) {
      hit.getTarget().performGraphic(hit.isAccurate() ? HIT_GRAPHIC : MagicCombatMethod.SPLASH_GRAPHIC);
      const rolled = potentialDamage.get(hit);
      const damage = Math.max(0, Math.floor(hit.getTotalDamage()), rolled === undefined ? 0 : Math.floor(rolled));
      if (!hit.isAccurate() || damage <= 0) {
        return;
      }
      const attacker = hit.getAttacker();
      if (!attacker.isPlayer()) {
        return;
      }
      const skillManager = attacker.getAsPlayer().getSkillManager();
      const current = skillManager.getCurrentLevel(Skill.PRAYER);
      const restored = Math.floor(damage * PRAYER_RESTORE_FRACTION);
      skillManager.setCurrentLevels(Skill.PRAYER, Math.min(MAXIMUM_PRAYER_LEVEL, current + restored));
    }

    attackSpeed(character) {
      return 5;
    }

    attackDistance(character) {
      return 10;
    }
  }

  api.onCombatHitDamage?.(function recordInvocateRoll({ hit, damage }) {
    if (hit?.getCombatMethod?.() instanceof EldritchNightmareStaffCombatMethod) {
      potentialDamage.set(hit, damage.getDamage());
    }
  });

  api.registerCombatSpecial({
    id: "eldritch_nightmare_staff",
    itemIds: [ItemIdentifiers.ELDRITCH_NIGHTMARE_STAFF],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      accuracyMultiplier: 1,
      damageMultiplier: 1,
      rollAttackType: "magic",
      damageType: "magic",
      maximumHitSource: "visible_magic",
      visibleMagicMaximumHit: BASE_MAX_HIT,
    },
    combatMethod: new EldritchNightmareStaffCombatMethod(),
  });
};
