"use strict";

/**
 * The Colosseum's seven enemy types.
 *
 * Wiki ("Fortis Colosseum/Strategies", Monsters): max hits, ranges and attack speeds below,
 * and each type's mechanics.
 * - The trio attack only from melee range, berserker first, then the seer, then the archer.
 *   They head for their own tile beside the player (berserker north, seer east, archer west),
 *   route around the pillars, run, pass through other NPCs, and skip a swing that comes while
 *   they are still moving. A player using the style one of them is weak to (magic on the
 *   berserker, ranged on the seer, melee on the archer) always hits it for their maximum.
 * - The jaguar strikes three times, each hit rolled on its own.
 * - The Javelin Colossus throws a javelin into the air after every fourth attack; it lands on the
 *   tile the player stood on.
 * - The Manticore charges three orbs - magic and ranged in either order, then melee - and throws
 *   them a tick apart, prayer counting as they are thrown; then a 7-tick lull.
 * RuneLite (the Fortis Colosseum plugin's LosLinks): the charged orbs are the orb projectiles'
 * spotanims held on the Manticore, several at once, appearing in throwing order.
 * - The Minotaur's damage lands a tick after its swing, and while not in melee range it heals
 *   damaged enemies within 6 tiles to full.
 * Capture: the trio's and the shaman's animations, projectiles and graphics.
 * Offline_Scape (from its captures): the colossi's and the Manticore's animations,
 * projectiles and graphics, and the javelin landing 3 ticks after it is thrown.
 * RuneLite (gameval): the jaguar's attack, 10847.
 * Modifiers: Relentless raises every max hit (ModifierEffects.*); Mantimayhem doubles the
 * Manticore's orbs (I), envenoms when an orb is not prayed against (II) and throws the orbs in
 * any order (III), as the Wiki describes; Reentry's sand is in ColosseumHazards.
 */

const Shared = require("./ColosseumShared");
const Waves = require("./ColosseumWaves");
const Effects = require("./ModifierEffects.Colosseum");
const Hazards = require("./ColosseumHazards");

const ENEMY = {
  berserker: { max: 29, speed: 6, range: 1, style: "MELEE", anim: 10856 },
  seer: { max: 12, speed: 6, range: 1, style: "MAGIC", anim: 10853, projectile: { id: 130, start: 10, end: 30, from: 43, to: 31 }, impact: { id: 131, height: 124 } },
  archer: { max: 14, speed: 6, range: 1, style: "RANGED", anim: 10850, projectile: { id: 9, start: 10, end: 30, from: 41, to: 36 } },
  shaman: { max: 27, speed: 5, range: 10, style: "MAGIC", anim: 10859, cast: { id: 1458, height: 92 }, projectile: { id: 1459, start: 67, perTile: 4, from: 43, to: 36 }, impact: { id: 1460, height: 124 } },
  jaguar: { max: 47, speed: 5, range: 1, style: "MELEE", anim: 10847, hits: 3 },
  javelin: { max: 48, speed: 5, range: 15, style: "RANGED", anim: 10892, projectile: { id: 2673, start: 58, perTile: 3, from: 70, to: 36 } },
  manticore: { speed: 10, range: 15 },
  shockwave: { max: 56, speed: 5, range: 15, style: "MAGIC", anim: 10903, projectile: { id: 2520, start: 51, perTile: 5, from: 45, to: 31 } },
  minotaur: { max: 74, speed: 5, range: 1, style: "MELEE", anim: 10843, hitDelay: 2 },
};

/** The trio take their first swings a tick apart, after the 3 ticks every enemy waits on spawn. */
const SPAWN_ATTACK_DELAY = 3;
const TRIO_STAGGER = { berserker: 0, seer: 1, archer: 2 };

