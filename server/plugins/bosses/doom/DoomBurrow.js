"use strict";

/**
 * The burrowed ("car") phase, from delve 5 (Wiki):
 * - After the shield, the Doom burrows (14709) and rocks fall around the arena; for a moment
 *   nothing it does can hurt the player.
 * - It looks at which of the eight compass directions the player is in from its centre and
 *   places an eye four tiles past the player that way, then charges straight there, breaking
 *   rocks and trampling whoever it crosses (10 damage at delve 5, 20 at 6, 30 at 7, 40 from 8),
 *   shoving anyone left under it.
 * - Delve 5: two zooms. From delve 6: three, each followed by 1-3 orbs (by distance travelled)
 *   and a car slam, which breaks every rock within 15 tiles that no other rock shelters and hits
 *   anyone no rock shelters. A rock under its centre ("rockblock") stops the whole slam.
 * - It charges its beam throughout; any hit resets the charge. Fewer rocks fall from delve 8,
 *   and it moves much faster (about 4 tiles a tick at delve 5, there in 1-2 ticks from 8).
 * - Then it surfaces, volatile earth appear, and the rotation goes on to the shockwave.
 * Capture (delve 5):
 * - As the shield breaks: anim 12420 with graphic 3375, and rocks fall (graphic 2529, delayed per
 *   tile) on 24 tiles; the rocks (57286) stand 6 ticks later, over any acid.
 * - 5 ticks after burrowing it becomes 14709 (the HUD with its real hitpoints), charging for 600
 *   cycles (20 ticks); each hit restarts the charge.
 * - 3 ticks later the eye (graphic 3416, and 3415 with delay 60) marks where its centre will stop:
 *   from its centre, the compass direction of where the player was a tick before, as far as the
 *   player is plus four. 3 ticks after the eye it moves there, 4 tiles a tick (anim 12417 with
 *   graphic 3371): each tick a teleport and an exact_move from the tile it left, delay1 0, delay2
 *   30, angle the direction of travel (768 north-west, 1536 east), npc.exactMove's defaults.
 *   Rocks in the way break (graphic 2699) and any acid under them is back.
 * - Burrowed, it isn't locked on to the player: it turns to the corner tile it will stop on as
 *   the eye appears, and to the player's tile once, the tick after it stops (face coord).
 * - The next eye comes 9 ticks after it stops; after the second zoom it surfaces 5 ticks later
 *   (12418 with graphic 3372).
 * Guesses: 16 rocks from delve 8; 3 ticks of grace; 5 tiles a tick at delves 6-7 and 8 from 8;
 * the slam's damage (as a shockwave, 26-42); an orb per 5 tiles travelled, 2 ticks apart.
 */

const Shared = require("./DoomShared");

const ANIM = { MOVE: 12417, EMERGE: 12418, SLAM: 12419, BURROW: 12420, IDLE: 12421 };
const GFX = {
  MOVE: 3371, EMERGE: 3372, SLAM: 3373, SLAM_AREA: 3374, BURROW: 3375, IDLE: 3376,
  EYE: 3416, EYE_MOVE: 3415, ROCK_FALL: 2529, RUBBLE: 2699,
};
const BURROW = {
  grace: 3, rocks: [24, 28], fewerRocks: 16, rocksLand: 6, transform: 5, firstEye: 3, eyeTicks: 3,
  charge: 20, nextEye: 9, surface: 5, slamReach: 15, slamDamage: [26, 42], tilesPerOrb: 5,
  /** Capture: every falling rock's graphic has delay 20. */
  fallDelay: 20,
  /** Capture: burrowed, graphic 3414 in spotanim slot 2 each tick, except one a hit restarts the charge. */
  chargeGfx: 3414, chargeSlot: 2,
  /** Capture: the charge bar runs 600 cycles; the camera shakes (random 5 on each axis) until it turns. */
  chargeCycles: 600,
  shake: 5,
};
const TRAMPLE = { 5: 10, 6: 20, 7: 30 };
const SPEED = { 5: 4, 6: 5, 7: 5 };
/** Where the Doom's south-west tile may go (delve 1's frame): its 5x5 stays on the arena floor. */
const BOUNDS = { minX: 1299, maxX: 1319, minY: 9561, maxY: 9581 };

