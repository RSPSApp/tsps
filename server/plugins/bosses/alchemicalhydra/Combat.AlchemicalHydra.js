/**
 * The Alchemical Hydra's combat method (Wiki: Alchemical Hydra/Strategies; stats from
 * monsters-complete): ranged and magic, switching every three basic attacks (every attack once
 * enraged), 35 at most and every 6 ticks, 55 and every 4 ticks enraged (52 while an incorrect
 * vent has empowered it); the phase's special in place of an attack when the count says so
 * (Fight.AlchemicalHydra.js). Protection prayers block its attacks entirely, as for any NPC.
 */
const Common = require("./Common.AlchemicalHydra");

/** OSRS hit delays: magic 1 + (1 + d) / 3, ranged 1 + (3 + d) / 6 ticks. */
function hitDelay(style, distance) {
  if (style === "magic") return 1 + Math.floor((1 + distance) / 3);
  return 1 + Math.floor((3 + distance) / 6);
}

/** Cycles before the projectile shows. */
const LAUNCH = 30;

/**
 * Where the projectile ends: on the hit's tick (30 cycles a tick), except that a 1-tick hit
 * would end at its own launch (drawn for a cycle on the Hydra), so those fly 5 + 10 (magic) or
 * 5 (ranged) a tile instead (#1862).
 */
function flightEnd(style, distance) {
  const end = hitDelay(style, distance) * 30;
  return end > LAUNCH + 1 ? end : LAUNCH + 5 + (style === "magic" ? 10 : 5) * distance;
}

function combatClass() {
  const { CombatMethod, CombatType, PendingHit, Animation, Projectile } = Common.core;
  const { combat } = Common.data;

  class HydraCombat extends CombatMethod {
    hits(character, target) {
      if (!character || !target || !this.style) return [];
      const fight = character.getAsNpc?.()?.__hydraFight;
      const max = fight?.maxHit?.() ?? combat.maxHit;
      const hit = new PendingHit(character, target, this, this.delay);
      hit.setTotalDamage(Math.min(max, hit.getTotalDamage()));
      return [hit];
    }

    start(character, target) {
      this.style = null;
      const npc = character?.getAsNpc?.();
      const fight = npc?.__hydraFight;
      if (!npc || !fight || fight.stopped || !target) return;
      if (fight.transitioning()) {
        character.getCombat().setAttackDelay(1);
        return;
      }
      const kind = fight.nextAttack();
      fight.counted(kind);
      const { ids } = Common;
      if (kind === "special") {
        npc.performAnimation(new Animation(ids.seqs.special[fight.phase]));
        const special = Common.data.phases[fight.phase].special;
        if (special === "poison") fight.spitPoison(target);
        else if (special === "lightning") fight.castLightning();
        else if (special === "fire") fight.breatheFire(target);
        return;
      }
      this.style = kind;
      npc.performAnimation(new Animation((kind === "magic" ? ids.seqs.magic : ids.seqs.ranged)[fight.phase]));
      const distance = Common.distanceToFootprint(target.getLocation(), npc);
      const end = flightEnd(kind, distance);
      // The hit lands with the projectile.
      this.delay = Projectile.ticksToLand(end);
      const projectile = kind === "magic" ? ids.spotanims.magic : ids.spotanims.ranged;
      new Projectile(Projectile.centreOf(npc), target.getLocation(), target, projectile, LAUNCH, end, 80, 31, npc.getPrivateArea?.() ?? null).sendProjectile();
    }

    attackDistance() {
      return combat.attackDistance;
    }

    attackSpeed(character) {
      return character?.getAsNpc?.()?.__hydraFight?.enraged ? combat.enragedAttackSpeed : combat.attackSpeed;
    }

    type() {
      return this.style === "magic" ? CombatType.MAGIC : CombatType.RANGED;
    }
  }
  return HydraCombat;
}

function attach(api) {
  api.registerNpcCombatMethodProvider(Common.phaseForms(), combatClass(), { singleton: false });
}

module.exports = { attach, combatClass, hitDelay, flightEnd };
