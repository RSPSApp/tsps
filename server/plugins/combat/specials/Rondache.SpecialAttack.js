// Rondache's Shield Slam (https://oldschool.runescape.wiki/w/Rondache). The combat tab shows it as
// a special bar counting the shield's charges (cs2 10148/10159: varbit rondache_charges, max 20),
// so it is toggled with the special bar button like a weapon's. Wiki: needs 10 or more charges,
// uses all of them and no special attack energy; rolls against Crush defence with +6 Crush
// accuracy per charge; deals x + x% damage for x charges (24 at 20).
// Estimates: the hit lands after one tick; the
// refusal message; the animation (tfa_human_rondache_special) and gfx (vfx_tfa_rondache_special)
// are the cache's names for it.
const Effects = require("../effects/Rondache.EquipmentEffects");

const MIN_CHARGES = 10;
const ACCURACY_PER_CHARGE = 6;

module.exports = function registerRondacheSpecialAttack(api) {
  const { CanAttackResponse, AccuracyFormulasDpsCalc, Animation, BonusManager, CacheDefinitions, CombatMethod, CombatSpecial, CombatType, Graphic, CombatFactory, MeleeCombatMethod, PendingHit, ItemIdentifiers } = api.core;

  const roll = (max) => Math.floor(Math.random() * (max + 1));

  function slam(player, target) {
    const used = Effects.charges(player);
    const crushBonus = player.getBonusManager().getAttackBonus()[BonusManager.ATTACK_CRUSH] + ACCURACY_PER_CHARGE * used;
    const attack = Math.floor(AccuracyFormulasDpsCalc.effectiveAttackLevel(player) * (crushBonus + 64));
    const defence = AccuracyFormulasDpsCalc.defenseMeleeRoll(target, BonusManager.ATTACK_CRUSH);
    const damage = Math.floor(used + (used * used) / 100);
    return roll(attack) > roll(defence) ? damage : 0;
  }

  class ShieldSlamCombatMethod extends CombatMethod {
    hits() {
      return null;
    }

    type() {
      return CombatType.MELEE;
    }

    start(character) {
      const player = character.getAsPlayer();
      const target = player.getCombat().getTarget();
      if (Effects.charges(player) < MIN_CHARGES) {
        player.sendMessage("Your rondache needs at least 10 charges to use Shield Slam.");
        return;
      }
      if (!target) {
        player.sendMessage("You need a target to use Shield Slam.");
        return;
      }
      // Utility activation skips the combat loop: validate this melee slam before paying or rolling.
      if (CombatFactory.canAttack(player, this, target) !== CanAttackResponse.CAN_ATTACK
          || !player.getCombat().resolveCanReachForCurrentCycle(this, target)) return;
      const damage = slam(player, target);
      Effects.setCharges(player, 0);
      // No special energy, but a special attack performed ("combat-special:performed" rides on drain).
      CombatSpecial.drain(player, 0, false);
      player.performAnimation(new Animation(CacheDefinitions.getSeqId("tfa_human_rondache_special")));
      player.performGraphic(new Graphic(CacheDefinitions.getSpotanimId("vfx_tfa_rondache_special")));
      // Accuracy is rolled above, so the hit skips its own roll but still meets protection prayers, hooks and XP.
      CombatFactory.addPendingHit(new PendingHit(player, target, new MeleeCombatMethod(), { damage, rollAccuracy: false, delay: 1 }));
    }
  }

  // Shield-slot special: core's CombatSpecial.assign falls back to the worn shield's.
  api.registerCombatSpecial({
    id: "rondache",
    itemIds: [ItemIdentifiers.RONDACHE, ItemIdentifiers.RONDACHE_2, ItemIdentifiers.RONDACHE_3],
    drainAmount: 0,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { skipAttack: true },
    combatMethod: new ShieldSlamCombatMethod(),
  });
};
