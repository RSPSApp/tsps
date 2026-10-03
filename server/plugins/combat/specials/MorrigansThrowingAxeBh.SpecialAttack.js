// TODO: ported from xrsps-typescript; untested.
module.exports = function registerMorrigansThrowingAxeBhSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, GraphicHeight, ItemIdentifiers, RangedCombatMethod, Task, TaskManager } = api.core;

  const DRAIN = 50;
  const SPECIAL_ANIMATION = new Animation(11468);
  const SPECIAL_VFX = new Graphic(2921, 0, GraphicHeight.HIGH);
  const IMPACT_GRAPHIC = new Graphic(2922);
  const ACCURACY_MULTIPLIER = 1.5;
  const MINIMUM_DAMAGE_MULTIPLIER = 0.5;
  const MAXIMUM_DAMAGE_MULTIPLIER = 1.5;
  const DRAIN_PENALTY_DURATION_TICKS = 100;

  class MorrigansThrowingAxeBhCombatMethod extends RangedCombatMethod {
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
      if (!hit.isAccurate() || Math.floor(hit.getTotalDamage()) <= 0) {
        return;
      }
      const target = hit.getTarget();
      if (!target.isPlayer()) {
        return;
      }
      const targetPlayer = target.getAsPlayer();

      // TODO: exact Hamstring penalty is 6x run-energy drain for 100 ticks; the movement
      // drain has no hook, so this approximates it by burning extra energy while running.
      TaskManager.submit(new (class extends Task {
        processed = 0;

        constructor() {
          super(1);
        }

        execute() {
          this.processed++;
          if (!targetPlayer.isRegistered() || targetPlayer.getHitpoints() <= 0 || this.processed > DRAIN_PENALTY_DURATION_TICKS) {
            this.stop();
            return;
          }
          if (targetPlayer.isRunningReturn() && targetPlayer.getMovementQueue().isMovings()) {
            targetPlayer.setRunEnergy(targetPlayer.getRunEnergy() - 5);
            targetPlayer.getPacketSender().sendRunEnergy();
          }
        }
      })());
    }
  }

  api.registerCombatSpecial({
    id: "morrigans_throwing_axe_bh",
    itemIds: [
      ItemIdentifiers.MORRIGANS_THROWING_AXE,
      ItemIdentifiers.MORRIGANS_THROWING_AXE_2,
      ItemIdentifiers.MORRIGANS_THROWING_AXE_BH_,
      ItemIdentifiers.MORRIGANS_THROWING_AXE_BH__2,
    ],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: ACCURACY_MULTIPLIER,
    traits: {
      hitCount: 1,
      accuracyMultiplier: ACCURACY_MULTIPLIER,
      minimumDamageMultiplier: MINIMUM_DAMAGE_MULTIPLIER,
      maximumDamageMultiplier: MAXIMUM_DAMAGE_MULTIPLIER,
    },
    combatMethod: new MorrigansThrowingAxeBhCombatMethod(),
  });
};
