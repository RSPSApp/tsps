// TODO: ported from xrsps-typescript; untested.
module.exports = function registerAncientGodswordSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, HitDamage, HitMask, ItemIdentifiers, MeleeCombatMethod, Priority, Skill, Sounds, Task, TaskManager } = api.core;

  const DRAIN = 50;
  const SLASH_DEFENCE_BONUS_INDEX = 1;
  const ANIMATION = new Animation(9171);
  const GRAPHIC = new Graphic(1996, Priority.HIGH);
  const BLOOD_SACRIFICE_DELAY_TICKS = 8;
  const BLOOD_SACRIFICE_ESCAPE_DISTANCE = 5;
  const BLOOD_SACRIFICE_DAMAGE = 25;
  const BLOOD_SACRIFICE_HEAL_FRACTION = 0.15;
  const BLOOD_SACRIFICE_NPC_HEAL_CAP = 25;
  const BLOOD_SACRIFICE_PLAYER_HEAL_CAP = 15;

  class AncientGodswordCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(ANIMATION);
      character.performGraphic(GRAPHIC);
      Sounds.sendSound(character, character.getAttackSound());
    }

    handleAfterHitEffects(hit) {
      if (!hit.isAccurate() || Math.floor(hit.getTotalDamage()) <= 0) {
        return;
      }

      const attacker = hit.getAttacker();
      const target = hit.getTarget();
      if (!attacker.isPlayer() || (!target.isPlayer() && !target.isNpc())) {
        return;
      }

      target.sendMessage("You have been marked for blood sacrifice.");

      // Resolves once, eight ticks later: the target must still be within five
      // tiles of the attacker to be sacrificed.
      TaskManager.submit(new (class extends Task {
        constructor() {
          super(BLOOD_SACRIFICE_DELAY_TICKS);
        }

        execute() {
          if (!attacker.isRegistered() || !target.isRegistered() || attacker.getHitpoints() <= 0 || target.getHitpoints() <= 0) {
            this.stop();
            return;
          }

          if (attacker.calculateDistance(target) >= BLOOD_SACRIFICE_ESCAPE_DISTANCE) {
            target.sendMessage("You have escaped the blood sacrifice.");
            this.stop();
            return;
          }

          target.sendMessage("You have been sacrificed.");
          target.performGraphic(new Graphic(377));

          // 15% of the target's max Hitpoints, capped at 15 against players and 25 against NPCs.
          const player = target.isPlayer();
          const baseHitpoints = player
            ? target.getAsPlayer().getSkillManager().getMaxLevel(Skill.HITPOINTS)
            : target.getAsNpc().getMaxHitpoints();
          const heal = Math.min(
            BLOOD_SACRIFICE_DAMAGE,
            player ? BLOOD_SACRIFICE_PLAYER_HEAL_CAP : BLOOD_SACRIFICE_NPC_HEAL_CAP,
            Math.floor(baseHitpoints * BLOOD_SACRIFICE_HEAL_FRACTION)
          );
          if (heal > 0) {
            attacker.heal(heal);
          }

          target.getCombat().getHitQueue().addPendingDamage([new HitDamage(BLOOD_SACRIFICE_DAMAGE, HitMask.RED).setSource(attacker)]);
          this.stop();
        }
      })());
    }
  }

  api.registerCombatSpecial({
    id: "ancient_godsword",
    itemIds: [ItemIdentifiers.ANCIENT_GODSWORD],
    drainAmount: DRAIN,
    strengthMultiplier: 1.1,
    accuracyMultiplier: 2,
    traits: {
      hitCount: 1,
      accuracyMultiplier: 2,
      damageMultiplier: 1.1,
      meleeDefenceBonusIndex: SLASH_DEFENCE_BONUS_INDEX,
    },
    combatMethod: new AncientGodswordCombatMethod(),
  });
};
