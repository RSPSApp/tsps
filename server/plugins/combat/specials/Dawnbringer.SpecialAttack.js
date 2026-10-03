// TODO: ported from xrsps-typescript; untested.
module.exports = function registerDawnbringerSpecialAttack(api) {
  const { CombatMethod, CombatSpecial, CombatType, Graphic, ItemIdentifiers, PendingHit } = api.core;

  const DRAIN = 35;
  const SPECIAL_VFX = new Graphic(1546);
  const IMPACT_GRAPHIC = new Graphic(1548);
  const MAXIMUM_DAMAGE = 150;
  const MINIMUM_DAMAGE_MULTIPLIER = 75 / MAXIMUM_DAMAGE;

  class DawnbringerCombatMethod extends CombatMethod {
    hits(character, target) {
      return [new PendingHit(character, target, this)];
    }

    type() {
      return CombatType.MAGIC;
    }

    canAttack(character, target) {
      // TODO: Pulsate is only usable within the Theatre of Blood; no zone/area
      // check for it is exposed to plugins yet.
      return true;
    }

    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performGraphic(SPECIAL_VFX);
    }

    handleAfterHitEffects(hit) {
      if (hit.isAccurate()) {
        hit.getTarget().performGraphic(IMPACT_GRAPHIC);
      }
    }
  }

  api.registerCombatSpecial({
    id: "dawnbringer",
    itemIds: [ItemIdentifiers.DAWNBRINGER],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      guaranteedHit: true,
      rollAttackType: "magic",
      damageType: "magic",
      maxHitOverride: MAXIMUM_DAMAGE,
      minimumDamageMultiplier: MINIMUM_DAMAGE_MULTIPLIER,
      maximumDamageMultiplier: 1,
    },
    combatMethod: new DawnbringerCombatMethod(),
  });
};
