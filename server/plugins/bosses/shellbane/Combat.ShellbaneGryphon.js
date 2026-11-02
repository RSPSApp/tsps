/**
 * The Shellbane gryphon's attacks (Wiki: Shellbane_gryphon, /Strategies):
 * - melee up to 22, or now and then a ranged one up to 22 (even beside the player), every 5
 *   ticks; every few attacks a special instead (Fight.ShellbaneGryphon.js);
 * - without a tortugan shield worn, its melee is devastating: Protect from Melee doesn't stop it
 *   ("You need some sort of protection!") - the hit's roll bypasses the prayer; with one, the
 *   prayer works as usual.
 */
const Common = require("./Common.ShellbaneGryphon");

function hitDelay(distance) {
  return 1 + Math.floor((3 + distance) / 6);
}

/** Cycles before the ranged projectile shows. */
const LAUNCH = 30;

/**
 * Where its ranged projectile ends: on the hit's tick (30 cycles a tick), except that a 1-tick
 * hit would end at its own launch (drawn for a cycle on the gryphon), so those fly 5 + 5 a tile (#1862).
 */
function flightEnd(distance) {
  const end = hitDelay(distance) * 30;
  return end > LAUNCH + 1 ? end : LAUNCH + 5 + 5 * distance;
}

function methods() {
  const { CombatMethod, CombatType, PendingHit, Animation, Projectile } = Common.core;
  const { combat } = Common.data;

  class GryphonCombat extends CombatMethod {
    start(character, target) {
      this.plan = null;
      const npc = character?.getAsNpc?.();
      const fight = npc?.__sgCave?.fight;
      const player = target?.isPlayer?.() ? target.getAsPlayer() : null;
      if (!fight || fight.stopped || !player) return;
      fight.attacks += 1;
      const { ids } = Common;
      if (fight.attacks % combat.specialEvery === 0) {
        fight.special(player);
        return;
      }
      const distance = Common.distanceToNpc(player.getLocation(), npc);
      const ranged = distance > 1 || fight.random() < combat.rangedChance;
      if (ranged) {
        this.style = "ranged";
        npc.performAnimation(new Animation(ids.seqs.ranged));
        // The hit lands with the projectile.
        const end = flightEnd(distance);
        const delay = Projectile.ticksToLand(end);
        new Projectile(Projectile.centreOf(npc), player.getLocation(), player, ids.spotanims.rangedProjectile, LAUNCH, end, 60, 31, npc.getPrivateArea?.() ?? null).sendProjectile();
        this.plan = { delay, typeless: false };
        return;
      }
      this.style = "melee";
      npc.performAnimation(new Animation(ids.seqs.melee));
      const shielded = Common.wearingShield(player);
      if (!shielded && !fight.warnedNoShield) {
        fight.warnedNoShield = true;
        player.sendMessage(Common.message("devastating"));
      }
      this.plan = { delay: 0, unshielded: !shielded };
    }

    hits(character, target) {
      if (!this.plan) return [];
      const hit = new PendingHit(character, target, this, this.plan.delay);
      hit.setTotalDamage(Math.min(combat.maxHit, hit.getTotalDamage()));
      return [hit];
    }

    attackDistance() {
      return 8;
    }

    attackSpeed() {
      return combat.attackSpeed;
    }

    type() {
      return this.style === "ranged" ? CombatType.RANGED : CombatType.MELEE;
    }
  }

  return { GryphonCombat };
}

/** "combat:hit-roll": its melee goes through Protect from Melee on a player without the shield. */
function hitRoll(roll) {
  const npc = roll.attacker?.isNpc?.() ? roll.attacker.getAsNpc() : null;
  if (npc?.getId?.() !== Common.ids.npcs.boss || !roll.target?.isPlayer?.()) return;
  if (roll.combatType !== Common.core.CombatType.MELEE) return;
  if (!Common.wearingShield(roll.target.getAsPlayer())) roll.bypassProtectionPrayer = true;
}

function attach(api) {
  api.onCombatHitRoll(hitRoll);
  const { GryphonCombat } = methods();
  api.registerNpcCombatMethodProvider([Common.ids.npcs.boss], GryphonCombat, { singleton: false });
}

module.exports = { attach, methods, hitDelay, flightEnd, hitRoll };
