// TODO: ported from xrsps-typescript; untested.
module.exports = function registerMorrigansJavelinSpecialAttack(api) {
  const { Animation, CombatSpecial, Equipment, Flag, HitDamage, HitMask, Item, ItemIdentifiers, Projectile, RangedCombatMethod, Sound, Sounds, Task, TaskManager, WeaponInterfaceManager } = api.core;

  const DRAIN = 50;
  const ACCURACY_MULTIPLIER = 1.5;
  const BLEED_FRACTION = 0.75;
  const BLEED_CHUNK = 10;
  const BLEED_INTERVAL_TICKS = 1;
  const ANIMATION = new Animation(806);
  const BLEED_TASK_KEY_ATTRIBUTE = "combat:bleed:task-key";
  const JAVELIN_ITEM_IDS = [
    ItemIdentifiers.MORRIGANS_JAVELIN,
    ItemIdentifiers.MORRIGANS_JAVELIN_2,
    ItemIdentifiers.MORRIGANS_JAVELIN_3,
    ItemIdentifiers.MORRIGANS_JAVELIN_BH_,
    ItemIdentifiers.MORRIGANS_JAVELIN_BH__2,
  ];

  function applyBleed(attacker, target, damage) {
    if (!attacker.isPlayer() || !target.isPlayer()) {
      return;
    }

    let remainingDamage = Math.floor(Math.floor(damage) * BLEED_FRACTION);
    if (remainingDamage <= 0) {
      return;
    }

    // ponytail: one active bleed per target; upstream stacks simultaneous bleeds.
    const player = target.getAsPlayer();
    const previousKey = player.getAttribute?.(BLEED_TASK_KEY_ATTRIBUTE);
    if (previousKey) {
      TaskManager.cancelTasks(previousKey);
    }
    const bleedTaskKey = {};
    player.setAttribute?.(BLEED_TASK_KEY_ATTRIBUTE, bleedTaskKey);

    const clear = () => player.setAttribute?.(BLEED_TASK_KEY_ATTRIBUTE, null);

    TaskManager.submit(new (class extends Task {
      constructor() {
        super(BLEED_INTERVAL_TICKS, bleedTaskKey);
      }

      execute() {
        if (!attacker.isRegistered() || !target.isRegistered() || target.getHitpoints() <= 0) {
          clear();
          this.stop();
          return;
        }
        const damageToDeal = Math.min(BLEED_CHUNK, remainingDamage);
        remainingDamage -= damageToDeal;
        target.getCombat().getHitQueue().addPendingDamage([new HitDamage(damageToDeal, HitMask.RED)]);
        if (remainingDamage <= 0) {
          clear();
          this.stop();
        }
      }
    })());
  }

  class MorrigansJavelinCombatMethod extends RangedCombatMethod {
    canAttack(character, target) {
      if (!character.isPlayer()) {
        return false;
      }
      return JAVELIN_ITEM_IDS.includes(
        character.getAsPlayer().getEquipment().get(Equipment.WEAPON_SLOT).getId()
      );
    }

    start(character, target) {
      const player = character.getAsPlayer();
      CombatSpecial.drain(player, DRAIN);
      player.performAnimation(ANIMATION);
      Sounds.sendSound(character, Sound.THROW_DART);
      Projectile.createProjectile(character, target, 1622, 30, 60, 40, 36).sendProjectile();
      MorrigansJavelinCombatMethod.decrementThrownWeapon(player, 1);
    }

    handleAfterHitEffects(hit) {
      if (!hit.isAccurate() || Math.floor(hit.getTotalDamage()) <= 0) {
        return;
      }
      applyBleed(hit.getAttacker(), hit.getTarget(), hit.getTotalDamage());
    }

    static decrementThrownWeapon(player, amount) {
      const item = player.getEquipment().get(Equipment.WEAPON_SLOT);
      item.decrementAmountBy(amount);

      if (item.getAmount() <= 0) {
        player.sendMessage("You have run out of ammunition!");
        player.getEquipment().set(Equipment.WEAPON_SLOT, new Item(-1));
        WeaponInterfaceManager.assign(player);
        player.getUpdateFlag().flag(Flag.APPEARANCE);
      }

      player.getEquipment().refreshItems();
    }
  }

  api.registerCombatSpecial({
    id: "morrigans_javelin",
    itemIds: JAVELIN_ITEM_IDS,
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: ACCURACY_MULTIPLIER,
    traits: {
      hitCount: 1,
      accuracyMultiplier: ACCURACY_MULTIPLIER,
      damageMultiplier: 1,
      rollAttackType: "ranged",
      damageType: "ranged",
    },
    combatMethod: new MorrigansJavelinCombatMethod(),
  });
};
