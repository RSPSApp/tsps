/**
 * The Guardians' combat methods (Wiki: Grotesque Guardians/Strategies, Dusk, Dawn):
 * - Dawn: two ranged hits of up to 9 at range, a kick of up to 15 beside her, and every fifth
 *   attack a stone ball (3x3, up to 15, frozen for 10 ticks); she doesn't attack while airborne;
 * - Dusk: slashes of up to 15 from beside him (defensive or not); every sixth attack in phase 2 his
 *   explosion (up to 30 to anyone next to him two ticks on); enraged, slashes of up to 26 or two
 *   ranged orbs of up to 15, switching style 1 time in 6 (1 in 3 when the player prays against
 *   his last), and a prison every eighth attack.
 * All every 6 ticks. Dawn's normal attacks are fully protected; Dusk's melee loses 80% damage,
 * and his ranged cap is halved. His first orb is fixed at 60% of his usual max, the second rolled twice.
 */
const Common = require("./Common.GrotesqueGuardians");
const { bind } = require("./Fight.GrotesqueGuardians");

function hitDelay(style, distance) {
  if (style === "magic") return 1 + Math.floor((1 + distance) / 3);
  if (style === "ranged") return 1 + Math.floor((3 + distance) / 6);
  return 0;
}

/** Cycles before a projectile shows. */
const LAUNCH = 30;

/**
 * Where a projectile ends: on the hit's tick (30 cycles a tick), except that a 1-tick hit would
 * end at its own launch (drawn for a cycle on the Guardian), so those fly 5 + 5 a tile (#1862).
 */
function flightEnd(style, distance) {
  const end = hitDelay(style, distance) * 30;
  return end > LAUNCH + 1 ? end : LAUNCH + 5 + 5 * distance;
}

/** Chebyshev distance from a tile to an NPC's footprint (0 inside it). */
function distanceTo(location, npc) {
  const base = npc.getLocation();
  const size = Math.max(1, npc.getSize());
  const dx = Math.max(base.getX() - location.getX(), 0, location.getX() - (base.getX() + size - 1));
  const dy = Math.max(base.getY() - location.getY(), 0, location.getY() - (base.getY() + size - 1));
  return Math.max(dx, dy);
}

/**
 * Enraged Dusk's style: the first attack 2 in 3 the one the player isn't praying against, then a
 * 1 in 6 switch, 1 in 3 when the player prays against his last (Wiki).
 */
function nextEnragedStyle(npc, target, random = Math.random) {
  const prayers = Common.api.getPrayerHandler();
  const against = (style) => (style === "melee" ? prayers.isActivated(target, prayers.PROTECT_FROM_MELEE) : prayers.isActivated(target, prayers.PROTECT_FROM_MISSILES));
  let next;
  if (!npc.__ggLastStyle) {
    const bypass = against("melee") ? "ranged" : "melee";
    next = random() < 2 / 3 ? bypass : (bypass === "melee" ? "ranged" : "melee");
  } else {
    const last = npc.__ggLastStyle;
    const switches = random() < (against(last) ? 1 / 3 : 1 / 6);
    next = switches ? (last === "melee" ? "ranged" : "melee") : last;
  }
  npc.__ggLastStyle = next;
  return next;
}

/** Dusk's protection reduction is already included in the damage passed to PendingHit. */
function partialProtection(roll) {
  if (roll.attacker?.__ggFight && Common.isDusk(roll.attacker)) roll.bypassProtectionPrayer = true;
}

