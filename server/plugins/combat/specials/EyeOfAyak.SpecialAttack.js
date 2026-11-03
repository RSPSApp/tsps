/**
 * Soul Rend, the Eye of Ayak's special (docs/powered-staves.md;
 * https://oldschool.runescape.wiki/w/Eye_of_Ayak): 50% energy, double accuracy and 1.3 times the
 * max hit of the staff's built-in spell, an attack every 5 ticks. A hit that deals damage lowers
 * the target's Magic Defence by the damage dealt, never below 0, until it dies or despawns.
 *
 * As captured (rsprox 3080, revision 231): human_eye_of_ayak_special (12394) with
 * vfx_ayak_player_special_spotanim (3364), vfx_ayak_impact_special_spotanim (3365) on the target
 * at once, no projectile, synth sounds 10313 / 10322 / 10319 / 10311 (delays 21, 81, 108, 122),
 * and the hit 5 ticks later with synth sound 3533. It spends one of the staff's charges.
 */
module.exports = function registerEyeOfAyakSpecialAttack(api) {
  const { Animation, CombatMethod, CombatSpecial, CombatType, Graphic, ItemIdentifiers, PendingHit, Sound, Sounds } = api.core;

  const DRAIN = 50;
  const ATTACK_SPEED = 5;
  const HIT_DELAY = 5;
  const SPECIAL_ANIMATION = new Animation(12394);
  const PLAYER_GRAPHIC = 3364;
  const TARGET_GRAPHIC = 3365;
  const SOUNDS = [[10313, 21], [10322, 81], [10319, 108], [10311, 122]];
  const LAND_SOUND = 3533;
  const MAGIC_DEFENCE = 3; // NPC.getDefenceBonus index
  /** Magic Defence each NPC has lost to Soul Rend, kept while it lives (Wiki). */
  const drained = new WeakMap();

  function staffOf(player) {
    const request = { player, spell: null };
    api.emitCustomEvent("powered-staff:spell", request);
    return request.spell ? request : null;
  }

  /** Lowers an NPC's Magic Defence by the damage, from its own value, never below 0. */
  function rend(target, damage) {
    if (!target?.isNpc?.() || !(damage > 0) || typeof target.setDefenceBonusOverrides !== "function") return;
    const npc = target.getAsNpc();
    const state = drained.get(npc) ?? { base: npc.getDefenceBonus(MAGIC_DEFENCE), amount: 0 };
    state.amount += damage;
    drained.set(npc, state);
    // Keeps any other bonus a fight has already changed (Yama's).
    const overrides = [...(npc.defenceBonusOverrides ?? [null, null, null, null, null])];
    overrides[MAGIC_DEFENCE] = Math.max(0, state.base - state.amount);
    npc.setDefenceBonusOverrides(overrides);
  }

  class EyeOfAyakCombatMethod extends CombatMethod {
    type() {
      return CombatType.MAGIC;
    }

    canAttack(character) {
      const player = character.getAsPlayer();
      const staff = staffOf(player);
      if (!staff || staff.charges <= 0) {
        player.sendMessage("The Eye of Ayak has no charges! You need to charge it with demon tears or runes.");
        player.getCombat().reset();
        return false;
      }
      return true;
    }

    start(character, target) {
      const player = character.getAsPlayer();
      CombatSpecial.drain(character, DRAIN);
      staffOf(player)?.useCharge();
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(new Graphic(PLAYER_GRAPHIC));
      target.performGraphic(new Graphic(TARGET_GRAPHIC));
      for (const [id, delay] of SOUNDS) Sounds.sendSound(character, new Sound(id, 1, delay, 0));
    }

    hits(character, target) {
      const player = character.getAsPlayer();
      const spell = staffOf(player)?.spell ?? null;
      // The roll reads the selected spell: the staff's built-in one, for its max hit.
      const combat = player.getCombat();
      const previous = combat.getCastSpell?.() ?? null;
      combat.setCastSpell(spell);
      try {
        return [new PendingHit(character, target, this, HIT_DELAY).setSpell(spell)];
      } finally {
        combat.setCastSpell(previous);
      }
    }

    handleAfterHitEffects(hit) {
      const attacker = hit.getAttacker?.();
      if (attacker?.isPlayer?.()) Sounds.sendSound(attacker, new Sound(LAND_SOUND, 1, 0, 0));
      if (hit.isAccurate()) rend(hit.getTarget(), hit.getTotalDamage());
    }

    attackSpeed() {
      return ATTACK_SPEED;
    }

    attackDistance(character) {
      return staffOf(character.getAsPlayer())?.attackDistance(character) ?? 6;
    }
  }

  api.registerCombatSpecial({
    id: "eye_of_ayak",
    itemIds: [ItemIdentifiers.EYE_OF_AYAK],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      rollAttackType: "magic",
      damageType: "magic",
      accuracyMultiplier: 2,
      damageMultiplier: 1.3,
    },
    combatMethod: new EyeOfAyakCombatMethod(),
  });
};
