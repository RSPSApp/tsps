/**
 * Condemn, the Accursed sceptre's special (docs/powered-staves.md;
 * https://oldschool.runescape.wiki/w/Accursed_sceptre): 50% energy and a charge of ether, 1.5
 * times the accuracy and max hit of the sceptre's built-in spell. A successful hit drains 15% of
 * the target's Defence and Magic; drains don't stack, so a drained target only goes down to 85%
 * of its base level. No capture shows it: it plays human_special_accursed (9961) and the
 * built-in spell's projectile.
 */
function buildSpecial(api) {
  const { Animation, CombatMethod, CombatSpecial, CombatType, Graphic, ItemIdentifiers, PendingHit, Skill, Sound, Sounds } = api.core;

  const DRAIN = 50;
  const ATTACK_SPEED = 4;
  const SPECIAL_ANIMATION = new Animation(9961);
  const DRAIN_FRACTION = 0.15;
  const DRAINED_SKILLS = [Skill.DEFENCE, Skill.MAGIC];
  const SPLASH = 85; // failedspell_impact
  const SPLASH_SOUND = new Sound(227, 1, 0, 0);

  function condemn(target) {
    const skillManager = target.isPlayer() ? target.getAsPlayer().getSkillManager() : target.getAsNpc();
    for (const skill of DRAINED_SKILLS) {
      const baseLevel = skillManager.getMaxLevel(skill);
      const current = skillManager.getCurrentLevel(skill);
      const drainAmount = Math.floor(baseLevel * DRAIN_FRACTION);
      const cap = baseLevel - drainAmount;
      const level = Math.min(current, Math.max(cap, current - drainAmount));
      if (target.isPlayer()) skillManager.setCurrentLevel(skill, level, true);
      else skillManager.setCurrentLevels(skill, level);
    }
  }

  function staffOf(player) {
    const request = { player, spell: null };
    api.emitCustomEvent("powered-staff:spell", request);
    return request.spell ? request : null;
  }

  class AccursedSceptreCombatMethod extends CombatMethod {
    type() {
      return CombatType.MAGIC;
    }

    canAttack(character) {
      const player = character.getAsPlayer();
      const staff = staffOf(player);
      if (!staff || staff.charges <= 0) {
        player.sendMessage("There is not enough revenant ether left powering your sceptre.");
        player.getCombat().reset();
        return false;
      }
      return true;
    }

    start(character, target) {
      const staff = staffOf(character.getAsPlayer());
      CombatSpecial.drain(character, DRAIN);
      staff?.useCharge();
      staff?.spell.startCast(character, target);
      character.performAnimation(SPECIAL_ANIMATION);
    }

    hits(character, target) {
      const player = character.getAsPlayer();
      const staff = staffOf(player);
      const spell = staff?.spell ?? null;
      // The roll reads the selected spell: the sceptre's built-in one, for its max hit.
      const combat = player.getCombat();
      const previous = combat.getCastSpell?.() ?? null;
      combat.setCastSpell(spell);
      try {
        return [new PendingHit(character, target, this, staff?.hitDelay(target) ?? 2).setSpell(spell)];
      } finally {
        combat.setCastSpell(previous);
      }
    }

    handleAfterHitEffects(hit) {
      if (!hit.isAccurate()) {
        hit.getTarget()?.performGraphic?.(new Graphic(SPLASH, 0, 124));
        const attacker = hit.getAttacker?.();
        if (attacker?.isPlayer?.()) Sounds.sendSound(attacker, SPLASH_SOUND);
        return;
      }
      condemn(hit.getTarget());
    }

    attackSpeed() {
      return ATTACK_SPEED;
    }

    attackDistance(character) {
      return staffOf(character.getAsPlayer())?.attackDistance(character) ?? 7;
    }
  }

  return {
    id: "accursed_sceptre",
    itemIds: [ItemIdentifiers.ACCURSED_SCEPTRE, ItemIdentifiers.ACCURSED_SCEPTRE_A_],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1.5,
    traits: { hitCount: 1, rollAttackType: "magic", damageType: "magic", accuracyMultiplier: 1.5, damageMultiplier: 1.5 },
    combatMethod: new AccursedSceptreCombatMethod(),
  };
}

module.exports = function registerAccursedSceptreSpecialAttack(api) {
  api.registerCombatSpecial(buildSpecial(api));
};
