// TODO: ported from xrsps-typescript; untested.
module.exports = function registerDragonClawSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod, Priority, Sounds } = api.core;

  const DRAIN = 50;
  const HIT_COUNT = 4;
  const ACCURACY_ROLLS = 4;
  const SLASH_DEFENCE_BONUS_INDEX = 1;
  const ANIMATION = new Animation(7514);
  const GRAPHIC = new Graphic(1171, Priority.HIGH);

  // Redistributes the successful branch's single integer roll across the four
  // Slice and Dice hitsplats. All divisions deliberately floor.
  function calculateDragonClawsHitDistribution(firstSuccessfulAccuracyRoll, rolledDamage) {
    const branch = Math.max(1, Math.min(4, Math.trunc(firstSuccessfulAccuracyRoll)));
    const damage = Math.max(0, Math.floor(rolledDamage));
    if (branch === 1) {
      return [damage, Math.floor(damage / 2), Math.floor(damage / 4), Math.floor(damage / 4) + 1];
    }
    if (branch === 2) {
      return [0, damage, Math.floor(damage / 2), Math.floor(damage / 2) + 1];
    }
    if (branch === 3) {
      return [0, 0, damage, damage + 1];
    }
    return [0, 0, 0, damage];
  }

  const DRAGON_CLAWS_DAMAGE_RANGES = [
    {
      minimumDamageMultiplier: 0.5,
      maximumDamageMultiplier: 1,
      maximumDamageReduction: 1,
      hitDamageMultipliers: [1, 0.5, 0.25, 0.25],
      distributeDamage: (damage) => calculateDragonClawsHitDistribution(1, damage),
    },
    {
      minimumDamageMultiplier: 3 / 8,
      maximumDamageMultiplier: 7 / 8,
      hitDamageMultipliers: [0, 1, 0.5, 0.5],
      distributeDamage: (damage) => calculateDragonClawsHitDistribution(2, damage),
    },
    {
      minimumDamageMultiplier: 1 / 4,
      maximumDamageMultiplier: 3 / 4,
      hitDamageMultipliers: [0, 0, 1, 1],
      distributeDamage: (damage) => calculateDragonClawsHitDistribution(3, damage),
    },
    {
      minimumDamageMultiplier: 1 / 4,
      maximumDamageMultiplier: 5 / 4,
      hitDamageMultipliers: [0, 0, 0, 1],
      distributeDamage: (damage) => calculateDragonClawsHitDistribution(4, damage),
    },
  ];

  // Uniform selection gives 1/3 all-zero and 2/3 two-damage outcomes.
  const DRAGON_CLAWS_ALL_MISS_PATTERNS = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [1, 1, 0, 0],
    [0, 0, 1, 1],
    [1, 0, 1, 0],
    [0, 1, 0, 1],
  ];

  class DragonClawCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(ANIMATION);
      character.performGraphic(GRAPHIC);
      Sounds.sendSound(character, character.getAttackSound());
    }
  }

  api.registerCombatSpecial({
    id: "dragon_claws",
    itemIds: [ItemIdentifiers.DRAGON_CLAWS],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: HIT_COUNT,
      accuracyMultiplier: 1,
      damageMultiplier: 1,
      meleeDefenceBonusIndex: SLASH_DEFENCE_BONUS_INDEX,
      accuracyRollCount: ACCURACY_ROLLS,
      firstSuccessfulAccuracyDamageRanges: DRAGON_CLAWS_DAMAGE_RANGES,
      allMissDamagePatterns: DRAGON_CLAWS_ALL_MISS_PATTERNS,
      hitDelayTicks: [0, 0, 1, 1],
    },
    combatMethod: new DragonClawCombatMethod(),
    metadata: { finisherDamageMultiplier: 2 },
  });
};
