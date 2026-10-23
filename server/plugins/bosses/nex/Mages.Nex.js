/**
 * Nex's four mages: immobile, and fighting only once she calls them (Fight.Nex). Captured: a cast
 * every 5 ticks with seq 1979 and the barrage's sound; Fumus and Glacies send a projectile, Umbra
 * and Cruor don't; Umbra's hit is followed by "You have been blinded!". Wiki ("Fumus", "Umbra",
 * "Cruor", "Glacies"): max hit 29; Fumus poisons, Umbra lowers Attack by 15%, Cruor heals himself a
 * quarter of the damage, Glacies freezes for 6 ticks through prayer (if the last freeze ended over
 * 5 ticks before, Mod Ash).
 */
const Common = require("./Common.Nex");

const KEYS = ["fumus", "umbra", "cruor", "glacies"];

function spec(npc) {
  return Common.data.mages[npc.__nexMage];
}

/** A mage's effect on a hit that landed. */
function applyEffect(mage, player, damage) {
  const { CombatFactory, Skill } = Common.core;
  const key = mage.__nexMage;
  const own = Common.data.mages[key];
  if (key === "fumus") {
    if (damage > 0) CombatFactory.poisonEntity(player, own.poison, 1);
  } else if (key === "umbra") {
    player.sendMessage(own.blinded);
    const skills = player.getSkillManager();
    const max = skills.getMaxLevel(Skill.ATTACK);
    if (skills.getCurrentLevel(Skill.ATTACK) >= max) skills.decreaseCurrentLevel(Skill.ATTACK, Math.floor(max * own.attackDrain), 1);
  } else if (key === "cruor") {
    if (damage > 0) Common.healNpc(mage, damage * own.heal, mage.getCurrentDefinition().getHitpoints?.() ?? 500);
  } else if (key === "glacies") {
    const fight = mage.__nexFight;
    if (fight) fight.effects.freeze(player, own.freezeTicks);
    else CombatFactory.freeze(player, own.freezeTicks * 0.6);
  }
}

function mageClass() {
  const { CombatMethod, CombatType, CombatFactory, PendingHit } = Common.core;
  return class NexMageCombat extends CombatMethod {
    type() {
      return CombatType.MAGIC;
    }

    attackDistance() {
      return Common.data.mages.reach;
    }

    attackSpeed() {
      return Common.data.mages.attackSpeed;
    }

    canAttack(mage) {
      const fight = mage.__nexFight;
      return !!fight && !fight.stopped && !fight.isImmuneMage(mage);
    }

    start(mage, target) {
      const own = spec(mage);
      mage.performAnimation(Common.animation(Common.data.mages.anim));
      Common.areaSound(mage.__nexFight?.players() ?? [], mage.getLocation(), [own.sound, 0, 7]);
      if (own.projectile) Common.projectile(mage, target, own.projectile);
    }

    hits(mage, target) {
      const hit = new PendingHit(mage, target, this, Common.data.mages.hitDelay);
      CombatFactory.applyStyleDamage(hit, Common.data.mages.maxHit, {});
      return [hit];
    }

    handleAfterHitEffects(hit) {
      const target = hit.getTarget();
      const mage = hit.getAttacker();
      if (!target?.isPlayer?.() || !mage?.__nexMage) return;
      const own = spec(mage);
      const { fight } = Common.data;
      if (!hit.isAccurate()) {
        target.performGraphic(Common.graphic(fight.attacks.splash.graphic, { height: fight.attacks.splash.height }));
        return;
      }
      target.performGraphic(Common.graphic(own.impact, { height: own.impactHeight ?? 0, delay: own.impactDelay ?? 0 }));
      applyEffect(mage, target.getAsPlayer(), hit.getTotalDamage());
    }
  };
}

function attachMages(api) {
  const { npcs } = Common.data;
  api.registerNpcCombatMethodProvider(KEYS.map((key) => npcs.mages[key]), mageClass(), { singleton: false });
}

module.exports = { attachMages, applyEffect };
