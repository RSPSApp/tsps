"use strict";

/**
 * Wave 4: Sotetseg, and the Shadow Realm's maze.
 *
 * Wiki (Sotetseg; "Theatre of Blood/Strategies", Sotetseg):
 * - It stands still (4000 hitpoints) and attacks every 5 ticks: a horn lunge on someone beside
 *   it for up to 45 (22 through Protect from Melee), landing a tick late; or a red ball. A ball
 *   is a successful hit of up to 50, fully blocked by the right prayer; one that isn't turns
 *   protection prayers off for 3 seconds. The first ball (magic) splits into two more aimed at
 *   others, one magic (red) and one ranged (grey).
 * - After 10 balls, a big slow ball at one player; the damage is shared by everyone within the
 *   3x3 round them and kills a lone target with two or more in the room (121 and up, to 188).
 * - At 66.6% and 33.3% it chooses a player ("Sotetseg chooses you...") for the Shadow Realm;
 *   the rest are pulled to the other end of the arena and its attacks stop. The runner follows a
 *   red path to the portal, taking 1-3 every 7 ticks. The others see the runner's tile glow red
 *   and must follow the same path: a wrong tile hurts them and anyone beside them for 6.67% of
 *   their hitpoints + 15 every tick. Once someone reaches the fourth row, a tornado follows the
 *   path hitting anyone it catches (in the realm instead, for a solo runner). Clearing the maze
 *   restores its Defence.
 * Cache: Sotetseg (8387 waiting, 8388 fighting), the tornado (8389), the maze floors 33033
 * (light grey), 33034 (dark grey), 33035 (red), 33036 (wrong tile), the portal 33037.
 * RuneLite (gameval): its projectiles (1604 big ball, 1606 magic, 1607 ranged), the big
 * ball's impact (1605) and the realm's drain (1608).
 * Captured: the attack animations (8138 melee, 8139 the balls) and sounds, the ball splitting
 * into a magic and a ranged one off the player it hits, the big ball, the projectiles' timing
 * and arcs, a wrong maze tile's explosion and zap. Estimates: half-and-half melee or magic
 * beside it, the maze generator, the realm's tiles and the arena tiles the others are pulled
 * to, the runner's return tile, the tornado's 35-45, the solo big ball's 70.
 * Estimates: the big ball's damage between the Wiki's 121 (two players) and 188 (five); where
 * the portal stands.
 */

const Shared = require("./TobShared");
const Raid = require("./TobRaid");

const NPC = { WAITING: 8387, FIGHTING: 8388, TORNADO: 8389 };
const OBJECT = { LIGHT: 33033, DARK: 33034, RED: 33035, WRONG: 33036, PORTAL: 33037 };
const SPAWN = { x: 3277, y: 4326, z: 0 };
const MAZE = { minX: 3273, maxX: 3286, minY: 4310, maxY: 4324, z: 0 };
const REALM = { minX: 3354, maxX: 3367, minY: 4311, maxY: 4325, z: 3, start: { x: 3360, y: 4309, z: 3 }, portal: { x: 3357, y: 4328, z: 3 } };
const PULLED_TO = { x: 3274, y: 4307, z: 0 };
const RETURN = { x: 3275, y: 4327, z: 0 };

const ANIMATION = { MELEE: 8138, MAGIC: 8139 };
const GRAPHIC = { BIG_BALL: 1604, BIG_IMPACT: 1605, MAGIC: 1606, RANGED: 1607, DRAIN: 1608, ZAP: 1603, EXPLOSION: 505 };
/** As captured: its ball, the two it splits into off the player it hits, and the big ball. */
const PROJECTILE = {
  BALL: { delay: 23, duration: 180, perTile: 0, startHeight: 26, endHeight: 31, angle: 16, progress: 64 },
  SPLIT_MAGIC: { delay: 15, duration: 21, perTile: 30, minDuration: 111, startHeight: 31, endHeight: 24, angle: 8, progress: 0 },
  SPLIT_RANGED: { delay: 15, duration: 201, perTile: 0, startHeight: 31, endHeight: 24, angle: 8, progress: 0 },
  BIG_BALL: { delay: 23, duration: 457, perTile: 0, startHeight: 26, endHeight: 31, angle: 40, progress: 64 },
  /** From a wrong maze tile to whoever it hurts. */
  ZAP: { delay: 0, duration: 15, perTile: 0, startHeight: 0, endHeight: 16, angle: 64, progress: 64 },
};
const SOUND = { BALL: 3539, MELEE: 4015, WRONG_TILE: 3970 };