function inBounds(tile) {
  const at = Shared.frame(tile);
  return at.x >= BOUNDS.minX && at.x <= BOUNDS.maxX && at.y >= BOUNDS.minY && at.y <= BOUNDS.maxY;
}

function trample(level) {
  return TRAMPLE[level] ?? 40;
}

function speed(level) {
  return SPEED[level] ?? 8;
}

/** The tiles strictly between two tiles, along a straight line. */
function between(from, to) {
  const tiles = [];
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  for (let step = 1; step < steps; step++) {
    tiles.push({ x: Math.round(from.x + ((to.x - from.x) * step) / steps), y: Math.round(from.y + ((to.y - from.y) * step) / steps) });
  }
  return tiles;
}

/** The compass direction (dx, dy) of `to` seen from `from`. */
function octant(from, to) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const index = Math.round(angle / (Math.PI / 4));
  return { dx: Math.round(Math.cos(index * Math.PI / 4)) || 0, dy: Math.round(Math.sin(index * Math.PI / 4)) || 0 };
}

class BurrowPhase {
  constructor(run) {
    this.run = run;
    this.step = null;
  }

  get centre() {
    const at = this.run.boss.getLocation();
    return { x: at.getX() + 2, y: at.getY() + 2 };
  }

  start() {
    const { Animation } = Shared.core();
    const run = this.run;
    const boss = run.boss;
    run.attacks.phase = "burrow";
    run.immuneUntil = run.ticks + BURROW.grace;
    boss.setMobileInteraction?.(null);
    boss.performAnimation(new Animation(ANIM.BURROW));
    boss.performGraphic(Shared.gfx(GFX.BURROW));
    this.dropRocks(run.level >= 8 ? BURROW.fewerRocks : Shared.random(...BURROW.rocks));
    this.zoomsLeft = run.level >= 6 ? 3 : 2;
    this.firesAt = Infinity;
    this.step = null;
    const sender = run.player.getPacketSender();
    for (const axis of [0, 1, 2]) sender.sendCameraShake?.(axis, BURROW.shake, 0, 0);
    run.attacks.after(BURROW.transform, () => {
      sender.sendCameraReset?.();
      boss.setNpcTransformationId(Shared.NPC.DOOM_BURROWED);
      boss.performAnimation(new Animation(ANIM.IDLE));
      this.restartCharge();
      this.step = { name: "wait", at: run.ticks + BURROW.firstEye };
      run.updateHud(true);
    });
  }

  restartCharge() {
    this.firesAt = this.run.ticks + BURROW.charge;
    this.restartedAt = this.run.ticks;
    Shared.chargeBar(this.run.boss, BURROW.chargeCycles);
  }

  /** Rocks fall on free tiles away from the Doom and the player, landing 6 ticks later. */
  dropRocks(count) {
    const run = this.run;
    const player = Shared.tileOf(run.player);
    // Capture: one falls on the Doom's centre tile; the rest anywhere free, beside or under it too.
    const centre = this.centre;
    const tiles = run.hazards.rockAt(centre.x, centre.y) ? [] : [{ x: centre.x, y: centre.y, z: 0 }];
    for (let attempt = 0; tiles.length < count && attempt < 400; attempt++) {
      const tile = run.tile({ x: Shared.random(Shared.FLOOR.minX, Shared.FLOOR.maxX), y: Shared.random(BOUNDS.minY, Shared.FLOOR.maxY), z: 0 });
      if (!Shared.onFloor(tile) || !Shared.floorFree(run.area, tile)) continue;
      if (tile.x === player.x && tile.y === player.y) continue;
      if (run.hazards.rockAt(tile.x, tile.y) || tiles.some((other) => other.x === tile.x && other.y === tile.y)) continue;
      tiles.push(tile);
    }
    for (const tile of tiles) Shared.graphicAt(run.player, GFX.ROCK_FALL, tile, { delay: BURROW.fallDelay });
    const { SOUND } = Shared;
    Shared.sound(run.player, SOUND.BURROW_RUMBLE, { loops: 5 });
    Shared.sound(run.player, SOUND.BURROW_ROCKS_FALL, { delay: 45 });
    Shared.sound(run.player, SOUND.BURROW_ROCKS_LAND, { delay: 160 });
    run.attacks.after(BURROW.rocksLand, () => tiles.forEach((tile) => run.hazards.addRock(tile)));
  }

