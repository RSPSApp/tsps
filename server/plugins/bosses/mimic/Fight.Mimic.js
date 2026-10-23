"use strict";

/**
 * The Mimic's attacks (see ../Mimic.plugin.js for behaviour and sources).
 *
 * Wiki (The Mimic): 186 combat, 5x5, Crush + Magic, max hit 23, weak to Magic, speed
 * 3; six-candy volleys (three purple plus red/green/blue spawning the minions),
 * pink hurting about 10 unless stepped off, pointless minions, escalating stomp.
 * Per-swing choice is NR-only (attack() thirds/halves, inclusive random reading);
 * the volley tiles mirror NR's six (NR-only) inside the cache-mapped arena.
 * Speeds and max hits stay the dump's (monsters-complete.json: boss 3 ticks/max 23;
 * minions 40 hp, max 18/12/16).
 *
 * Projectile ids decode in this cache (rev 241, `yarn dump:spotanim`); flight timings
 * follow Zulrah's captured magic shape (delay 40, 18 + 5/tile, heights 65/10).
 */

const Shared = require("./Shared.Mimic");
const Lair = require("./Lair.Mimic");

/** Estimate: tiles are picked in the arena only; six tiles is NR-only. */
const VOLLEY_TILES = 6;
const VOLLEY_RADIUS = 3;
const VOLLEY_TRIES = 500;
/** Pink candy damage: Wiki says about 10; NR rolls 8-12 (NR-only range). */
const PINK_MIN = 8;
const PINK_MAX = 12;
/**
 * Swings between out-of-melee volleys, drawn uniformly (feel; Near-Reality uses a
 * memoryless coin flip, whose back-to-back volleys read as spam). Per-boss state.
 */
const VOLLEY_GAP_MIN = 2;
const VOLLEY_GAP_MAX = 4;

function drawVolleyGap() {
  return VOLLEY_GAP_MIN + Math.floor(Math.random() * (VOLLEY_GAP_MAX - VOLLEY_GAP_MIN + 1));
}
/** Blocked-tile flags, as Kraken's loot placement reads them. */
const WALKABLE_MASK = 0x1280100;

let methodInstance = null;

function later(ticks, action) {
  const { Task, TaskManager } = Shared.core();
  TaskManager.submit(
    new (class extends Task {
      constructor() {
        super(Math.max(1, ticks), null, false);
      }
      execute() {
        this.stop();
        action();
      }
    })(),
  );
}

/** The tiles a mobile covers: [minX, minY, maxX, maxY]. */
function footprint(mobile) {
  const at = mobile.getLocation();
  const size = Math.max(1, mobile.getSize?.() ?? 1);
  return [at.getX(), at.getY(), at.getX() + size - 1, at.getY() + size - 1];
}

/** Beside the NPC's footprint along an edge (diagonals don't count for melee). */
function beside(npc, target) {
  if (npc.getLocation().getZ() !== target.getLocation().getZ()) return false;
  const [ax, ay, bx, by] = footprint(npc);
  const [cx, cy, dx, dy] = footprint(target);
  const gapX = Math.max(0, cx - bx, ax - dx);
  const gapY = Math.max(0, cy - by, ay - dy);
  return (gapX === 1 && gapY === 0) || (gapX === 0 && gapY === 1);
}

/** Footprints intersect (the stomp position): a large NPC fights on overlapped. */
function overlaps(a, b) {
  const [ax, ay, bx, by] = footprint(a);
  const [cx, cy, dx, dy] = footprint(b);
  return ax <= dx && cx <= bx && ay <= dy && cy <= by;
}

/**
 * Diagonally touching the footprint: the engine parks here (its beside check
 * counts diagonals), but crush needs an orthogonal edge, so without footwork
 * the boss would stand on the corner volleying forever.
 */
