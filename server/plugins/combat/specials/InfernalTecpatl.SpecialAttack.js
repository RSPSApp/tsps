/**
 * Brand, the Infernal tecpatl's special (Wiki: Infernal tecpatl): 50% energy, four hits in quick
 * succession with 25% more max hit and accuracy, the damage "split depending on which hits pass
 * accuracy".
 *
 * Ours, as the Wiki gives no formula: each of the four hits rolls its own accuracy, and the first
 * accurate hit's damage roll (0 to the boosted max, through the usual roll hooks) is shared out over
 * the accurate hits in whole numbers, the remainder on the later ones; an accurate hit shows at
 * least 1. All four land together, as dragon claws' do. The animation is the cache's
 * human_infernal_tecpatl_spec, which carries the special's four sounds. The raw roll is split, and
 * each share then gets flat armour on its own (Wiki: Flat armour, "applied to each hitsplat
 * separately") before its HP cap, both in PendingHit.
 */
let core;

const DRAIN = 50;
const HIT_COUNT = 4;
const SPECIAL_ANIMATION = "human_infernal_tecpatl_spec";

function weaponIds() {
  return [core.ItemIdentifiers.INFERNAL_TECPATL];
}

/** Damage `total` shared over `count` hits in whole numbers, the remainder on the later ones. */
function share(total, index, count) {
  return Math.floor((total * (index + 1)) / count) - Math.floor((total * index) / count);
}

/**
 * The first accurate hitsplat's raw roll, shared over every accurate hitsplat; the misses deal 0.
 * PendingHit's splitDamage step: flat armour and the HP cap follow on each splat.
 */
function splitAcrossAccurate(splats, accurate) {
  const { HitMask } = core;
  const landed = splats.filter((_, index) => accurate[index]);
  const total = landed.length ? landed[0].getDamage() : 0;
  let position = 0;
  for (let i = 0; i < splats.length; i++) {
    const value = accurate[i] ? Math.max(1, share(total, position++, landed.length)) : 0;
    splats[i].setDamage(value);
    splats[i].setHitmask(value > 0 ? HitMask.RED : HitMask.BLUE);
  }
}

function brandHits(character, target, method) {
  const { CombatFactory, PendingHit } = core;
  try {
    // The boosted accuracy must not reuse a roll primed earlier this cycle (or leak into a later one).
    CombatFactory.clearHitRollCache(character);
    return [new PendingHit(character, target, method, { hitAmount: HIT_COUNT, splitDamage: splitAcrossAccurate })];
  } finally {
    CombatFactory.clearHitRollCache(character);
  }
}

function buildSpecial() {
  const { Animation, CacheDefinitions, CombatSpecial, MeleeCombatMethod } = core;

  class InfernalTecpatlCombatMethod extends MeleeCombatMethod {
    start(character) {
      CombatSpecial.drain(character, DRAIN);
      const animationId = CacheDefinitions.getSeqId(SPECIAL_ANIMATION);
      if (animationId != null) character.performAnimation(new Animation(animationId));
    }

    hits(character, target) {
      return brandHits(character, target, this);
    }
  }

  return {
    id: "infernal_tecpatl",
    itemIds: weaponIds(),
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: HIT_COUNT,
      accuracyMultiplier: 1.25,
      damageMultiplier: 1.25,
    },
    combatMethod: new InfernalTecpatlCombatMethod(),
  };
}

module.exports = function registerInfernalTecpatlSpecialAttack(api) {
  core = api.core;
  api.registerCombatSpecial(buildSpecial());
};

module.exports._test = { share, splitAcrossAccurate };