const JAVELIN = {
  artilleryEvery: 5, anim: 10893, fireGfx: 2676, shadowGfx: 1446, landingGfx: 2674, landTicks: 3, max: 40,
};
const MANTICORE = {
  chargeAnim: 10868, throwAnim: 10869, throwAfter: 6,
  /** `charged`: how high each orb floats over it while charging - green, blue, red upwards. */
  orbs: {
    MAGIC: { projectile: 2681, impact: 2682, max: 31, charged: 380 },
    RANGED: { projectile: 2683, impact: 2684, max: 36, charged: 290 },
    MELEE: { projectile: 2685, impact: 2686, max: 31, charged: 470 },
  },
  /**
   * An orb's spin plays for 60 client cycles (2 ticks), so a held orb is shown again every tick:
   * every 2 ticks leaves a gap where it flashes off.
   */
  orbRefreshTicks: 1,
  orbTravel: 25,
};
const MINOTAUR_HEAL = { range: 6, every: 5 };
const PROTECTION = { MAGIC: "PROTECT_FROM_MAGIC", RANGED: "PROTECT_FROM_MISSILES", MELEE: "PROTECT_FROM_MELEE" };
const ORB_ORDERS = {
  usual: [["MAGIC", "RANGED", "MELEE"], ["RANGED", "MAGIC", "MELEE"]],
  any: [
    ["MAGIC", "RANGED", "MELEE"], ["MAGIC", "MELEE", "RANGED"], ["RANGED", "MAGIC", "MELEE"],
    ["RANGED", "MELEE", "MAGIC"], ["MELEE", "MAGIC", "RANGED"], ["MELEE", "RANGED", "MAGIC"],
  ],
};
const TRIO_KINDS = new Set(["berserker", "seer", "archer"]);
const WEAKNESS = { berserker: "MAGIC", seer: "RANGED", archer: "MELEE" };
const RUN_STEPS = 2;

let classes = null;

function kindOf(id) {
  const I = Waves.ids();
  return {
    [I.berserker]: "berserker", [I.seer]: "seer", [I.archer]: "archer", [I.shaman]: "shaman",
    [I.jaguar]: "jaguar", [I.javelin]: "javelin", [I.manticore]: "manticore",
    [I.shockwave]: "shockwave", [I.minotaur]: "minotaur", [I.minotaurRouting]: "minotaur", [I.sol]: "sol",
  }[id] ?? null;
}

function maxHit(npc, base) {
  return base + Effects.maxHitBonus(npc.__colosseumRun);
}

function tierOf(npc, id) {
  return npc.__colosseumRun?.modifiers.tierOf(id) ?? 0;
}

function distance(a, b) {
  const from = a.getLocation();
  const to = b.getLocation();
  return Math.max(Math.abs(from.getX() - to.getX()), Math.abs(from.getY() - to.getY()));
}