  /** Any hit resets the charge (Wiki). */
  hit() {
    if (this.run.attacks.phase !== "burrow" || !Number.isFinite(this.firesAt)) return;
    this.restartCharge();
    // Hits come after the tick's charge graphic: none on a tick a hit restarts it (capture).
    Shared.withdrawChargeGraphic(this.run.boss, BURROW.chargeSlot);
  }

  tick() {
    const run = this.run;
    if (run.ticks >= this.firesAt) {
      Shared.fireBeam(run, run.delve.beam);
      this.restartCharge();
    }
    if (Number.isFinite(this.firesAt) && this.restartedAt !== run.ticks) {
      const graphic = Shared.gfx(BURROW.chargeGfx);
      if (run.boss.performGraphicInSlot) run.boss.performGraphicInSlot(BURROW.chargeSlot, graphic);
      else run.boss.performGraphic(graphic);
    }
    const step = this.step;
    if (!step) return;
    const due = run.ticks >= step.at;
    switch (step.name) {
      case "wait":
        if (due) this.aim();
        break;
      case "eye":
        if (due) {
          step.name = "move";
          this.move();
        }
        break;
      case "move":
        this.move();
        break;
      case "orbs":
        this.orbs();
        break;
      case "slam":
        if (due) this.slam();
        break;
      case "done":
        if (due) this.surface();
        break;
    }
  }

  /** The eye: the compass direction of the player's last tile, as far as they are plus four. */
  aim() {
    const run = this.run;
    const centre = this.centre;
    // Tasks run before movement, so this is where the player stood at the end of last tick.
    const player = Shared.tileOf(run.player);
    const { dx, dy } = octant(centre, player);
    let reach = Math.max(Math.abs(player.x - centre.x), Math.abs(player.y - centre.y)) + 4;
    let target = { x: centre.x - 2 + dx * reach, y: centre.y - 2 + dy * reach };
    while (reach > 0 && !inBounds(target)) {
      reach--;
      target = { x: centre.x - 2 + dx * reach, y: centre.y - 2 + dy * reach };
    }
    const eye = { x: target.x + 2, y: target.y + 2, z: 0 };
    Shared.graphicAt(run.player, GFX.EYE, eye);
    Shared.graphicAt(run.player, GFX.EYE_MOVE, eye, { delay: 60 });
    const at = run.boss.getLocation();
    const from = { x: at.getX(), y: at.getY() };
    const path = [...between(from, target), target].filter((tile) => tile.x !== from.x || tile.y !== from.y);
    // Capture: it turns to the corner tile it will stop on.
    run.boss.faceTile?.(Shared.loc({ x: target.x, y: target.y, z: 0 }));
    this.step = { name: "eye", at: run.ticks + BURROW.eyeTicks, path, travelled: path.length, trampled: false };
  }

  move() {
    const { Animation } = Shared.core();
    const run = this.run;
    const boss = run.boss;
    const step = this.step;
    boss.performAnimation(new Animation(ANIM.MOVE));
    boss.performGraphic(Shared.gfx(GFX.MOVE));
    // Tile by tile along this tick's stretch: rocks under it break, and the player is trampled.
    const player = run.player.getLocation();
    let end = null;
    for (let moved = 0; moved < speed(run.level) && step.path.length > 0; moved++) {
      end = step.path.shift();
      for (let x = end.x; x < end.x + 5; x++) {
        for (let y = end.y; y < end.y + 5; y++) {
          if (run.hazards.breakRockAt(x, y)) Shared.graphicAt(run.player, GFX.RUBBLE, { x, y, z: 0 });
        }
      }
      const under = player.getX() >= end.x && player.getX() < end.x + 5 && player.getY() >= end.y && player.getY() < end.y + 5;
      if (!step.trampled && under) {
        step.trampled = true;
        run.hurt(trample(run.level));
      }
    }
    // Capture: a teleport and an exact_move a tick (delay1 0, delay2 30, facing the way it goes).
    if (end) boss.exactMove(Shared.loc({ x: end.x, y: end.y, z: 0 }));
    if (step.path.length > 0) return;
    // Capture: the tick after it stops it turns once to the player's tile.
    run.attacks.after(1, () => boss.faceTile?.(run.player.getLocation()));
    this.shove();
    if (run.level >= 6) {
      this.step = { name: "orbs", at: run.ticks + 1, left: Math.max(1, Math.min(3, Math.ceil(step.travelled / BURROW.tilesPerOrb))) };
    } else {
      this.nextZoom();
    }
  }

