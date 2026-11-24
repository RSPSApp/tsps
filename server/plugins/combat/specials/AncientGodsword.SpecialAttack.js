// TODO: ported from xrsps-typescript; untested.
module.exports = function registerAncientGodswordSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, HitDamage, HitMask, ItemIdentifiers, MeleeCombatMethod, Priority, Skill, Sound, Sounds, Task, TaskManager } = api.core;

  const DRAIN = 50;
  const SLASH_DEFENCE_BONUS_INDEX = 1;
  const ANIMATION = new Animation(9171);
  const GRAPHIC = new Graphic(1996, Priority.HIGH);
  const BLOOD_SACRIFICE_DELAY_TICKS = 8;
  const BLOOD_SACRIFICE_ESCAPE_DISTANCE = 5;
  const BLOOD_SACRIFICE_DAMAGE = 25;
  const BLOOD_SACRIFICE_NPC_HEAL_CAP = 25;
  const BLOOD_SACRIFICE_PLAYER_HEAL_CAP = 15;
  const SACRIFICE = {
    enabled: true, damage: BLOOD_SACRIFICE_DAMAGE, delayTicks: BLOOD_SACRIFICE_DELAY_TICKS,
    escapeDistance: BLOOD_SACRIFICE_ESCAPE_DISTANCE, healPercent: 15,
    npcHealCap: BLOOD_SACRIFICE_NPC_HEAL_CAP, playerHealCap: BLOOD_SACRIFICE_PLAYER_HEAL_CAP, graphic: 377,
  };

  class AncientGodswordCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(ANIMATION);
      character.performGraphic(GRAPHIC);
      Sounds.playAreaSoundAt(character, Sound.GODSWORD_SPECIAL);
    }

    handleAfterHitEffects(hit) {
      const sacrifice = { ...SACRIFICE, ...this.specialMechanics?.["blood-sacrifice"] };
      if (!sacrifice.enabled) return;
      const featureActive = this.isSpecialFeatureActive ?? (() => true);
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
          super(sacrifice.delayTicks);
        }

        execute() {
          if (!featureActive() || !attacker.isRegistered() || !target.isRegistered() || attacker.getHitpoints() <= 0 || target.getHitpoints() <= 0) {
            this.stop();
            return;
          }

          if (attacker.calculateDistance(target) >= sacrifice.escapeDistance) {
            target.sendMessage("You have escaped the blood sacrifice.");
            this.stop();
            return;
          }

          target.sendMessage("You have been sacrificed.");
          if (sacrifice.graphic >= 0) target.performGraphic(new Graphic(sacrifice.graphic));

          // 15% of the target's max Hitpoints, capped at 15 against players and 25 against NPCs.
          const player = target.isPlayer();
          const baseHitpoints = player
            ? target.getAsPlayer().getSkillManager().getMaxLevel(Skill.HITPOINTS)
            : target.getAsNpc().getMaxHitpoints();
          // Wiki: the heal is limited to the damage the sacrifice actually does, so a target with fewer
          // Hitpoints left than the 25 heals only what it had.
          const heal = Math.min(
            sacrifice.damage,
            target.getHitpoints(),
            player ? sacrifice.playerHealCap : sacrifice.npcHealCap,
            Math.floor(baseHitpoints * sacrifice.healPercent / 100)
          );
          if (heal > 0) {
            attacker.heal(heal);
          }

          target.getCombat().getHitQueue().addPendingDamage([new HitDamage(sacrifice.damage, HitMask.RED).setSource(attacker)]);
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
    metadata: {
      editorMechanics: {
        version: 1,
        groups: [{
          id: "blood-sacrifice", name: "Blood sacrifice", phase: "Delayed follow-up",
          advancedFrom: 3, detailsLabel: "Escape condition and healing",
          event: "damage", hook: "handleAfterHitEffects",
          trigger: "After the initial hit deals damage",
          description: "After {delayTicks} ticks ({delayTicks:seconds} s), deal {damage} damage if the enemy is closer than {escapeDistance} tiles. Restore your HP by {healPercent}% of the enemy's maximum HP, up to {npcHealCap} against NPCs or {playerHealCap} against players. Healing cannot exceed the follow-up damage or the enemy's remaining HP.",
          preview: { delayParameter: "delayTicks", damageParameter: "damage", graphic: 377, graphicParameter: "graphic", recipient: "target" },
          parameters: [
            { key: "enabled", label: "Enable follow-up", type: "boolean", value: true },
            { key: "damage", label: "Follow-up damage", type: "number", value: BLOOD_SACRIFICE_DAMAGE, min: 0, max: 1000, step: 1 },
            { key: "delayTicks", label: "Follow-up delay (ticks)", type: "number", value: BLOOD_SACRIFICE_DELAY_TICKS, min: 1, max: 100, step: 1 },
            { key: "escapeDistance", label: "Escape distance (tiles)", type: "number", value: BLOOD_SACRIFICE_ESCAPE_DISTANCE, min: 1, max: 64, step: 1 },
            { key: "healPercent", label: "Your healing from target maximum HP (%)", type: "number", value: 15, min: 0, max: 100, step: 0.1 },
            { key: "npcHealCap", label: "Healing cap against NPCs", type: "number", value: BLOOD_SACRIFICE_NPC_HEAL_CAP, min: 0, max: 1000, step: 1 },
            { key: "playerHealCap", label: "Healing cap against players", type: "number", value: BLOOD_SACRIFICE_PLAYER_HEAL_CAP, min: 0, max: 1000, step: 1 },
            { key: "graphic", label: "Follow-up VFX", type: "number", value: 377, min: -1, max: 65534, step: 1 },
          ],
        }],
      },
    },
    traits: {
      hitCount: 1,
      accuracyMultiplier: 2,
      damageMultiplier: 1.1,
      meleeDefenceBonusIndex: SLASH_DEFENCE_BONUS_INDEX,
    },
    combatMethod: new AncientGodswordCombatMethod(),
  });
};
