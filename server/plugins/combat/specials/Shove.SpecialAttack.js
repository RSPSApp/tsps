module.exports = function registerShoveSpecialAttack(api) {
  const { Animation, CombatFactory, CombatMethod, CombatSpecial, CombatType, Direction, DuelRule, Graphic, GraphicHeight, ItemIdentifiers, PendingHit, RegionManager, Sound, Sounds, Task, TaskManager, TimerKey } = api.core;

  const DRAIN = 25;
  const ANIMATION = new Animation(1064);
  const GRAPHIC = new Graphic(263, GraphicHeight.HIGH);
  const STUN_ANIMATION = new Animation(424);

  class ShoveCombatMethod extends CombatMethod {
    hits(character, target) {
      return null;
    }

    start(character, target) {
      // Also blocked during the 1-tick grace period after a stun wears
      // off (see CombatFactory.stun) - Shove can't land on the same
      // target more than once every 6 ticks. Checked here, before any
      // energy/animation/sound, so a blocked Shove doesn't waste the
      // special attack.
      if (target.getTimers().has(TimerKey.STUN) || target.getTimers().has(TimerKey.STUN_IMMUNITY)) {
        return;
      }

      if (character.isPlayer()) {
        const player = character.getAsPlayer();
        if (player.getDueling().inDuel() && player.getDueling().getRules()[DuelRule.NO_MOVEMENT.getButtonId()]) {
          player.sendMessage("This weapon's special attack cannot be used in this duel.");
          return;
        }
      }

      if (target.getSize() > 1) {
        character.sendMessage("That creature is too large to knock back!");
        return;
      }

      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(ANIMATION);
      character.performGraphic(GRAPHIC);
      Sounds.sendSound(character, Sound.DRAGON_SPEAR_SPECIAL);
      target.performAnimation(STUN_ANIMATION);
      CombatFactory.stun(target, 3, true);
      target.getTimers().registers(TimerKey.FREEZE_IMMUNITY, 10);

      const direction = ShoveCombatMethod.getDirection(character, target);
      if (direction != null) {
        const destination = target.getLocation().transform(direction.getX(), direction.getY());
        if (RegionManager.canMovestart(target.getLocation(), destination, 1, 1, target.getPrivateArea())) {
          TaskManager.submit(new (class extends Task {
            constructor() {
              super(1);
            }

            execute() {
              if (!target.isRegistered()) {
                this.stop();
                return;
              }
              target.setLocation(destination);
              target.setWalkingDirection(direction);
              if (target.isPlayer()) {
                target.getMovementQueue().handleRegionChange();
              }
              this.stop();
            }
          })());
        }
      }

      // Shove's own attack speed is 1 tick slower than the weapon's normal
      // speed (5 ticks vs. the spear's normal 4), not the weapon's base speed.
      character.getCombat().setAttackDelay(character.getBaseAttackSpeed() + 1);
      character.setSpecialActivated(false);
      if (character.isPlayer()) {
        CombatSpecial.updateBar(character.getAsPlayer());
      }
    }

    type() {
      return CombatType.MELEE;
    }

    static getDirection(character, target) {
      const dx = Math.sign(target.getLocation().getX() - character.getLocation().getX());
      const dy = Math.sign(target.getLocation().getY() - character.getLocation().getY());
      if (dx === 0 && dy === 0) {
        return null;
      }
      return Direction.fromDeltas(dx, dy);
    }
  }

  api.registerCombatSpecial({
    id: "shove",
    itemIds: [
      ItemIdentifiers.DRAGON_SPEAR,
      ItemIdentifiers.DRAGON_SPEAR_P_PLUS_PLUS_,
      ItemIdentifiers.DRAGON_SPEAR_P_PLUS_,
      ItemIdentifiers.DRAGON_SPEAR_KP_,
      ItemIdentifiers.DRAGON_SPEAR_P_,
      ItemIdentifiers.ZAMORAKIAN_SPEAR,
      ItemIdentifiers.ZAMORAKIAN_HASTA,
    ],
    drainAmount: DRAIN,
    strengthMultiplier: 1.0,
    accuracyMultiplier: 1.0,
    combatMethod: new ShoveCombatMethod(),
  });
};
