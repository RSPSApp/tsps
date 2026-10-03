// TODO: ported from xrsps-typescript; untested.
module.exports = function registerNoxiousHalberdSpecialAttack(api) {
  const { CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod } = api.core;

  const DRAIN = 50;
  const SPECIAL_VFX = new Graphic(2930);

  class NoxiousHalberdCombatMethod extends MeleeCombatMethod {
    hits() {
      return null;
    }

    start(character, target) {
      if (!character.isPlayer()) {
        return;
      }
      const player = character.getAsPlayer();
      if (player.getPoisonDamage() <= 0) {
        player.sendMessage("You need to be poisoned or envenomed to use Virulence.");
        return;
      }

      CombatSpecial.drain(player, DRAIN);
      player.performGraphic(SPECIAL_VFX);
      player.setPoisonDamage(0);
      player.setVenomed(false);
      // TODO: store the pending poison/venom damage and make the next accurate Noxious
      // halberd strike roll at least that high; no hit-transform hook is exposed.
    }
  }

  api.registerCombatSpecial({
    id: "noxious_halberd",
    itemIds: [
      ItemIdentifiers.NOXIOUS_HALBERD,
      ItemIdentifiers.NOXIOUS_HALBERD_2,
      ItemIdentifiers.NOXIOUS_HALBERD_3,
    ],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { skipAttack: true },
    combatMethod: new NoxiousHalberdCombatMethod(),
  });
};