function methods() {
  const { CombatMethod, CombatType, PendingHit, PrayerHandler, Animation, Projectile } = Common.core;
  const { dawn, dusk } = Common.data;

  function hitsFor(method, character, target) {
    if (!method.plan) return [];
    return method.plan.map(({ style, delay, max, fixed, nested }) => {
      method.style = style;
      const protectedHit = Common.isDusk(character) && PrayerHandler.isActivated(target, PrayerHandler.getProtectingPrayer(method.type()));
      if (protectedHit && style === "ranged") max = Math.floor(max / 2);
      let damage = fixed ? max : Common.randomInt(0, max);
      if (nested) damage = Common.randomInt(0, damage);
      if (protectedHit && style === "melee") damage = Math.floor(damage / 5);
      // Accuracy, incoming damage effects and the target's HP cap are still applied once by core.
      return new PendingHit(character, target, method, { delay, damage });
    });
  }

  function shoot(npc, target, id, end) {
    new Projectile(Projectile.centreOf(npc), target.getLocation(), target, id, LAUNCH, end, 70, 31, npc.getPrivateArea?.() ?? null).sendProjectile();
  }

  class DawnCombat extends CombatMethod {
    hits(character, target) {
      return hitsFor(this, character, target);
    }

    start(character, target) {
      this.plan = null;
      const npc = character?.getAsNpc?.();
      const fight = npc?.__ggFight;
      if (!fight || fight.stopped || fight.phase === 2 || fight.phase === 4) {
        character.getCombat().setAttackDelay(2);
        return;
      }
      fight.attacks.dawn += 1;
      const { ids } = Common;
      const distance = distanceTo(target.getLocation(), npc);
      if (fight.attacks.dawn % dawn.stoneBall.every === 0) {
        npc.performAnimation(new Animation(ids.seqs.dawnStun));
        const tile = target.getLocation();
        shoot(npc, target, ids.spotanims.stoneBall, 3 * 30);
        Common.later(3, () => {
          if (fight.stopped) return;
          for (const player of fight.roof.players()) {
            if (Common.chebyshev(player.getLocation(), tile) > 1) continue;
            Common.hurtPlayer(player, Common.randomInt(0, dawn.stoneBall.max));
            bind(player, dawn.stoneBall.freezeTicks);
            player.sendMessage(Common.message("stoned"));
          }
        });
        return;
      }
      if (distance <= 1) {
        npc.performAnimation(new Animation(ids.seqs.dawnSlash));
        this.plan = [{ style: "melee", delay: 0, max: dawn.meleeMax }];
        return;
      }
      npc.performAnimation(new Animation(ids.seqs.dawnRanged));
      // Both hits land with the projectile.
      const end = flightEnd("ranged", distance);
      const delay = Projectile.ticksToLand(end);
      shoot(npc, target, ids.spotanims.dawnRanged, end);
      this.plan = [{ style: "ranged", delay, max: dawn.rangedMax }, { style: "ranged", delay, max: dawn.rangedMax }];
    }

    attackDistance() {
      return 8;
    }

    attackSpeed() {
      return dawn.attackSpeed;
    }

    type() {
      return this.style === "melee" ? CombatType.MELEE : CombatType.RANGED;
    }
  }

  class DuskCombat extends CombatMethod {
    hits(character, target) {
      return hitsFor(this, character, target);
    }

    start(character, target) {
      this.plan = null;
      const npc = character?.getAsNpc?.();
      const fight = npc?.__ggFight;
      if (!fight || fight.stopped) return;
      fight.attacks.dusk += 1;
      const { ids } = Common;
      const n = fight.attacks.dusk;
      const distance = distanceTo(target.getLocation(), npc);
      if (fight.phase === 4) {
        if (n % Common.data.prison.every === 0) {
          fight.imprison(target);
          return;
        }
        this.style = nextEnragedStyle(npc, target);
        if (this.style === "melee" && distance <= 1) {
          npc.performAnimation(new Animation(ids.seqs.enragedSlash));
          this.plan = [{ style: "melee", delay: 0, max: dusk.enragedMeleeMax }];
        } else {
          // Out of reach, he throws instead: that is the style he goes on from.
          this.style = "ranged";
          npc.__ggLastStyle = "ranged";
          npc.performAnimation(new Animation(ids.seqs.enragedRanged));
          // Both orbs land with the projectile.
          const end = flightEnd("ranged", distance);
          const delay = Projectile.ticksToLand(end);
          shoot(npc, target, ids.spotanims.explosion, end);
          const max = Math.floor(dusk.enragedMeleeMax * 0.6);
          this.plan = [{ style: "ranged", delay, max, fixed: true }, { style: "ranged", delay, max, nested: true }];
        }
        return;
      }
      if (fight.phase === 2 && n % dusk.explosion.every === 0) {
        npc.performAnimation(new Animation(ids.seqs.duskSpecial));
        Common.later(dusk.explosion.warnTicks, () => {
          if (fight.stopped) return;
          for (const player of fight.roof.players()) {
            if (distanceTo(player.getLocation(), npc) <= 1) Common.hurtPlayer(player, Common.randomInt(0, dusk.explosion.max));
          }
        });
        return;
      }
      if (distance > 1) return;
      npc.performAnimation(new Animation(fight.phase === 2 ? ids.seqs.duskSlash : ids.seqs.duskSlashDefensive));
      this.plan = [{ style: "melee", delay: 0, max: dusk.meleeMax }];
    }

    attackDistance(character) {
      return character?.getAsNpc?.()?.__ggFight?.phase === 4 ? 8 : 1;
    }

    attackSpeed() {
      return dusk.attackSpeed;
    }

    type() {
      return this.style === "ranged" ? CombatType.RANGED : CombatType.MELEE;
    }
  }

  return { DawnCombat, DuskCombat };
}

function attach(api) {
  const { DawnCombat, DuskCombat } = methods();
  api.registerNpcCombatMethodProvider(Common.dawnForms(), DawnCombat, { singleton: false });
  api.registerNpcCombatMethodProvider(Common.duskForms(), DuskCombat, { singleton: false });
  api.onCombatHitRoll(partialProtection);
}

module.exports = { attach, methods, hitDelay, flightEnd, distanceTo, nextEnragedStyle };