function build() {
  if (classes) return classes;
  const { Animation, CombatFactory, CombatMethod, CombatType, Graphic, PendingHit, Projectile } = Shared.core();

  const fire = (npc, target, projectile) => {
    const end = projectile.end ?? projectile.start + distance(npc, target) * projectile.perTile;
    Projectile.createProjectile(npc, target, projectile.id, projectile.start, end, projectile.from, projectile.to).sendProjectile();
    return end;
  };
  const ticksFor = (cycles) => Math.max(1, Math.ceil(cycles / 30));
  // Graphic's constructor reads a height of 0-2 as a priority, so set the fields directly.
  const gfx = (id, delay = 0, height = 0) => Object.assign(new Graphic(id), { delay, height });

  /** One style, one projectile (or none), one roll of damage per hit. */
  class EnemyMethod extends CombatMethod {
    constructor(kind) {
      super();
      this.kind = kind;
      this.def = ENEMY[kind];
      this.stance = CombatType[this.def.style ?? "MELEE"];
      this.hitDelay = 1;
    }

    type() {
      return this.stance;
    }

    attackSpeed() {
      return this.def.speed;
    }

    attackDistance() {
      return this.def.range;
    }

    start(npc, target) {
      npc.performAnimation(new Animation(this.def.anim));
      if (this.def.cast) npc.performGraphic(gfx(this.def.cast.id, 0, this.def.cast.height));
      this.hitDelay = this.def.hitDelay ?? 1;
      if (!this.def.projectile) return;
      const end = fire(npc, target, this.def.projectile);
      this.hitDelay = ticksFor(end);
      if (this.def.impact) target.performGraphic(gfx(this.def.impact.id, end, this.def.impact.height));
    }

    hits(npc, target) {
      return Array.from({ length: this.def.hits ?? 1 }, () => {
        const hit = new PendingHit(npc, target, this, this.hitDelay);
        CombatFactory.applyStyleDamage(hit, maxHit(npc, this.def.max));
        return hit;
      });
    }
  }

  /** Every fifth attack is the javelin thrown into the air at the player's tile. */
  class JavelinMethod extends EnemyMethod {
    constructor() {
      super("javelin");
      this.attacks = 0;
      this.artillery = false;
    }

    start(npc, target) {
      this.attacks++;
      this.artillery = this.attacks % JAVELIN.artilleryEvery === 0;
      if (!this.artillery) {
        super.start(npc, target);
        return;
      }
      npc.performAnimation(new Animation(JAVELIN.anim));
      npc.performGraphic(gfx(JAVELIN.fireGfx, 60, 0));
      const at = target.getLocation().clone();
      Shared.later(npc, JAVELIN.landTicks, () => {
        const run = npc.__colosseumRun;
        if (npc.getHitpoints() <= 0 || !run || run.stage !== "wave") return;
        target.getPacketSender?.()?.sendGraphic(gfx(JAVELIN.shadowGfx, 30, 0), at);
        target.getPacketSender?.()?.sendGraphic(gfx(JAVELIN.landingGfx, 30, 0), at);
        Hazards.javelinLanded(run, { x: at.getX(), y: at.getY() });
        if (!target.getLocation().equals(at)) return;
        run.hurt(Math.floor(Math.random() * (maxHit(npc, JAVELIN.max) + 1)));
      });
    }

    hits(npc, target) {
      return this.artillery ? [] : super.hits(npc, target);
    }
  }

  /** Three orbs charged, then thrown a tick apart; each one's prayer counts as it is thrown. */
  class ManticoreMethod extends CombatMethod {
    constructor() {
      super();
      this.stance = CombatType.MAGIC;
    }

    type() {
      return this.stance;
    }

    attackSpeed() {
      return ENEMY.manticore.speed;
    }

    attackDistance() {
      return ENEMY.manticore.range;
    }

    start(npc, target) {
      npc.performAnimation(new Animation(MANTICORE.chargeAnim));
      const orders = tierOf(npc, "mantimayhem") >= 3 ? ORB_ORDERS.any : ORB_ORDERS.usual;
      const order = orders[Math.floor(Math.random() * orders.length)];
      order.forEach((style, index) => {
        // The charged orbs show on it in throwing order, one a tick, each in its own slot, and
        // stay until thrown.
        const orb = MANTICORE.orbs[style];
        for (let at = index; at < MANTICORE.throwAfter + index; at += MANTICORE.orbRefreshTicks) {
          Shared.later(npc, at, () => {
            if (npc.getHitpoints() > 0) npc.performGraphicInSlot?.(index + 1, gfx(orb.projectile, 0, orb.charged));
          });
        }
        Shared.later(npc, MANTICORE.throwAfter + index, () => this.throwOrb(npc, target, style, index));
      });
    }

    throwOrb(npc, target, style, index) {
      if (!npc.isRegistered()) return;
      npc.performGraphicInSlot?.(index + 1, null);
      if (npc.getHitpoints() <= 0 || target.getHitpoints() <= 0) return;
      if (index === 0) npc.performAnimation(new Animation(MANTICORE.throwAnim));
      const orb = MANTICORE.orbs[style];
      this.stance = CombatType[style];
      // Mantimayhem: two of each orb, each rolled on its own.
      const count = tierOf(npc, "mantimayhem") >= 1 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        Projectile.createProjectile(npc, target, orb.projectile, i * 10, MANTICORE.orbTravel + i * 10, 50, 31).sendProjectile();
        const hit = new PendingHit(npc, target, this, ticksFor(MANTICORE.orbTravel));
        CombatFactory.applyStyleDamage(hit, maxHit(npc, orb.max));
        CombatFactory.addPendingHit(hit);
      }
      target.performGraphic(gfx(orb.impact, MANTICORE.orbTravel, 100));
      const { PrayerHandler } = Shared.core();
      if (target.isPlayer?.() && !PrayerHandler.isActivated(target, PrayerHandler[PROTECTION[style]])) {
        Effects.envenom(npc.__colosseumRun, target);
      }
    }

    hits() {
      return [];
    }
  }

  /** A swing that comes while still moving is skipped, and the next waits a full cycle. */
  class WarbandMethod extends EnemyMethod {
    canAttack(npc) {
      if (!npc.getMovementQueue?.()?.didMoveThisCycle?.()) return true;
      npc.getCombat().setAttackDelay(this.def.speed);
      return false;
    }
  }

  const forKind = (kind) => {
    if (kind === "javelin") return JavelinMethod;
    if (kind === "manticore") return ManticoreMethod;
    const base = TRIO_KINDS.has(kind) ? WarbandMethod : EnemyMethod;
    return class extends base { constructor() { super(kind); } };
  };
  classes = { EnemyMethod, WarbandMethod, JavelinMethod, ManticoreMethod, forKind };
  return classes;
}

/** Every enemy waits 3 ticks after appearing; the trio then swing a tick apart, and run. */
function onSpawn(npc) {
  const kind = kindOf(npc.getId());
  npc.getCombat().setAttackDelay(SPAWN_ATTACK_DELAY + (TRIO_STAGGER[kind] ?? 0));
  if (!TRIO_KINDS.has(kind)) return;
  npc.setMovementSteps?.(RUN_STEPS);
  npc.setFlag?.(Shared.core().NPC.WALK_THROUGH_ENTITIES_FLAG);
}