function diagonalTo(npc, target) {
  if (npc.getLocation().getZ() !== target.getLocation().getZ()) return false;
  const [ax, ay, bx, by] = footprint(npc);
  const [cx, cy, dx, dy] = footprint(target);
  return Math.max(0, cx - bx, ax - dx) === 1 && Math.max(0, cy - by, ay - dy) === 1;
}

/**
 * One orthogonal step turning a diagonal touch into an edge (next swing can
 * crush). Size-aware clipping; false when walled in (caller volleys instead).
 */
function alignStep(npc, target) {
  const from = npc.getLocation();
  const to = target.getLocation();
  if (!from || !to || from.getZ() !== to.getZ()) return false;
  const size = Math.max(1, npc.getSize?.() ?? 1);
  const dx = to.getX() - (from.getX() + ((size - 1) >> 1));
  const dy = to.getY() - (from.getY() + ((size - 1) >> 1));
  const queue = npc.getMovementQueue?.();
  if (!queue) return false;
  const steps = Math.abs(dx) >= Math.abs(dy)
    ? [[Math.sign(dx), 0], [0, Math.sign(dy)]]
    : [[0, Math.sign(dy)], [Math.sign(dx), 0]];
  for (const [sx, sy] of steps) {
    if ((sx !== 0 || sy !== 0) && queue.canWalk?.(sx, sy)) {
      queue.walkStep?.(sx, sy);
      return true;
    }
  }
  return false;
}

/**
 * In melee distance: beside the footprint, or standing inside it.
 * (The engine stops its own walk-in on its own beside check, diagonals
 * included; this gate only picks the swing and treats overlap as melee.)
 */
function inMelee(npc, target) {
  return beside(npc, target) || overlaps(npc, target);
}

function inArena(tile) {
  const { minX, maxX, minY, maxY, z } = Shared.ARENA;
  return tile.getZ() === z && tile.getX() >= minX && tile.getX() <= maxX && tile.getY() >= minY && tile.getY() <= maxY;
}

function overlapsBoss(boss, tile) {
  const [ax, ay, bx, by] = footprint(boss);
  return tile.getX() >= ax && tile.getX() <= bx && tile.getY() >= ay && tile.getY() <= by;
}

/** Player tile first, then up to five random tiles around it (NR's six). */
function pickTiles(boss, target) {
  const { Location, RegionManager } = Shared.core();
  const z = boss.getLocation().getZ();
  const tiles = [target.getLocation().clone()];
  let tries = VOLLEY_TRIES;
  while (tiles.length < VOLLEY_TILES && tries-- > 0) {
    const tile = new Location(
      target.getLocation().getX() + Math.floor(Math.random() * (VOLLEY_RADIUS * 2 + 1)) - VOLLEY_RADIUS,
      target.getLocation().getY() + Math.floor(Math.random() * (VOLLEY_RADIUS * 2 + 1)) - VOLLEY_RADIUS,
      z,
    );
    if (!inArena(tile)) continue;
    if (tiles.some((t) => t.equals?.(tile) || (t.getX() === tile.getX() && t.getY() === tile.getY()))) continue;
    if (overlapsBoss(boss, tile)) continue;
    if ((RegionManager.getClipping(tile.getX(), tile.getY(), z, null) & WALKABLE_MASK) !== 0) continue;
    try {
      if (!RegionManager.canProjectileAttack(boss, boss.getLocation(), tile)) continue;
    } catch {
      continue;
    }
    tiles.push(tile);
  }
  return tiles;
}

/** One candy volley as a swing outcome (anim + delayed tiles). */
function fireVolley(method, character, target) {
  const { Animation, CombatType } = Shared.core();
  method.plan = "volley";
  method.style = CombatType.MAGIC;
  character.performAnimation(new Animation(Shared.ANIM.CANDY));
  volley(character, target, method);
}

