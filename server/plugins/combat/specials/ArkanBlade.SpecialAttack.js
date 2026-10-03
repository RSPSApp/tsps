// TODO: ported from xrsps-typescript; untested.
module.exports = function registerArkanBladeSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, HitDamage, HitMask, ItemIdentifiers, MeleeCombatMethod, Task, TaskManager } = api.core;

  const DRAIN = 30;
  const SPECIAL_ANIMATION = new Animation(12297);
  const SPECIAL_VFX = new Graphic(3336);
  const BURN_TOTAL_DAMAGE = 10;
  const BURN_TICK_INTERVAL = 4;

  function applyBurn(target) {
    TaskManager.submit(new (class extends Task {
      remaining = BURN_TOTAL_DAMAGE;

      constructor() {
        super(BURN_TICK_INTERVAL);
      }

      execute() {
        if (!target.isRegistered() || target.getHitpoints() <= 0) {
          this.stop();
          return;
        }
        target.getCombat().getHitQueue().addPendingDamage([new HitDamage(1, HitMask.RED)]);
        this.remaining--;
        if (this.remaining <= 0) {
          this.stop();
        }
      }
    })());
  }

  class ArkanBladeCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
    }

    handleAfterHitEffects(hit) {
      if (!hit.isAccurate() || Math.floor(hit.getTotalDamage()) <= 0) {
        return;
      }
      applyBurn(hit.getTarget());
    }
  }

  api.registerCombatSpecial({
    id: "arkan_blade",
    itemIds: [ItemIdentifiers.ARKAN_BLADE],
    drainAmount: DRAIN,
    strengthMultiplier: 1.5,
    accuracyMultiplier: 1.5,
    traits: { hitCount: 1, accuracyMultiplier: 1.5, damageMultiplier: 1.5 },
    combatMethod: new ArkanBladeCombatMethod(),
  });
};
