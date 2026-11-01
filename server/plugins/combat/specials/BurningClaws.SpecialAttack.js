// TODO: ported from xrsps-typescript; untested.
module.exports = function registerBurningClawsSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, HitDamage, HitMask, ItemIdentifiers, MeleeCombatMethod, Sound, Sounds, Task, TaskManager } = api.core;

  const DRAIN = 35;
  const SPECIAL_ANIMATION = new Animation(11140);
  const SPECIAL_VFX = new Graphic(2814);
  const SLASH_DEFENCE_BONUS_INDEX = 1;
  const ACCURACY_ROLLS = 3;
  // Wiki (Burning claws): a burn deals 10 damage over 40 ticks, up to five at once. Each hitsplat
  // burns with the chance of the accuracy roll that landed (1st, 2nd, 3rd); a full miss never burns.
  const BURN_TOTAL_DAMAGE = 10;
  const BURN_TICK_INTERVAL = 4;
  const MAX_ACTIVE_BURNS = 5;
  const BURN_CHANCE_BY_ROLL = [0.15, 0.3, 0.45];
  // A target's running burn tasks; a death or logout ends them so none reach the next life.
  const activeBurns = new WeakMap();

  function endBurns(target) {
    const burns = activeBurns.get(target);
    if (!burns) {
      return;
    }
    activeBurns.delete(target);
    for (const task of burns) {
      task.stop();
    }
  }

  function isDying(target) {
    return target.getHitpoints() <= 0 || target.isDyingReturn?.() === true || target.isDyingFunction?.() === true;
  }

  function applyBurn(target) {
    let burns = activeBurns.get(target);
    if (!burns) {
      burns = new Set();
      activeBurns.set(target, burns);
    }
    if (burns.size >= MAX_ACTIVE_BURNS) {
      return;
    }
    const task = new (class extends Task {
      remaining = BURN_TOTAL_DAMAGE;

      constructor() {
        super(BURN_TICK_INTERVAL);
      }

      execute() {
        if (!target.isRegistered() || isDying(target)) {
          endBurns(target);
          return;
        }
        target.getCombat().getHitQueue().addPendingDamage([new HitDamage(1, HitMask.RED)]);
        this.remaining--;
        if (this.remaining <= 0) {
          burns.delete(this);
          this.stop();
        }
      }
    })();
    burns.add(task);
    TaskManager.submit(task);
  }

  class BurningClawsCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
      // Live (rsprox 3327): two synth sounds 29 and 60 cycles after the special starts.
      Sounds.sendSound(character, Sound.BURNING_CLAWS_SPECIAL_1);
      Sounds.sendSound(character, Sound.BURNING_CLAWS_SPECIAL_2);
    }

    handleAfterHitEffects(hit) {
      const chance = BURN_CHANCE_BY_ROLL[hit.getFirstSuccessfulRangeIndex()];
      if (!chance) {
        return;
      }
      for (let i = 0; i < hit.getHits().length; i++) {
        if (Math.random() < chance) {
          applyBurn(hit.getTarget());
        }
      }
    }
  }

  // onPlayerDefeated sees every death; onPlayerDeath stops at the first handler that takes it (a safe-death respawn).
  api.onPlayerDefeated(({ victim }) => endBurns(victim));
  api.onPlayerLogout(({ player }) => endBurns(player));
  api.onNpcDeath(({ npc }) => endBurns(npc));

  api.registerCombatSpecial({
    id: "burning_claws",
    itemIds: [ItemIdentifiers.BURNING_CLAWS],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 3,
      meleeDefenceBonusIndex: SLASH_DEFENCE_BONUS_INDEX,
      accuracyRollCount: ACCURACY_ROLLS,
      firstSuccessfulAccuracyDamageRanges: [
        { minimumDamageMultiplier: 0.75, maximumDamageMultiplier: 1.75, hitDamageMultipliers: [0.25, 0.25, 0.5] },
        { minimumDamageMultiplier: 0.5, maximumDamageMultiplier: 1.5, hitDamageMultipliers: [0.5, 0.5, 0], hitDamageBonuses: [-1, -1, 2] },
        { minimumDamageMultiplier: 0.25, maximumDamageMultiplier: 1.25, hitDamageMultipliers: [0, 0, 1], hitDamageBonuses: [1, 1, -2] },
      ],
    },
    combatMethod: new BurningClawsCombatMethod(),
  });
};
