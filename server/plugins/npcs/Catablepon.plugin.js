"use strict";

/**
 * Catablepons (Stronghold of Security, Pestilence floor) and their weakening glare
 * (docs/catablepon.md).
 *
 * rsprox captures (rec 339 ticks 1172-1236, 1844 ticks 8064/8095, 75 ticks 11422/11434, 1000217,
 * 1000414): every recorded catablepon attack on a player is a Weaken cast. It plays
 * catpon_attack_breath (4272) with weaken_casting (105), weaken_travel (106) and weaken_impact (107),
 * area sounds 3011 and 3010; a splash shows failedspell_impact (85) with sound 227. A landed glare
 * shows "You feel weakened." and the zero hitsplat on the cast's own tick, and lowers Strength by
 * floor(5% of the current level) + 1 (90->85, 104->98, 40->37, 37->35, 3->2), stacking on a lowered
 * level (40->37->35).
 *
 * Wiki (Catablepon): it "will stop casting once 8% + 3 of your total strength level has been
 * drained"; after that it attacks as before. Ours: the threshold rounds 8% down, as the Wiki gives no
 * rounding, and no recording drains a player that far.
 */
const CATABLEPON_IDS = [2474, 2475, 2476]; // sos_pest_catablepon, _2, _3
const BREATH_ANIMATION = 4272; // catpon_attack_breath
const WEAKEN_IMPACT = 107; // weaken_impact, sent with the cast and delayed to the projectile's end
const IMPACT_DELAY_CYCLES = 56;
const WEAKENED_MESSAGE = "You feel weakened.";

/** Strength the glare can still take before it stops (Wiki: 8% + 3 of the base level). */
function drainLimit(base) {
  return Math.floor(base * 0.08) + 3;
}

/** Whether the glare is still used on this target: a player drained by less than the limit. */
function glares(target) {
  if (!target?.isPlayer?.()) return false;
  const skills = target.getAsPlayer().getSkillManager();
  const strength = pluginCore.Skill.STRENGTH;
  const base = skills.getMaxLevel(strength);
  return base - skills.getCurrentLevel(strength) < drainLimit(base);
}

/** floor(5%) + 1 of the current level (the recorded drops above). */
function glareDrain(current) {
  return Math.floor(current * 0.05) + 1;
}

function isCatablepon(mobile) {
  if (!mobile?.isNpc?.()) return false;
  const npc = mobile.getAsNpc();
  return CATABLEPON_IDS.includes(npc.getId()) || CATABLEPON_IDS.includes(npc.getRealId?.());
}

let pluginCore;
let glareSpell;
let glareMethod;

function createGlare(core) {
  const { Animation, Graphic, GraphicHeight, CombatSpells, MagicCombatMethod } = core;
  // Weaken (spell id 1157: its curse rule, sounds and splash) cast with the breath, landing on the cast's tick.
  glareSpell = Object.create(CombatSpells.WEAKEN, {
    castAnimation: { value: () => new Animation(BREATH_ANIMATION) },
    hitDelay: { value: () => 0 },
    endGraphic: { value: () => new Graphic(WEAKEN_IMPACT, IMPACT_DELAY_CYCLES, GraphicHeight.HIGH) },
  });

  class GlareCombat extends MagicCombatMethod {
    start(npc, target) {
      npc.getCombat().setCastSpell(glareSpell);
      super.start(npc, target);
    }

    hits(npc, target) {
      const hits = super.hits(npc, target);
      for (const hit of hits) hit.setTotalDamage(0);
      return hits;
    }

    finished(npc) {
      npc.getCombat().setPreviousCast(glareSpell);
      npc.getCombat().setCastSpell(null);
    }
  }
  glareMethod = new GlareCombat();

  /**
   * The provider builds one per lookup (singleton: false); returning another object from a
   * constructor hands that object to `new`, so a catablepon past the limit keeps its own method.
   */
  return function CatableponCombat(npc) {
    return glares(npc?.getCombat?.().getTarget?.()) ? glareMethod : npc.getCombatMethod();
  };
}

function curseRule(rule) {
  if (!isCatablepon(rule.attacker) || rule.spell?.spellId?.() !== glareSpell?.spellId?.()) return;
  if (!rule.target?.isPlayer?.()) return;
  rule.stacks = true;
  rule.decrease = glareDrain(rule.current);
  rule.message = WEAKENED_MESSAGE;
}

module.exports = {
  name: "Catablepon",
  description: "Catablepons cast their weakening glare (Weaken) on players until 8% + 3 of their Strength is drained.",
  members: false,
  register(api) {
    pluginCore = api.core;
    api.registerNpcCombatMethodProvider(CATABLEPON_IDS, createGlare(api.core), { singleton: false });
    api.onCustomEvent("magic:curse-rule", curseRule);
  },
  drainLimit,
  glareDrain,
  CATABLEPON_IDS,
};
