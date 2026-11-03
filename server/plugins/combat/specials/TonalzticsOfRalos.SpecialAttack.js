/**
 * Division, the Tonalztics of Ralos' special attack (Wiki: Tonalztics of Ralos#Special attack).
 *
 * 50% energy, +50% accuracy, and a successful damaging hit drains the target's Defence by
 * 1/8 of its Magic level. Each hit drains, so the charged two-hit version can drain twice.
 * Uncharged it is one hit, charged it is two; the item plugin spends the throw's charge.
 */

function buildSpecial(api) {
  const {
    AccuracyFormulasDpsCalc, Animation, CombatSpecial, Graphic, ItemIdentifiers,
    PendingHit, RangedCombatMethod, Skill, WeaponProfiles,
  } = api.core;

  const DRAIN = 50;
  const ACCURACY_MULTIPLIER = 1.5;
  const DEFENCE_DRAIN_DIVISOR = 8;
  const SPECIAL_ANIMATION = { charged: 10914, uncharged: 10916 }; // HUMAN_GLAIVE_RALOS01_*_SPECIAL
  const SPECIAL_VFX = { charged: 2725, uncharged: 2726 }; // VFX_GLAIVE_*_SPECIAL
  const IMPACT_GRAPHIC = new Graphic(2731);

  function shotState(player, action = "read") {
    const event = { player, action, charged: false };
    api.emitCustomEvent("tonalztics:shot", event);
    return event.charged;
  }

  function drainAmount(target) {
    const skillManager = target.isPlayer() ? target.getAsPlayer().getSkillManager() : target.getAsNpc();
    return Math.floor(skillManager.getCurrentLevel(Skill.MAGIC) / DEFENCE_DRAIN_DIVISOR);
  }

  class TonalzticsOfRalosCombatMethod extends RangedCombatMethod {
    hits(character, target) {
      const player = character.getAsPlayer();
      const charged = shotState(player);
      const distance = character.getLocation().getDistance(target.getLocation());
      const hitDelay = WeaponProfiles.hitDelays(player, distance)[0];
      return [new PendingHit(character, target, this, {
        delay: hitDelay,
        rollAccuracy: true,
        hitAmount: charged ? 2 : 1,
      })];
    }

    start(character, target) {
      const charged = character.isPlayer() && shotState(character.getAsPlayer(), "begin");
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performAnimation(new Animation(charged ? SPECIAL_ANIMATION.charged : SPECIAL_ANIMATION.uncharged));
      character.performGraphic(new Graphic(charged ? SPECIAL_VFX.charged : SPECIAL_VFX.uncharged));
    }

    finished(character, target) {
      super.finished(character, target);
      shotState(character.getAsPlayer(), "end");
    }

    onCombatEnded(character, target) {
      super.onCombatEnded(character, target);
      shotState(character.getAsPlayer(), "end");
    }

    /**
     * Wiki: on an NPC the Defence drained by the first successful hit is already there for the
     * second one's accuracy. On a player it is not recalculated within the tick (Mod Ash).
     */
    projectedDefenceLevel(character, target, context) {
      if (!target?.isNpc?.() || !shotState(character.getAsPlayer())) {
        return undefined;
      }
      const drain = drainAmount(target);
      if (drain <= 0) {
        return undefined;
      }
      const npc = target.getAsNpc();
      let defence = npc.getCurrentLevel(Skill.DEFENCE);
      for (const prior of context.priorHits) {
        if (prior.getDamage() > 0) {
          defence = npc.previewCurrentLevel(Skill.DEFENCE, defence - drain);
        }
      }
      return AccuracyFormulasDpsCalc.projectedEffectiveDefenceLevel(target, defence);
    }

    handleAfterHitEffects(hit) {
      if (hit.isAccurate()) {
        hit.getTarget().performGraphic(IMPACT_GRAPHIC);
      }
      const target = hit.getTarget();
      const skillManager = target.isPlayer() ? target.getAsPlayer().getSkillManager() : target.getAsNpc();
      const drain = drainAmount(target);
      if (drain <= 0) {
        return;
      }
      for (const splat of hit.getHits()) {
        if (splat.getDamage() <= 0) {
          continue;
        }
        const currentDefence = skillManager.getCurrentLevel(Skill.DEFENCE);
        skillManager.setCurrentLevels(Skill.DEFENCE, Math.max(0, currentDefence - drain));
      }
    }
  }

  return {
    id: "tonalztics_of_ralos",
    itemIds: [ItemIdentifiers.TONALZTICS_OF_RALOS_UNCHARGED_, ItemIdentifiers.TONALZTICS_OF_RALOS],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: ACCURACY_MULTIPLIER,
    traitsFor: (player) => ({
      hitCount: shotState(player) ? 2 : 1,
      accuracyMultiplier: ACCURACY_MULTIPLIER,
    }),
    combatMethod: new TonalzticsOfRalosCombatMethod(),
  };
}

module.exports = function registerTonalzticsOfRalosSpecialAttack(api) {
  api.registerCombatSpecial(buildSpecial(api));
};
