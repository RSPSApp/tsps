// TODO: ported from xrsps-typescript; untested apart from its prayer piercing.
// Wild Stab (Wiki: Dragon sword) ignores Protect from Melee, and since the 22 October 2025
// update NPC melee prayers too.
const ID = "dragon_sword";

let core;

/** NPC prayers only yield to a hit its roll hook marked; the trait covers players. */
function pierceNpcMeleePrayer(roll) {
  const attacker = roll.attacker;
  if (roll.combatType === core.CombatType.MELEE
    && attacker?.isPlayer?.() === true
    && attacker.getAsPlayer().isSpecialActivated()
    && attacker.getAsPlayer().getCombatSpecial()?.getId() === ID) {
    roll.bypassProtectionPrayer = true;
  }
}

module.exports = function registerDragonSwordSpecialAttack(api) {
  core = api.core;
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod } = api.core;

  const DRAIN = 40;
  const SPECIAL_ANIMATION = new Animation(7515);
  const SPECIAL_VFX = new Graphic(1369);

  class DragonSwordCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
    }
  }

  api.registerCombatSpecial({
    id: ID,
    itemIds: [ItemIdentifiers.DRAGON_SHORTSWORD, ItemIdentifiers.DRAGON_SHORTSWORD_CR_],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      accuracyMultiplier: 1.25,
      damageMultiplier: 1.25,
      meleeDefenceBonusIndex: 0,
      ignoreProtectionPrayer: true,
    },
    combatMethod: new DragonSwordCombatMethod(),
  });
  api.onCombatHitRoll(pierceNpcMeleePrayer);
};