const CARDINALS = [[0, 1], [1, 0], [0, -1], [-1, 0]];

function offsetOf(npc) {
  return npc.__colosseumOffset ?? Waves.TRIO_OFFSETS[kindOf(npc.getId())];
}

function open(run, x, y) {
  const { RegionManager } = Shared.core();
  return (RegionManager.getClipping(x, y, 0, run.area) & 0x1280100) === 0;
}

/**
 * Where one of the trio heads: its own tile beside the player, or, when a pillar takes that
 * tile, the nearest open side tile no other warbander claims; null to hold still. Routing to
 * a blocked tile would fall back to the nearest reachable one - possibly the player's own,
 * where it can't attack (Offline_Scape found the same).
 */
function warbandTile(run, npc, trio) {
  const at = run.player.getLocation();
  const [dx, dy] = offsetOf(npc);
  if (open(run, at.getX() + dx, at.getY() + dy)) return { x: at.getX() + dx, y: at.getY() + dy };
  const claimed = new Set(trio.filter((other) => other !== npc).map((other) => offsetOf(other).join()));
  const here = npc.getLocation();
  const options = CARDINALS
    .filter((offset) => !claimed.has(offset.join()))
    .map(([ox, oy]) => ({ x: at.getX() + ox, y: at.getY() + oy }))
    .filter(({ x, y }) => open(run, x, y))
    .sort((a, b) => Math.max(Math.abs(a.x - here.getX()), Math.abs(a.y - here.getY()))
      - Math.max(Math.abs(b.x - here.getX()), Math.abs(b.y - here.getY())));
  return options[0] ?? null;
}

/** Each of the trio routes to its own tile beside the player instead of the usual chase. */
function tendWarband(run) {
  const { PathFinder } = Shared.core();
  const trio = [...run.npcs].filter((npc) => TRIO_KINDS.has(kindOf(npc.getId())) && npc.getHitpoints() > 0);
  for (const npc of trio) {
    const tile = warbandTile(run, npc, trio);
    const here = npc.getLocation();
    npc.getCombat().preserveMovementForTicks(1);
    if (!tile || (here.getX() === tile.x && here.getY() === tile.y)) continue;
    PathFinder.calculateWalkRoute(npc, tile.x, tile.y);
  }
}

/** The style each of the trio is weak to always hits, for the attacker's maximum. */
function weakness(event) {
  const { attacker, target, combatType } = event;
  if (!attacker?.isPlayer?.() || !target?.__colosseumRun) return;
  const weakTo = WEAKNESS[kindOf(target.getId())];
  if (!weakTo || combatType !== Shared.core().CombatType[weakTo]) return;
  event.forceAccurate = true;
  event.forceMaxHit = true;
}

/** A Minotaur out of melee range heals every damaged enemy within 6 tiles to full. */
function tendMinotaurs(run, ticks) {
  if (ticks % MINOTAUR_HEAL.every !== 0) return;
  for (const minotaur of run.npcs) {
    if (kindOf(minotaur.getId()) !== "minotaur" || minotaur.getHitpoints() <= 0) continue;
    if (distance(minotaur, run.player) <= 1) continue;
    for (const other of run.npcs) {
      if (other === minotaur || other.getHitpoints() <= 0) continue;
      if (distance(minotaur, other) > MINOTAUR_HEAL.range) continue;
      const max = other.getMaxHitpoints?.() ?? other.getHitpoints();
      if (other.getHitpoints() < max) other.setHitpoints(max);
    }
  }
}

function register(api) {
  const { forKind } = build();
  for (const [kind, ids] of Object.entries({
    berserker: [Waves.ids().berserker], seer: [Waves.ids().seer], archer: [Waves.ids().archer],
    shaman: [Waves.ids().shaman], jaguar: [Waves.ids().jaguar], javelin: [Waves.ids().javelin],
    manticore: [Waves.ids().manticore], shockwave: [Waves.ids().shockwave],
    minotaur: [Waves.ids().minotaur, Waves.ids().minotaurRouting],
  })) {
    api.registerNpcCombatMethodProvider(ids, forKind(kind), { singleton: false });
  }
}

module.exports = function registerColosseumEnemies(api) {
  Shared.bind(api);
  register(api);
  api.onCombatHitRoll(weakness);
};

module.exports.ENEMY = ENEMY;
module.exports.kindOf = kindOf;
module.exports.onSpawn = onSpawn;
module.exports.tendMinotaurs = tendMinotaurs;
module.exports.tendWarband = tendWarband;
module.exports.warbandTile = warbandTile;
module.exports.weakness = weakness;
module.exports.build = build;
