// TODO: ported from xrsps-typescript; untested.
module.exports = function registerBurningClawsSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod, Sound, Sounds } = api.core;

  const DRAIN = 35;
  const SPECIAL_ANIMATION = new Animation(11140);
  const SPECIAL_VFX = new Graphic(2814);
  const SLASH_DEFENCE_BONUS_INDEX = 1;
  const ACCURACY_ROLLS = 3;
  // Wiki (Burning claws): a burn deals 10 damage over 40 ticks, up to five at once. Each hitsplat
  // burns with the chance of the accuracy roll that landed (1st, 2nd, 3rd); a full miss never burns.
  const BURN_TOTAL_DAMAGE = 10;
  const BURN_CHANCE_BY_ROLL = [0.15, 0.3, 0.45];

  class BurningClawsCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
      // Live (rsprox 3327): two synth sounds 29 and 60 cycles after the special starts.
      Sounds.sendSound(character, Sound.BURNING_CLAWS_SPECIAL_1);
      Sounds.sendSound(character, Sound.BURNING_CLAWS_SPECIAL_2);
    }

    handleAfterHitEffects(hit) {
      const chance = BURN_CHANCE_BY_ROLL[hit.getFirstSuccessfulRangeIndex()];
      if (!chance) {
        return;
      }
      for (let i = 0; i < hit.getHits().length; i++) {
        if (Math.random() < chance) {
          api.emitCustomEvent("combat:burn", {
            attacker: hit.getAttacker(), target: hit.getTarget(), damage: BURN_TOTAL_DAMAGE, severity: "normal",
          });
        }
      }
    }
  }

  api.registerCombatSpecial({
    id: "burning_claws",
    itemIds: [ItemIdentifiers.BURNING_CLAWS],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 3,
      meleeDefenceBonusIndex: SLASH_DEFENCE_BONUS_INDEX,
      accuracyRollCount: ACCURACY_ROLLS,
      firstSuccessfulAccuracyDamageRanges: [
        { minimumDamageMultiplier: 0.75, maximumDamageMultiplier: 1.75, hitDamageMultipliers: [0.25, 0.25, 0.5] },
        { minimumDamageMultiplier: 0.5, maximumDamageMultiplier: 1.5, hitDamageMultipliers: [0.5, 0.5, 0], hitDamageBonuses: [-1, -1, 2] },
        { minimumDamageMultiplier: 0.25, maximumDamageMultiplier: 1.25, hitDamageMultipliers: [0, 0, 1], hitDamageBonuses: [1, 1, -2] },
      ],
    },
    combatMethod: new BurningClawsCombatMethod(),
  });
};