/** A full six-candy volley, tiles picked when it lands (as Near-Reality does). */
function volley(character, target, method) {
  later(1, () => {
    if (!Shared.alive(character) || !Shared.alive(target)) return;
    const tiles = pickTiles(character, target);
    const order = Shared.VOLLEY;
    for (let i = tiles.length - 1; i >= 0; i--) {
      const candy = Shared.CANDY[order[Math.min(i, order.length - 1)]];
      throwCandy(character, target, tiles[i], candy, method);
    }
  });
}

function throwCandy(boss, target, tile, candy, method) {
  const { Projectile, Graphic, GraphicHeight, PendingHit, CombatFactory } = Shared.core();
  const distance = Math.max(
    Math.abs(boss.getLocation().getX() - tile.getX()),
    Math.abs(boss.getLocation().getY() - tile.getY()),
  );
  const flight = 40 + 18 + distance * 5;
  const landTicks = Math.max(2, Math.ceil(flight / 30));
  // Tile-targeted: createProjectile centres on a victim mobile, so a ground tile
  // needs the raw constructor (Abyssal Sire's spawn throw does the same). The
  // fight runs in a PrivateArea, which must be passed or nobody inside sees it.
  new Projectile(
    Projectile.centreOf(boss),
    tile,
    null,
    candy.projectile,
    40,
    flight,
    65,
    10,
    boss.getPrivateArea?.() ?? target.getPrivateArea?.() ?? null,
  ).sendProjectile();
  later(landTicks, () => {
    if (!Shared.alive(boss) || !Shared.alive(target)) return;
    // The splash stays on the tile where the candy lands, even when the player
    // stepped away; it is not a graphic on the player.
    try {
      target.getPacketSender?.()?.sendGraphic(new Graphic(candy.impact, 0, GraphicHeight.MIDDLE), tile);
    } catch {
      // The damage and minions below still resolve without the visual.
    }
    if (candy === Shared.CANDY.PINK) {
      const at = target.getLocation();
      if (at.getX() === tile.getX() && at.getY() === tile.getY() && at.getZ() === tile.getZ()) {
        // PendingHit snapshots the method's style at construction, so later
        // swings can't retype this hit (it stays Magic whatever follows).
        const hit = new PendingHit(boss, target, method, 0);
        hit.setTotalDamage(PINK_MIN + Math.floor(Math.random() * (PINK_MAX - PINK_MIN + 1)));
        CombatFactory.addPendingHit(hit);
      }
      return;
    }
    spawnMinion(boss, target, tile, candy);
  });
}

const MINION_FOR_CANDY = () => {
  const { WARRIOR, RANGER, MAGE } = Shared.ids();
  const { RED, GREEN, BLUE } = Shared.CANDY;
  return new Map([
    [RED, WARRIOR],
    [GREEN, RANGER],
    [BLUE, MAGE],
  ]);
};

/** One of each minion at most; kills are pointless (no drops) and it respawns next volley. */
function spawnMinion(boss, target, tile, candy) {
  const area = target.getPrivateArea?.() ?? target.getArea?.();
  const session = area ? Lair.sessionOf(area) : null;
  if (!session) return;
  const npcId = MINION_FOR_CANDY().get(candy);
  const key = npcId === Shared.ids().WARRIOR ? "warrior" : npcId === Shared.ids().RANGER ? "ranger" : "mage";
  const existing = session.minions[key];
  if (existing && Shared.alive(existing)) return;
  const npc = Lair.spawnNpc(npcId, tile.getX(), tile.getY(), tile.getZ(), target.getAsPlayer?.() ?? target);
  if (!npc) return;
  try {
    area.add(npc);
  } catch {
    // Already tracked by the spawn call in most flows.
  }
  session.minions[key] = npc;
  try {
    npc.getCombat?.().attack?.(target);
  } catch {
    // It retaliates on its own once damaged.
  }
}

/**
 * Stomp damage for being under the boss; the lair area calls this per tick.
 * methodInstance never swings, so its style stays the MAGIC default: the hit
 * snapshots that at construction and no later swing can retype it.
 */