const ATTACK_TICKS = 5;
const MELEE = { max: 45, prayerMultiplier: 0.5 };
const BALL = { max: 50, prayerBlockSeconds: 3, beforeBig: 10 };
const BIG_BALL = { solo: 70, duo: 121, perPlayer: 67 / 3 };
const MAZE_PHASES = [0.666, 0.333];
const REALM_DRAIN = { every: 7, min: 1, max: 3 };
const WRONG_TILE = { share: 0.0667, flat: 15 };
const TORNADO = { min: 35, max: 45 };

const key = (tile) => `${tile.x},${tile.y}`;

class SotetsegRoom extends Raid.Room {
  onBuild() {
    this.sotetseg = this.spawn(NPC.WAITING, SPAWN, { scripted: true, face: Shared.facing("SOUTH") });
    this.sotetseg?.getMovementQueue().setBlockMovement(true);
    this.maze = null;
    this.mazesDone = 0;
  }

  onStart() {
    const npc = this.sotetseg;
    if (!npc) return;
    npc.setNpcTransformationId?.(NPC.FIGHTING);
    this.ticks = 0;
    this.balls = 0;
  }

  healthBar() {
    const npc = this.sotetseg;
    if (!npc) return null;
    return { kind: this.maze ? Shared.HEALTH_BAR.DISABLED : Shared.HEALTH_BAR.REGULAR, current: Math.max(0, npc.getHitpoints()), maximum: npc.getMaxHitpoints() };
  }

  tick() {
    const npc = this.sotetseg;
    if (!this.isStarted() || !npc) return;
    if (npc.getHitpoints() <= 0) {
      this.complete();
      return;
    }
    if (this.maze) {
      this.tickMaze();
      return;
    }
    const share = npc.getHitpoints() / Math.max(1, npc.getMaxHitpoints());
    if (this.mazesDone < MAZE_PHASES.length && share <= MAZE_PHASES[this.mazesDone]) {
      this.startMaze();
      return;
    }
    if (++this.ticks % ATTACK_TICKS === 0) this.attack();
  }

  onComplete() {
    if (this.maze) this.endMaze(false);
  }

  // -------------------------------------------------------------- attacks

  attack() {
    const fighters = this.fighters();
    if (fighters.length === 0) return;
    const target = Shared.randomOf(fighters);
    const { Animation } = Shared.core();
    const npc = this.sotetseg;
    npc.setMobileInteraction(target);
    if (Shared.distanceTo(npc, target.getLocation()) <= 1 && Math.random() < 0.5) {
      npc.performAnimation(new Animation(ANIMATION.MELEE));
      Shared.areaSound(this.area, npc, SOUND.MELEE, 30);
      this.strike(npc, target, "melee", MELEE.max, 1, { prayerMultiplier: MELEE.prayerMultiplier });
      return;
    }
    npc.performAnimation(new Animation(ANIMATION.MAGIC));
    Shared.areaSound(this.area, npc, SOUND.BALL);
    if (this.balls >= BALL.beforeBig) {
      this.balls = 0;
      this.bigBall(target, fighters);
      return;
    }
    this.balls++;
    const ticks = Shared.projectile(this.area, npc, target, GRAPHIC.MAGIC, PROJECTILE.BALL);
    this.later(ticks, () => {
      if (this.maze || !this.fighters().includes(target)) return;
      this.ballLands(target, "magic");
      this.ricochet(target);
    });
  }

  /** The first ball splits: one magic and one ranged, at two others. */
  ricochet(from) {
    const others = Shared.shuffle(this.fighters().filter((player) => player !== from)).slice(0, 2);
    const first = Math.random() < 0.5 ? "magic" : "ranged";
    others.forEach((player, index) => {
      const style = index === 0 ? first : (first === "magic" ? "ranged" : "magic");
      const ticks = style === "magic"
        ? Shared.projectile(this.area, from, player, GRAPHIC.MAGIC, PROJECTILE.SPLIT_MAGIC)
        : Shared.projectile(this.area, from, player, GRAPHIC.RANGED, PROJECTILE.SPLIT_RANGED);
      this.later(ticks, () => {
        if (!this.maze && this.fighters().includes(player)) this.ballLands(player, style);
      });
    });
  }

  /** Blocked by the right prayer; otherwise it hits and turns protection prayers off. */
  ballLands(player, style) {
    if (Shared.isProtected(player, style)) return;
    Shared.damage(player, Shared.random(1, BALL.max));
    const { PrayerHandler } = Shared.core();
    for (const prayer of [PrayerHandler.PROTECT_FROM_MAGIC, PrayerHandler.PROTECT_FROM_MISSILES, PrayerHandler.PROTECT_FROM_MELEE]) {
      PrayerHandler.deactivatePrayer(player, prayer);
    }
    player.getCombat().getPrayerBlockTimer().start(BALL.prayerBlockSeconds);
  }

