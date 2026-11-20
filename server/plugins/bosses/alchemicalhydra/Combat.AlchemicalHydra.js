/**
 * The Alchemical Hydra's combat method (Wiki: Alchemical Hydra, /Strategies; timings from rsprox
 * captures, docs/alchemical-hydra.md):
 * - ranged and magic, every 6 ticks (4 enraged), from up to 10 tiles, walking in meanwhile until
 *   the player is within 4 tiles of its footprint (Lair's close-in distance, issue 6284);
 * - each style's heads: serpentine two projectiles a style, electric two magic and one ranged,
 *   flame and enraged one, each a hit up to the phase's max (Fight.hitsOf);
 * - flights start at cycle 30 and end at 40 + 5 a tile from its south-west tile, launched from the
 *   head that faces the target; the hit lands with the flight;
 * - the phase's special in place of an attack when the count says so (Fight.nextAttack).
 * Protection prayers block its attacks entirely, as for any NPC. Its basic attacks don't poison.
 */
const Common = require("./Common.AlchemicalHydra");

const OCTANTS = [["E", 1, 0], ["NE", 1, 1], ["N", 0, 1], ["NW", -1, 1], ["W", -1, 0], ["SW", -1, -1], ["S", 0, -1], ["SE", 1, -1]];

/** The way the Hydra faces a tile, as one of eight from its footprint's centre. */
function facing(npc, location) {
  const base = npc.getLocation();
  const half = (Math.max(1, npc.getSize()) - 1) / 2;
  const dx = location.getX() - (base.getX() + half);
  const dy = location.getY() - (base.getY() + half);
  if (dx === 0 && dy === 0) return "S";
  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return OCTANTS[(octant + 8) % 8][0];
}

/** Where each head launches from (data.projectiles.heads), a second pulled into the inner 4x4. */
function launchTiles(npc, style, location, count) {
  const base = npc.getLocation();
  const [x, y] = Common.data.projectiles.heads[facing(npc, location)][style];
  const tiles = [base.transform(x, y)];
  if (count > 1) tiles.push(base.transform(Math.min(4, Math.max(1, x)), Math.min(4, Math.max(1, y))));
  return tiles;
}

/** The flight's end cycle: 40 + 5 a tile from the Hydra's south-west tile (rsprox, 2,786 flights). */
function flightEnd(npc, location) {
  const { endBase, endPerTile } = Common.data.projectiles;
  const base = npc.getLocation();
  const distance = Math.max(Math.abs(location.getX() - base.getX()), Math.abs(location.getY() - base.getY()));
  return endBase + endPerTile * distance;
}

/** The tick the hit lands: the flight's whole ticks (rsprox: an 85-cycle flight hits 2 ticks on). */
function hitDelay(end) {
  return Math.max(1, Math.floor(end / 30));
}

function combatClass() {
  const { CombatMethod, CombatType, PendingHit, Animation, Projectile } = Common.core;

  class HydraCombat extends CombatMethod {
    hits(character, target) {
      if (!character || !target || !this.style) return [];
      const fight = character.getAsNpc?.()?.__hydraFight;
      const { max, hits: count } = fight?.hitsOf?.(this.style) ?? { max: 35, hits: 1 };
      const hits = [];
      for (let i = 0; i < count; i++) {
        const hit = new PendingHit(character, target, this, this.delay);
        // The forms' cache max hits don't follow the phases (the serpentine form's is 1, and
        // none reaches the empowered 52), so a hit that lands rolls the phase's own 0..max.
        hit.setTotalDamage(hit.isAccurate() ? Common.core.Misc.randomInclusive(0, max) : 0);
        hits.push(hit);
      }
      return hits;
    }

    start(character, target) {
      this.style = null;
      const npc = character?.getAsNpc?.();
      const fight = npc?.__hydraFight;
      if (!npc || !fight || fight.stopped || !target) return;
      if (fight.transitioning() || fight.busy()) {
        character.getCombat().setAttackDelay(1);
        return;
      }
      const kind = fight.nextAttack();
      fight.counted(kind);
      const { ids } = Common;
      if (kind === "special") {
        const special = Common.data.phases[fight.phase].special;
        // The fire special starts with its walk; its breaths carry their own sequences.
        if (special !== "fire") npc.performAnimation(new Animation(ids.seqs.special[fight.phase]));
        if (special === "poison") fight.spitPoison(target);
        else if (special === "lightning") fight.castLightning();
        else if (special === "fire") fight.startFire(target);
        return;
      }
      this.style = kind;
      npc.performAnimation(new Animation((kind === "magic" ? ids.seqs.magic : ids.seqs.ranged)[fight.phase]));
      const at = target.getLocation();
      const end = flightEnd(npc, at);
      this.delay = hitDelay(end);
      const { start, heights, endHeight } = Common.data.projectiles;
      const { hits: count } = fight.hitsOf(kind);
      const spotanim = kind === "magic" ? ids.spotanims.magic : ids.spotanims.ranged;
      const area = npc.getPrivateArea?.() ?? null;
      launchTiles(npc, kind, at, count).forEach((from, index) => {
        const projectile = new Projectile(from, at, target, spotanim, start, end, heights[index] ?? heights[0], endHeight, area);
        projectile.withAngle?.(0);
        // rsprox: a second head's flight always starts at progress 0; the first's is 64 or 0.
        if (index > 0) projectile.withProgress?.(0);
        projectile.sendProjectile();
      });
      Common.areaSound(fight.lair.players(), kind, at, end);
    }

    attackDistance() {
      return Common.data.combat.attackDistance;
    }

    attackSpeed(character) {
      return character?.getAsNpc?.()?.__hydraFight?.enraged ? Common.data.combat.enragedAttackSpeed : Common.data.combat.attackSpeed;
    }

    type() {
      return this.style === "magic" ? CombatType.MAGIC : CombatType.RANGED;
    }
  }
  return HydraCombat;
}

/**
 * "combat:npc-poison": its basic attacks never poison, though the cache calls it poisonous; only
 * its acid does (rsprox: every "You have been poisoned!" in the chamber is on a blob's landing
 * tick, 34 of 34).
 */
function basicAttackPoison(event) {
  if (Common.isHydra(event?.attacker)) event.handled = true;
}

function attach(api) {
  api.registerNpcCombatMethodProvider(Common.phaseForms(), combatClass(), { singleton: false });
  api.onCustomEvent("combat:npc-poison", basicAttackPoison);
}

module.exports = { attach, combatClass, facing, launchTiles, flightEnd, hitDelay, basicAttackPoison };
