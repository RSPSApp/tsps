/**
 * Cerberus' combat method (Wiki: Cerberus, Cerberus/Strategies; stats from monsters-complete):
 * - an ordinary attack is magic (a hellfire ball) or ranged (a spinning bone ball) at range, or
 *   melee (a bite) when the target is beside her; 23 at most, every 6 ticks;
 * - the triple attack is magic, then ranged, then melee, 2 ticks apart; its bite reaches the
 *   target wherever they are;
 * - "Aaarrrooooooo" summons the souls and "Grrrrrrrrrrrrrr" spews lava (Fight.Cerberus.js);
 *   neither hits on its own.
 * Protection prayers block her attacks entirely, as for any NPC.
 */
const Common = require("./Common.Cerberus");

/** OSRS hit delays: magic 1 + (1 + d) / 3, ranged 1 + (3 + d) / 6 ticks. */
function hitDelay(style, distance) {
  if (style === "magic") return 1 + Math.floor((1 + distance) / 3);
  if (style === "ranged") return 1 + Math.floor((3 + distance) / 6);
  return 0;
}

/** Beside her footprint, not diagonally off a corner (NPC melee range). */
function besideHer(location, npc) {
  const base = npc.getLocation();
  const size = Math.max(1, npc.getSize());
  const x = location.getX();
  const y = location.getY();
  const insideX = x >= base.getX() && x < base.getX() + size;
  const insideY = y >= base.getY() && y < base.getY() + size;
  if (insideX && insideY) return false;
  return (insideX && (y === base.getY() - 1 || y === base.getY() + size))
    || (insideY && (x === base.getX() - 1 || x === base.getX() + size));
}

/** Chooses an ordinary attack: a bite only from beside her, else magic or ranged evenly. */
function ordinaryStyle(adjacent, random = Math.random) {
  const styles = adjacent ? ["magic", "ranged", "melee"] : ["magic", "ranged"];
  return styles[Math.floor(random() * styles.length)];
}

function combatClass() {
  const { CombatMethod, CombatType, PendingHit, Animation, Projectile } = Common.core;
  const { combat } = Common.data;

  function shoot(npc, target, style) {
    const { ids } = Common;
    const distance = Common.distanceToFootprint(target.getLocation(), npc);
    const delay = hitDelay(style, distance);
    const id = style === "magic" ? ids.spotanims.magic : ids.spotanims.ranged;
    new Projectile(Projectile.centreOf(npc), target.getLocation(), target, id, 20, delay * 30, 60, 31, npc.getPrivateArea?.() ?? null).sendProjectile();
    return delay;
  }

  function capped(hit, npc) {
    const max = npc?.__echoCerberus ? npc.getCurrentDefinition().getMaxHit() : combat.maxHit;
    hit.setTotalDamage(Math.min(max, hit.getTotalDamage()));
    return hit;
  }

  class CerberusCombat extends CombatMethod {
    hits(character, target) {
      if (!character || !target || !this.plan) return [];
      const hits = [];
      for (const { style, delay } of this.plan) {
        this.style = style;
        hits.push(capped(new PendingHit(character, target, this, delay), character));
      }
      this.style = this.plan[0]?.style ?? null;
      return hits;
    }

    start(character, target) {
      this.plan = null;
      this.style = null;
      const npc = character?.getAsNpc?.();
      const fight = npc?.__cerberusFight;
      if (!npc || !fight || fight.stopped || !target) return;
      const special = fight.nextSpecial();
      fight.counted();
      const { ids } = Common;
      if (special === "souls") {
        npc.performAnimation(new Animation(ids.seqs.howl));
        npc.forceChat(Common.message("souls"));
        fight.summonSouls(target);
        return;
      }
      if (special === "lava") {
        npc.performAnimation(new Animation(ids.seqs.lava));
        npc.forceChat(Common.message("lava"));
        fight.spewLava(target);
        return;
      }
      if (special === "triple") {
        this.plan = this.triple(npc, target);
        return;
      }
      const adjacent = besideHer(target.getLocation(), npc);
      const style = ordinaryStyle(adjacent);
      npc.performAnimation(new Animation(ids.seqs[style]));
      this.plan = [{ style, delay: style === "melee" ? 0 : shoot(npc, target, style) }];
    }

    /**
     * Magic now, ranged 2 ticks on, the bite 2 after that. Each later hit is rolled as it launches,
     * so the prayer up at that moment is the one that counts (Wiki), and none comes once the
     * fight is over or the target has left the arena.
     */
    triple(npc, target) {
      const { ids } = Common;
      const spacing = combat.tripleSpacing;
      npc.performAnimation(new Animation(ids.seqs.magic));
      const magicDelay = shoot(npc, target, "magic");
      const follow = (style) => {
        const fight = npc.__cerberusFight;
        if (!fight || fight.stopped || !target.isRegistered?.() || !fight.arena.contains(target.getLocation())) return;
        npc.performAnimation(new Animation(ids.seqs[style]));
        const delay = style === "ranged" ? shoot(npc, target, "ranged") : 0;
        const method = new CerberusCombat();
        method.style = style;
        Common.core.CombatFactory.addPendingHit(capped(new PendingHit(npc, target, method, delay), npc));
      };
      Common.later(spacing, () => follow("ranged"));
      Common.later(spacing * 2, () => follow("melee"));
      return [{ style: "magic", delay: magicDelay }];
    }

    attackDistance() {
      return combat.attackDistance;
    }

    attackSpeed(character) {
      return character?.__echoCerberus ? character.getCurrentDefinition().getAttackSpeed() : combat.attackSpeed;
    }

    type() {
      if (this.style === "melee") return CombatType.MELEE;
      if (this.style === "ranged") return CombatType.RANGED;
      return CombatType.MAGIC;
    }
  }
  return CerberusCombat;
}

function attach(api) {
  const { npcs } = Common.ids;
  api.registerNpcCombatMethodProvider([npcs.attacking], combatClass(), { singleton: false });
}

module.exports = { attach, combatClass, hitDelay, ordinaryStyle, besideHer };