  /** Anyone still under it at the end is pushed out to the nearest free tile. */
  shove() {
    const run = this.run;
    const boss = run.boss;
    if (Shared.distanceTo(boss, run.player.getLocation()) !== 0) return;
    const at = boss.getLocation();
    const player = Shared.tileOf(run.player);
    let best = null;
    for (let x = at.getX() - 1; x <= at.getX() + 5; x++) {
      for (let y = at.getY() - 1; y <= at.getY() + 5; y++) {
        const tile = { x, y, z: 0 };
        if (Shared.distanceTo(boss, tile) !== 1 || !Shared.onFloor(tile) || !Shared.floorFree(run.area, tile)) continue;
        const distance = Math.max(Math.abs(x - player.x), Math.abs(y - player.y));
        if (!best || distance < best.distance) best = { tile, distance };
      }
    }
    if (!best) return;
    run.player.getMovementQueue().reset();
    run.player.moveTo(Shared.loc(best.tile));
  }

  orbs() {
    const run = this.run;
    const step = this.step;
    if (run.ticks < step.at) return;
    run.attacks.orb(Shared.randomOf(["ranged", "magic"]));
    step.left--;
    if (step.left > 0) step.at = run.ticks + 2;
    else this.step = { name: "slam", at: run.ticks + 2 };
  }

  /** Breaks every rock in reach that no nearer rock shelters, and hits a player none shelters. */
  slam() {
    const { Animation } = Shared.core();
    const run = this.run;
    const boss = run.boss;
    const centre = this.centre;
    boss.performAnimation(new Animation(ANIM.SLAM));
    boss.performGraphic(Shared.gfx(GFX.SLAM));
    Shared.graphicAt(run.player, GFX.SLAM_AREA, { ...centre, z: 0 });
    const block = run.hazards.rockAt(centre.x, centre.y);
    if (block) {
      run.hazards.removeRock(block);
      this.nextZoom();
      return;
    }
    const rocks = run.hazards.rocks.map((rock) => ({ rock, x: rock.getLocation().getX(), y: rock.getLocation().getY() }));
    const shelters = (tile) => between(centre, tile).some((on) => run.hazards.rockAt(on.x, on.y));
    const player = Shared.tileOf(run.player);
    const safe = shelters(player);
    for (const { rock, x, y } of rocks) {
      if (Math.max(Math.abs(x - centre.x), Math.abs(y - centre.y)) > BURROW.slamReach) continue;
      if (!shelters({ x, y })) rock.__doomBreak = true;
    }
    for (const { rock } of rocks) if (rock.__doomBreak) run.hazards.removeRock(rock);
    if (!safe) run.hurt(Shared.random(...BURROW.slamDamage));
    this.nextZoom();
  }

  nextZoom() {
    this.zoomsLeft--;
    const run = this.run;
    this.step = this.zoomsLeft > 0 ? { name: "wait", at: run.ticks + BURROW.nextEye } : { name: "done", at: run.ticks + BURROW.surface };
  }

  surface() {
    const { Animation } = Shared.core();
    const run = this.run;
    const boss = run.boss;
    this.step = null;
    this.firesAt = Infinity;
    Shared.emptyChargeBar(boss);
    boss.setNpcTransformationId(-1);
    boss.performAnimation(new Animation(ANIM.EMERGE));
    boss.performGraphic(Shared.gfx(GFX.EMERGE));
    run.attacks.phase = "attacks";
    run.updateHud(true);
    run.attacks.afterBurrow();
  }

  stop() {
    this.step = null;
    this.firesAt = Infinity;
  }
}

module.exports = { BurrowPhase, BURROW, BOUNDS, between, octant, trample, speed, inBounds };