function stompHit(boss, player, damage) {
  if (!Shared.alive(boss) || !Shared.alive(player) || !methodInstance) return;
  const hit = new (Shared.core().PendingHit)(boss, player, methodInstance, 0);
  hit.setTotalDamage(damage);
  Shared.core().CombatFactory.addPendingHit(hit);
}

function methodClass() {
  const { Animation, CombatMethod, CombatType, PendingHit, CombatFactory } = Shared.core();
  return class MimicCombatMethod extends CombatMethod {
    constructor() {
      super();
      this.style = CombatType.MAGIC;
    }

    type() {
      return this.style ?? CombatType.MAGIC;
    }

    /**
     * Candy range (Near-Reality follows within 10): reach never gates here, the
     * per-swing choice below does. A short range would park the boss in engine
     * pursuit and silence long volleys; NR walks it with follow swings instead.
     */
    attackDistance() {
      return 10;
    }

    attackSpeed(character) {
      return character.getCurrentDefinition?.()?.getAttackSpeed?.() ?? 3;
    }

    start(character, target) {
      // Near-Reality's attack(): in melee distance 0 candy / 1 follow / 2 crush,
      // out of it 0 candy / 1 follow (Utils.random is inclusive). Walking itself
      // is the engine's close-in routing (see Challenge: the flag); follow
      // swings are breathers that let it advance. Out-of-melee volleys
      // additionally wait out a uniform 2-4 swing gap (feel; NR's coin flip
      // clusters volleys back-to-back).
      const melee = inMelee(character, target);
      if (!melee && diagonalTo(character, target)) {
        // Parked on a corner: sidestep into crush range instead of volleying.
        if (alignStep(character, target)) {
          this.plan = "step";
          return;
        }
      }
      this.plan = "volley";
      if (melee) {
        const roll = Math.floor(Math.random() * 3);
        if (roll === 2) {
          this.plan = "crush";
          this.style = CombatType.MELEE;
          character.performAnimation(new Animation(Shared.ANIM.MELEE));
          return;
        }
        if (roll === 1) {
          this.plan = "step";
          return;
        }
        fireVolley(this, character, target);
        return;
      }
      const gap = Number.isInteger(character.__mimicVolleyIn) ? character.__mimicVolleyIn : null;
      if (gap === null) {
        // Fresh exchange: hold the first volley a drawn gap out.
        character.__mimicVolleyIn = drawVolleyGap();
        this.plan = "step";
        return;
      }
      if (gap > 0) {
        character.__mimicVolleyIn = gap - 1;
        this.plan = "step";
        return;
      }
      fireVolley(this, character, target);
      character.__mimicVolleyIn = drawVolleyGap();
    }

    hits(character, target) {
      if (this.plan === "crush") {
        const hit = new PendingHit(character, target, this, 1);
        CombatFactory.applyStyleDamage(hit, 23);
        return [hit];
      }
      // Volley damage lands per tile in throwCandy, steps land nothing up front.
      return [];
    }
  };
}

function bossDied({ npc, killer }) {
  if (!npc || npc.getId?.() !== Shared.ids().BOSS) return;
  const area = npc.getPrivateArea?.() ?? npc.getArea?.();
  const session = area ? Lair.sessionOf(area) : null;
  if (!session) return;
  session.boss = null;
  for (const key of Object.keys(session.minions)) {
    const minion = session.minions[key];
    session.minions[key] = null;
    if (minion && Shared.alive(minion)) {
      try {
        minion.setHitpoints(0);
      } catch {
        // Already dying.
      }
    }
  }
}

function attach(api) {
  const Method = methodClass();
  methodInstance = new Method();
  api.registerNpcCombatMethodProvider([Shared.ids().BOSS], Method);
  api.onNpcDeath(bossDied);
}

module.exports = { attach, methodClass, stompHit, bossDied, pickTiles };
