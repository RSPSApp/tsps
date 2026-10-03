// TODO: ported from xrsps-typescript; untested.
module.exports = function registerAbyssalWhipSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, GraphicHeight, ItemIdentifiers, MeleeCombatMethod, Sound, Sounds } = api.core;

  const DRAIN = 50;
  const ACCURACY_MULTIPLIER = 1.25;
  const RUN_ENERGY_TRANSFER_FRACTION = 0.1;
  const ANIMATION = new Animation(1658);
  const GRAPHIC = new Graphic(341, GraphicHeight.HIGH);

  class AbyssalWhipCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(ANIMATION);
      Sounds.sendSound(character, Sound.WHIP_SPECIAL);
    }

    handleAfterHitEffects(hit) {
      if (!hit.isAccurate()) {
        return;
      }

      const target = hit.getTarget();
      if (target.getHitpoints() <= 0) {
        return;
      }
      target.performGraphic(GRAPHIC);

      // OSRS: Energy Drain transfers 10% of the target's current run energy to
      // the attacker on a successful, damaging PvP hit.
      if (Math.floor(hit.getTotalDamage()) <= 0) {
        return;
      }
      if (target.isPlayer() && hit.getAttacker().isPlayer()) {
        const attacker = hit.getAttacker();
        const player = target;
        const transferAmount = Math.floor(player.getRunEnergy() * RUN_ENERGY_TRANSFER_FRACTION);
        if (transferAmount <= 0) {
          return;
        }

        player.setRunEnergy(Math.max(0, player.getRunEnergy() - transferAmount));
        player.getPacketSender().sendRunEnergy();
        player.sendMessage("You feel drained!");

        if (player.getRunEnergy() === 0) {
          player.setRunning(false);
          player.getPacketSender().sendRunStatus();
        }

        attacker.setRunEnergy(Math.min(100, attacker.getRunEnergy() + transferAmount));
        attacker.getPacketSender().sendRunEnergy();
      }
    }
  }

  api.registerCombatSpecial({
    id: "abyssal_whip",
    itemIds: [ItemIdentifiers.ABYSSAL_WHIP],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: ACCURACY_MULTIPLIER,
    traits: {
      hitCount: 1,
      accuracyMultiplier: ACCURACY_MULTIPLIER,
    },
    combatMethod: new AbyssalWhipCombatMethod(),
  });
};
