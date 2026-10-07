// TODO: ported from xrsps-typescript; untested.
module.exports = function registerSaradominSwordSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, HitDamage, HitMask, ItemIdentifiers, MeleeCombatMethod, Misc, Priority, Sounds, Task, TaskManager } = api.core;

  const DRAIN = 100;
  const SLASH_DEFENCE_BONUS_INDEX = 1;
  const LIGHTNING_MINIMUM_DAMAGE = 1;
  const LIGHTNING_MAXIMUM_DAMAGE = 16;
  const ANIMATION = new Animation(1132);
  const GRAPHIC = new Graphic(1213, Priority.HIGH);
  const ENEMY_GRAPHIC = new Graphic(1195);

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

      // Saradomin's Lightning: an independent 1-16 Magic hitsplat after the
      // melee strike. The upstream evaluator queues a real magic attack; our
      // core has no deferred-attack hook, so a delayed hitsplat stands in.
      // TODO: route the lightning through the real magic attack pipeline.
      const lightningDamage = LIGHTNING_MINIMUM_DAMAGE
        + Misc.getRandom(LIGHTNING_MAXIMUM_DAMAGE - LIGHTNING_MINIMUM_DAMAGE + 1);
      TaskManager.submit(new (class extends Task {
        constructor() {
          super(1);
        }

        execute() {
          if (!target.isRegistered() || target.getHitpoints() <= 0) {
            this.stop();
            return;
          }
          target.getCombat().getHitQueue().addPendingDamage([new HitDamage(lightningDamage, HitMask.RED).setSource(hit.getAttacker())]);
          this.stop();
        }
      })());
    }
  }

  api.registerCombatSpecial({
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
  });
};
