// Noxious halberd Virulence (https://oldschool.runescape.wiki/w/Noxious_halberd): usable only while
// poisoned or envenomed, it cures the affliction (no immunity) and raises the minimum hit of the next
// accurate halberd attack by the damage the cured affliction would have dealt next. The bonus is lost
// on a weapon change or logout. rsprox recording 1449: the refusal message, the cure, the animation
// (human_halberd_virulence_02) and the spotanim (vfx_noxious_halberd_spec).
const MINIMUM_HIT_ATTRIBUTE = "noxious-halberd:virulence-minimum-hit";
const NOT_AFFLICTED_MESSAGE = "You can only use this special attack whilst you are poisoned.";
const DRAIN = 50;

module.exports = function registerNoxiousHalberdSpecialAttack(api) {
  const { Animation, CacheDefinitions, CombatPoisonEffect, CombatSpecial, CombatType, Equipment, Graphic, ItemIdentifiers, MeleeCombatMethod } = api.core;

  const HALBERD_IDS = [
    ItemIdentifiers.NOXIOUS_HALBERD,
    ItemIdentifiers.NOXIOUS_HALBERD_2,
    ItemIdentifiers.NOXIOUS_HALBERD_3,
  ];

  function wieldsHalberd(player) {
    return HALBERD_IDS.includes(player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId?.());
  }

  /** What the next poison or venom hit would deal: venom stores its damage, poison its severity. */
  function pendingDamage(player) {
    const stored = player.getPoisonDamage();
    return player.isVenomed() ? stored : CombatPoisonEffect.damageFromSeverity(stored);
  }

  class NoxiousHalberdCombatMethod extends MeleeCombatMethod {
    hits() {
      return null;
    }

    start(character) {
      if (!character.isPlayer()) {
        return;
      }
      const player = character.getAsPlayer();
      if (!player.isPoisoned()) {
        player.sendMessage(NOT_AFFLICTED_MESSAGE);
        return;
      }

      CombatSpecial.drain(player, DRAIN);
      player.performAnimation(new Animation(CacheDefinitions.getSeqId("human_halberd_virulence_02")));
      player.performGraphic(new Graphic(CacheDefinitions.getSpotanimId("vfx_noxious_halberd_spec")));
      player.setAttribute(MINIMUM_HIT_ATTRIBUTE, pendingDamage(player));
      player.setPoisonDamage(0);
      player.setVenomed(false);
    }
  }

  /** The next accurate halberd hit rolls at least the cured damage (never above its maximum). */
  function onHitRolled(event) {
    const { attacker } = event;
    if (!attacker.isPlayer() || event.combatType !== CombatType.MELEE) return;
    const player = attacker.getAsPlayer();
    const minimum = player.getAttribute(MINIMUM_HIT_ATTRIBUTE);
    if (!(minimum > 0) || !wieldsHalberd(player)) return;
    player.setAttribute(MINIMUM_HIT_ATTRIBUTE, null);
    event.damage = Math.max(event.damage, Math.min(minimum, event.maximum));
  }

  function onEquipmentChanged({ player }) {
    if (player.getAttribute(MINIMUM_HIT_ATTRIBUTE) != null && !wieldsHalberd(player)) {
      player.setAttribute(MINIMUM_HIT_ATTRIBUTE, null);
    }
  }

  api.registerCombatSpecial({
    id: "noxious_halberd",
    itemIds: HALBERD_IDS,
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { skipAttack: true },
    combatMethod: new NoxiousHalberdCombatMethod(),
  });
  api.onCustomEvent("combat:hit-rolled", onHitRolled);
  api.onCustomEvent("equipment:changed", onEquipmentChanged);
};
