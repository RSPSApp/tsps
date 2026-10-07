"use strict";

/**
 * Acid blood, from delve 3.
 *
 * Capture (delves 3-5):
 * - Each delve the acid goes one way from the Doom (north at delves 3 and 4, west at 5): every
 *   hit sends a blob (projectile 3445, height 100 down, 15 + 3 cycles a tile) to the tile just
 *   past its edge in the middle, plus one more at delve 3 and two from delve 4, 1-9 tiles out
 *   and up to 4 to the side (2 at delve 3). Each lands with a splat (3429-3432, delayed to the
 *   landing) and an acid pool (57283, shape 10) the next tick.
 * - Standing in acid hurts 3-6 a tick (venom-coloured); the Wiki says up to 7, so 3-7.
 * - Rocks cover acid, which is back when they break (DoomHazards).
 * Wiki: not while shielded or burrowed; four blobs from delve 8; envenoms; acid stays between
 * delves until delve 6; the earthen shield's centre tile clears it.
 */

const Shared = require("./DoomShared");

const ACID = {
  loc: 57283,
  projectile: 3445,
  height: 100,
  splats: [3429, 3430, 3431, 3432],
  damage: [3, 7],
  edge: 3,
};
const DIRECTIONS = [
  { name: "north", dx: 0, dy: 1 },
  { name: "east", dx: 1, dy: 0 },
  { name: "south", dx: 0, dy: -1 },
  { name: "west", dx: -1, dy: 0 },
];

function extraBlobs(level) {
  return level >= 8 ? 3 : level >= 4 ? 2 : 1;
}

const key = (x, y) => `${x},${y}`;

class AcidPools {
  constructor(run) {
    this.run = run;
    this.pools = new Map();
  }

  get active() {
    return this.run.delve.acid;
  }

  /** Capture: one direction for the whole delve. */
  levelStarted() {
    this.direction = Shared.randomOf(DIRECTIONS);
  }

  /** The Doom was hurt: acid flies its way. */
  spray() {
    const run = this.run;
    const boss = run.boss;
    if (!this.active || !boss || run.attacks.phase !== "attacks") return;
    const direction = this.direction ?? (this.direction = Shared.randomOf(DIRECTIONS));
    const centre = Shared.core().Projectile.centreOf(boss);
    Shared.areaSound(run.player, Shared.SOUND.ACID, { x: centre.getX(), y: centre.getY(), z: centre.getZ() }, { range: 10 });
    const level = run.level;
    const offsets = [[ACID.edge, 0]];
    for (let index = 0; index < extraBlobs(level); index++) {
      offsets.push(level === 3 ? [Shared.random(2, 6), Shared.random(-2, 2)] : [Shared.random(1, 9), Shared.random(-4, 4)]);
    }
    for (const [out, side] of offsets) {
      const tile = {
        x: centre.getX() + direction.dx * out + (direction.dx === 0 ? side : 0),
        y: centre.getY() + direction.dy * out + (direction.dy === 0 ? side : 0),
        z: 0,
      };
      if (!Shared.onFloor(tile) || !Shared.floorFree(run.area, tile)) continue;
      const distance = Math.max(Math.abs(tile.x - centre.getX()), Math.abs(tile.y - centre.getY()));
      const end = 15 + 3 * distance;
      Shared.projectile(run.area, centre, Shared.loc(tile), ACID.projectile, { delay: 0, end, startHeight: ACID.height, endHeight: 0 });
      Shared.graphicAt(run.player, Shared.randomOf(ACID.splats), tile, { delay: end });
      run.attacks.after(Math.ceil(end / 30), () => this.place(tile));
    }
  }

  place(tile) {
    const { GameObject, ObjectManager } = Shared.core();
    if (this.pools.has(key(tile.x, tile.y)) || this.run.hazards.rockAt(tile.x, tile.y)) return;
    const pool = new GameObject(ACID.loc, Shared.loc(tile), 10, Shared.random(0, 3), this.run.area);
    ObjectManager.register(pool, true);
    this.pools.set(key(tile.x, tile.y), pool);
  }

  has(x, y) {
    return this.pools.has(key(x, y));
  }

  /** Standing in acid: 3-7 a tick, and venom. */
  tick() {
    const player = this.run.player;
    if (this.pools.size === 0 || player.getHitpoints() <= 0) return;
    const at = player.getLocation();
    if (!this.has(at.getX(), at.getY())) return;
    this.run.hurt(Shared.random(...ACID.damage), "GREEN");
    Shared.core().CombatFactory.poisonEntity(player, 6, 2);
  }

  clearAt(x, y) {
    const pool = this.pools.get(key(x, y));
    if (!pool) return;
    Shared.core().ObjectManager.deregister(pool, true);
    this.pools.delete(key(x, y));
  }

  clear() {
    const { ObjectManager } = Shared.core();
    for (const pool of this.pools.values()) ObjectManager.deregister(pool, true);
    this.pools.clear();
  }

  all() {
    return [...this.pools.values()];
  }
}

module.exports = { AcidPools, ACID, extraBlobs };