  bigBall(target, fighters) {
    for (const player of fighters) player.sendMessage(`<col=ef1020>${Shared.displayName(target)} has discovered a large ball of energy coming their way...</col>`);
    const ticks = Shared.projectile(this.area, this.sotetseg, target, GRAPHIC.BIG_BALL, PROJECTILE.BIG_BALL);
    const present = fighters.length;
    this.later(ticks, () => {
      if (this.maze || !this.fighters().includes(target)) return;
      const sharing = this.fighters().filter((player) => Shared.distanceTo(target, player.getLocation()) <= 1);
      const total = present <= 1 ? BIG_BALL.solo : Math.round(BIG_BALL.duo + (present - 2) * BIG_BALL.perPlayer);
      const each = Math.ceil(total / Math.max(1, sharing.length));
      for (const player of sharing) {
        player.performGraphic(Shared.gfx(GRAPHIC.BIG_IMPACT));
        Shared.damage(player, each);
      }
    });
  }

  // -------------------------------------------------------------- the maze

  startMaze() {
    const fighters = this.fighters();
    if (fighters.length === 0) return;
    const runner = Shared.randomOf(fighters);
    const path = generatePath();
    this.maze = {
      runner, path, pathKeys: new Set(path.map(key)), realTiles: new Set(path.map((tile) => key(toReal(tile)))),
      glow: null, wrong: new Set(), tornado: null, tornadoStep: 0, drain: 0, solo: fighters.length === 1, objects: [],
    };
    this.setMazeFloor(OBJECT.DARK);
    for (const tile of path) this.maze.objects.push(this.placeObject(OBJECT.RED, tile, 22, 0));
    this.maze.objects.push(this.placeObject(OBJECT.PORTAL, REALM.portal, 10, 0));
    for (const player of fighters) {
      player.getCombat().reset?.();
      player.getPacketSender().sendClientScript(Shared.SCRIPT.FADE_WHITE, player === runner ? "<col=c0c0c0>Sotetseg chooses you...</col>" : "");
      this.later(2, () => {
        player.moveTo(Shared.loc(player === runner ? REALM.start : PULLED_TO));
        Shared.fade(player, 200, "");
      });
    }
  }

  setMazeFloor(id) {
    for (let x = MAZE.minX; x <= MAZE.maxX; x++) {
      for (let y = MAZE.minY; y <= MAZE.maxY; y++) this.placeObject(id, { x, y, z: 0 }, 22, 0);
    }
  }

  tickMaze() {
    const maze = this.maze;
    const runner = maze.runner;
    if (!this.raid.players.includes(runner) || this.raid.member(runner).jailed || runner.getHitpoints() <= 0) {
      this.endMaze(false);
      return;
    }
    if (++maze.drain >= REALM_DRAIN.every) {
      maze.drain = 0;
      runner.performGraphic(Shared.gfx(GRAPHIC.DRAIN));
      this.later(2, () => Shared.damage(runner, Shared.random(REALM_DRAIN.min, REALM_DRAIN.max)));
    }
    this.mirrorRunner(runner);
    this.punishWrongTiles(runner);
    this.tickTornado(runner);
  }

  /** The runner's tile glows red on the real maze. */
  mirrorRunner(runner) {
    const maze = this.maze;
    const at = Shared.tileOf(runner);
    if (at.z !== REALM.z || !inBox(at, REALM)) return;
    const real = toReal(at);
    if (maze.glow && key(maze.glow) === key(real)) return;
    if (maze.glow) this.placeObject(OBJECT.DARK, maze.glow, 22, 0);
    maze.glow = real;
    this.placeObject(OBJECT.RED, real, 22, 0);
  }

  /** Off the path in the real maze: the player and anyone beside them take a share of their hitpoints. */
  punishWrongTiles(runner) {
    const maze = this.maze;
    const players = this.fighters().filter((player) => player !== runner);
    for (const wrong of [...maze.wrong]) {
      if (!players.some((player) => key(Shared.tileOf(player)) === wrong)) {
        maze.wrong.delete(wrong);
        const [x, y] = wrong.split(",").map(Number);
        this.placeObject(OBJECT.DARK, { x, y, z: 0 }, 22, 0);
      }
    }
    for (const player of players) {
      const at = Shared.tileOf(player);
      if (at.z !== 0 || !inBox(at, MAZE) || maze.realTiles.has(key(at))) continue;
      const fresh = !maze.wrong.has(key(at));
      if (fresh) {
        maze.wrong.add(key(at));
        this.placeObject(OBJECT.WRONG, at, 22, 0);
        Shared.areaSound(this.area, at, SOUND.WRONG_TILE);
        Shared.graphicAt(this.area, GRAPHIC.EXPLOSION, at, { height: 10 });
      }
      for (const other of players) {
        if (Shared.distanceTo(player, other.getLocation()) > 1) continue;
        if (fresh) Shared.projectile(this.area, at, other, GRAPHIC.ZAP, PROJECTILE.ZAP);
        Shared.damage(other, Math.floor(other.getHitpoints() * WRONG_TILE.share) + WRONG_TILE.flat);
      }
    }
  }

