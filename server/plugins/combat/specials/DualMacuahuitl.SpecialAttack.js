// TODO: ported from xrsps-typescript; untested.
module.exports = function registerDualMacuahuitlSpecialAttack(api) {
  const { CombatSpecial, Equipment, Graphic, ItemIdentifiers, MeleeCombatMethod } = api.core;

  const DRAIN = 25;
  const SPECIAL_VFX = new Graphic(2792);
  const SELF_DAMAGE_FRACTION = 0.25;

  const BLOOD_MOON_HELM_IDS = [
    ItemIdentifiers.BLOOD_MOON_HELM,
    ItemIdentifiers.BLOOD_MOON_HELM_4,
    ItemIdentifiers.BLOOD_MOON_HELM_BROKEN_,
    ItemIdentifiers.BLOOD_MOON_HELM_6,
  ];
  const BLOOD_MOON_BODY_IDS = [
    ItemIdentifiers.BLOOD_MOON_CHESTPLATE,
    ItemIdentifiers.BLOOD_MOON_CHESTPLATE_4,
    ItemIdentifiers.BLOOD_MOON_CHESTPLATE_BROKEN_,
    ItemIdentifiers.BLOOD_MOON_CHESTPLATE_6,
  ];
  const BLOOD_MOON_LEGS_IDS = [
    ItemIdentifiers.BLOOD_MOON_TASSETS,
    ItemIdentifiers.BLOOD_MOON_TASSETS_4,
    ItemIdentifiers.BLOOD_MOON_TASSETS_BROKEN_,
    ItemIdentifiers.BLOOD_MOON_TASSETS_6,
  ];

  function hasFullBloodMoonArmour(player) {
    const items = player.getEquipment().getItems();
    return BLOOD_MOON_HELM_IDS.includes(items[Equipment.HEAD_SLOT].getId())
      && BLOOD_MOON_BODY_IDS.includes(items[Equipment.BODY_SLOT].getId())
      && BLOOD_MOON_LEGS_IDS.includes(items[Equipment.LEG_SLOT].getId());
  }

  class DualMacuahuitlCombatMethod extends MeleeCombatMethod {
    canAttack(character, target) {
      return character.isPlayer() && hasFullBloodMoonArmour(character.getAsPlayer());
    }

    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performGraphic(SPECIAL_VFX);
      if (!character.isPlayer()) {
        return;
      }
      const player = character.getAsPlayer();
      const selfDamage = Math.floor(player.getHitpoints() * SELF_DAMAGE_FRACTION);
      if (selfDamage > 0) {
        player.setHitpoints(player.getHitpoints() - selfDamage);
      }
    }
  }

  api.registerCombatSpecial({
    id: "dual_macuahuitl",
    itemIds: [ItemIdentifiers.DUAL_MACUAHUITL, ItemIdentifiers.DUAL_MACUAHUITL_4],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 2,
      maximumHitSplitCount: 2,
      hitDelayTicks: [0, 1],
      guaranteedHit: true,
      minimumDamageMultiplier: 0.25,
      maximumDamageMultiplier: 1.25,
    },
    combatMethod: new DualMacuahuitlCombatMethod(),
  });
};
