// TODO: ported from xrsps-typescript; untested.
module.exports = function registerSaradominGodswordSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod, Priority, Skill, Sound, Sounds } = api.core;

  const DRAIN = 50;
  const SLASH_DEFENCE_BONUS_INDEX = 1;
  const HEALING_BLADE_ACCURACY_MULTIPLIER = 2;
  const HEALING_BLADE_DAMAGE_MULTIPLIER = 1.1;
  const HEALING_BLADE_HITPOINTS_FRACTION = 0.5;
  const HEALING_BLADE_PRAYER_FRACTION = 0.25;
  const HEALING_BLADE_MINIMUM_HITPOINTS_HEAL = 10;
  const HEALING_BLADE_MINIMUM_PRAYER_RESTORE = 5;
  const ANIMATION = new Animation(7640);
  const GRAPHIC = new Graphic(1209, Priority.HIGH);
  // Wiki (Saradomin godsword): the heal is "calculated from the potential damage of a swing", not what the target's
  // Hitpoints let land - the roll as made, before PendingHit caps it to them (as the toxic blowpipe keeps it).
  const potentialDamage = new WeakMap();

  class SaradominGodswordCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(ANIMATION);
      character.performGraphic(GRAPHIC);
      Sounds.playAreaSoundAt(character, Sound.GODSWORD_SPECIAL);
    }

    handleAfterHitEffects(hit) {
      const recovery = { enabled: true, healPercent: 50, prayerPercent: 25, minimumHeal: 10, minimumPrayer: 5, ...this.specialMechanics?.recovery };
      if (!recovery.enabled) return;
      if (!hit.getAttacker().isPlayer()) {
        return;
      }
      const rolled = this.specialFeatureRolledDamage ?? potentialDamage.get(hit);
      const potential = rolled === undefined ? 0 : Math.floor(rolled * Number(hit.damageMultiplier ?? 1));
      const damage = Math.max(0, Math.floor(hit.getTotalDamage()), potential);
      if (damage <= 0) {
        return;
      }

      const player = hit.getAttacker().getAsPlayer();
      const skillManager = player.getSkillManager();
      const maxHitpoints = skillManager.getMaxLevel(Skill.HITPOINTS);
      const currentHitpoints = skillManager.getCurrentLevel(Skill.HITPOINTS);
      if (currentHitpoints < maxHitpoints) {
        const heal = Math.max(
          recovery.minimumHeal,
          Math.floor(damage * recovery.healPercent / 100)
        );
        skillManager.setCurrentLevels(Skill.HITPOINTS, Math.min(maxHitpoints, currentHitpoints + heal));
      }

      const maxPrayer = skillManager.getMaxLevel(Skill.PRAYER);
      const currentPrayer = skillManager.getCurrentLevel(Skill.PRAYER);
      if (currentPrayer < maxPrayer) {
        const restore = Math.max(
          recovery.minimumPrayer,
          Math.floor(damage * recovery.prayerPercent / 100)
        );
        skillManager.setCurrentLevels(Skill.PRAYER, Math.min(maxPrayer, currentPrayer + restore));
      }
    }
  }

  api.onCombatHitDamage?.(({ attacker, hit, damage }) => {
    if (attacker?.isPlayer?.() && attacker.isSpecialActivated?.() && attacker.getCombatSpecial?.()?.getId() === "saradomin_godsword") {
      potentialDamage.set(hit, damage.getDamage());
    }
  });

  api.registerCombatSpecial({
    id: "saradomin_godsword",
    itemIds: [ItemIdentifiers.SARADOMIN_GODSWORD],
    drainAmount: DRAIN,
    strengthMultiplier: HEALING_BLADE_DAMAGE_MULTIPLIER,
    accuracyMultiplier: HEALING_BLADE_ACCURACY_MULTIPLIER,
    metadata: { editorMechanics: { version: 1, groups: [{
      id: "recovery", name: "HP and Prayer recovery", phase: "At impact", hook: "handleAfterHitEffects", event: "damage",
      trigger: "After a hit passes accuracy and rolls more than zero damage",
      description: "Restore your HP by {healPercent}% of damage before the enemy HP limit, with a minimum of {minimumHeal}. Restore {prayerPercent}% as Prayer, with a minimum of {minimumPrayer}. Recovery stops at your base HP and Prayer levels.",
      parameters: [
        { key: "enabled", label: "Enable recovery", type: "boolean", value: true },
        { key: "healPercent", label: "Damage restored as HP (%)", type: "number", value: HEALING_BLADE_HITPOINTS_FRACTION * 100, min: 0, max: 100, step: .1 },
        { key: "minimumHeal", label: "Minimum HP restored", type: "number", value: HEALING_BLADE_MINIMUM_HITPOINTS_HEAL, min: 0, max: 1000, step: 1 },
        { key: "prayerPercent", label: "Damage restored as Prayer (%)", type: "number", value: HEALING_BLADE_PRAYER_FRACTION * 100, min: 0, max: 100, step: .1 },
        { key: "minimumPrayer", label: "Minimum Prayer restored", type: "number", value: HEALING_BLADE_MINIMUM_PRAYER_RESTORE, min: 0, max: 1000, step: 1 },
      ],
    }] } },
    traits: {
      hitCount: 1,
      accuracyMultiplier: HEALING_BLADE_ACCURACY_MULTIPLIER,
      damageMultiplier: HEALING_BLADE_DAMAGE_MULTIPLIER,
      meleeDefenceBonusIndex: SLASH_DEFENCE_BONUS_INDEX,
    },
    combatMethod: new SaradominGodswordCombatMethod(),
  });
};