  /** From the fourth row on, a tornado follows the path (in the realm for a solo runner). */
  tickTornado(runner) {
    const maze = this.maze;
    const players = maze.solo ? [runner] : this.fighters().filter((player) => player !== runner);
    const toTile = maze.solo ? (tile) => tile : toReal;
    if (!maze.tornado) {
      const triggered = players.some((player) => {
        const at = Shared.tileOf(player);
        const box = maze.solo ? REALM : MAZE;
        return at.z === box.z && inBox(at, box) && at.y >= box.minY + 3;
      });
      if (!triggered) return;
      const start = toTile(maze.path[0]);
      maze.tornado = this.spawn(NPC.TORNADO, { x: start.x - 1, y: start.y - 1, z: start.z }, { scale: false, scripted: true });
      maze.tornadoStep = 0;
      return;
    }
    const tornado = maze.tornado;
    for (const player of players) {
      if (Shared.distanceTo(tornado, player.getLocation()) <= 0) Shared.damage(player, Shared.random(TORNADO.min, TORNADO.max));
    }
    if (++maze.tornadoStep >= maze.path.length) {
      this.despawn(tornado);
      maze.tornado = null;
      return;
    }
    const next = toTile(maze.path[maze.tornadoStep]);
    Shared.walkStraight(tornado, { x: next.x - 1, y: next.y - 1, z: next.z });
  }

  /** The runner takes the portal home; the maze is over and its Defence comes back. */
  leaveRealm(player) {
    if (!this.maze || this.maze.runner !== player) return false;
    this.endMaze(true);
    return true;
  }

  endMaze(cleared) {
    const maze = this.maze;
    this.maze = null;
    this.mazesDone++;
    if (maze.tornado) this.despawn(maze.tornado);
    const { ObjectManager } = Shared.core();
    for (const object of maze.objects) ObjectManager.deregister(object, true);
    this.setMazeFloor(OBJECT.LIGHT);
    if (this.sotetseg) Shared.restoreDefence(this.sotetseg);
    const runner = maze.runner;
    if (cleared || this.raid.players.includes(runner)) {
      runner.getPacketSender().sendClientScript(Shared.SCRIPT.FADE_WHITE, "");
      this.later(2, () => {
        if (Shared.tileOf(runner).z === REALM.z) runner.moveTo(Shared.loc(RETURN));
        Shared.fade(runner, 200, "");
      });
    }
  }
}

function inBox(tile, box) {
  return tile.x >= box.minX && tile.x <= box.maxX && tile.y >= box.minY && tile.y <= box.maxY;
}

/** A realm tile's twin in the real maze. */
function toReal(tile) {
  return { x: MAZE.minX + (tile.x - REALM.minX), y: MAZE.minY + (tile.y - REALM.minY), z: 0 };
}

/**
 * The maze (our generator): from a random tile on the bottom row, sideways up to five tiles then up
 * two or four rows, until the top; one more tile above the top row to the portal.
 */
function generatePath(random = Math.random) {
  const width = REALM.maxX - REALM.minX + 1;
  const height = REALM.maxY - REALM.minY + 1;
  const pick = (min, max) => min + Math.floor(random() * (max - min + 1));
  const tiles = [];
  const add = (x, y) => tiles.push({ x: REALM.minX + x, y: REALM.minY + y, z: REALM.z });
  let x = pick(0, width - 1);
  add(x, 0);
  let y = 1;
  while (y < height - 1) {
    const nextX = pick(Math.max(0, x - 5), Math.min(width - 1, x + 5));
    const step = nextX > x ? 1 : -1;
    for (let cx = x; cx !== nextX + step; cx += step) add(cx, y);
    const nextY = Math.min(height - 1, y + (random() < 0.5 ? 2 : 4));
    for (let cy = y; cy < nextY; cy++) add(nextX, cy);
    x = nextX;
    y = nextY;
  }
  add(x, height - 1);
  add(x, height);
  const seen = new Set();
  return tiles.filter((tile) => (seen.has(key(tile)) ? false : (seen.add(key(tile)), true)));
}

function enterPortal(event) {
  const raid = Raid.raidOf(event.player);
  const room = raid?.room;
  return room instanceof SotetsegRoom ? room.leaveRealm(event.player) : false;
}

module.exports = function registerSotetseg(api) {
  Shared.bind(api);
  Raid.registerRoom("SOTETSEG", SotetsegRoom);
  Shared.onObject(api, OBJECT.PORTAL, enterPortal);
};

Object.assign(module.exports, { SotetsegRoom, generatePath, toReal, MAZE, REALM });
