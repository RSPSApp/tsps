// TODO: ported from xrsps-typescript; untested.
module.exports = function registerEclipseAtlatlSpecialAttack(api) {
  const { Animation, CombatMethod, CombatSpecial, CombatType, Equipment, Graphic, ItemIdentifiers, PendingHit } = api.core;

  const DRAIN = 50;
  const SPECIAL_ANIMATION = new Animation(11060);
  const SPECIAL_VFX = new Graphic(2797);
  const IMPACT_GRAPHIC = new Graphic(2798);
  const ACCURACY_MULTIPLIER = 1.5;

  const ECLIPSE_MOON_HELM_IDS = [ItemIdentifiers.ECLIPSE_MOON_HELM];
  const ECLIPSE_MOON_BODY_IDS = [ItemIdentifiers.ECLIPSE_MOON_CHESTPLATE];
  const ECLIPSE_MOON_LEGS_IDS = [ItemIdentifiers.ECLIPSE_MOON_TASSETS];

  function hasFullEclipseMoonArmour(player) {
    const items = player.getEquipment().getItems();
    return ECLIPSE_MOON_HELM_IDS.includes(items[Equipment.HEAD_SLOT].getId())
      && ECLIPSE_MOON_BODY_IDS.includes(items[Equipment.BODY_SLOT].getId())
      && ECLIPSE_MOON_LEGS_IDS.includes(items[Equipment.LEG_SLOT].getId());
  }

  class EclipseAtlatlCombatMethod extends CombatMethod {
    hits(character, target) {
      return [new PendingHit(character, target, this)];
    }

    type() {
      return CombatType.MAGIC;
    }

    canAttack(character, target) {
      return character.isPlayer() && hasFullEclipseMoonArmour(character.getAsPlayer());
    }

    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
    }

    handleAfterHitEffects(hit) {
      if (hit.isAccurate()) {
        hit.getTarget().performGraphic(IMPACT_GRAPHIC);
      }
    }

    // TODO: consuming the target's remaining Arkan-blade burn damage (capped at
    // 50) into minimumDamageBonus/maximumDamageBonus needs the shared burn
    // tracker and dynamic traits, neither of which is exposed to plugins yet.
  }

  api.registerCombatSpecial({
    id: "eclipse_atlatl",
    itemIds: [ItemIdentifiers.ECLIPSE_ATLATL, ItemIdentifiers.ECLIPSE_ATLATL_4],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: ACCURACY_MULTIPLIER,
    traits: {
      hitCount: 1,
      accuracyMultiplier: ACCURACY_MULTIPLIER,
      rollAttackType: "magic",
      damageType: "magic",
      maximumHitSource: "physical_melee",
    },
    combatMethod: new EclipseAtlatlCombatMethod(),
  });
};
