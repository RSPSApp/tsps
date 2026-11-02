"use strict";

/**
 * Wave 4: Sotetseg, and the Shadow Realm's maze.
 *
 * Wiki (Sotetseg; "Theatre of Blood/Strategies", Sotetseg; Hard and Entry Mode pages):
 * - It stands still and attacks every 5 ticks: a horn lunge on someone beside it for up to 45 (22 through
 *   Protect from Melee; Entry 20), landing a tick late; or a red ball. A ball is a successful hit of up to
 *   50 (Entry 22), fully blocked by the right prayer; one that isn't turns protection prayers off for 3
 *   seconds. The first ball (magic) splits into two more aimed at others, one magic and one ranged.
 * - After 10 balls, a big slow ball at one player; the damage is shared by everyone within the 3x3 round
 *   them and kills a lone target with two or more in the room (121 and up, to 188). Entry: 15 solo, about
 *   80 in a group. Hard: two big balls, one after the other.
 * - At 66.6% and 33.3% it chooses a player for the Shadow Realm; the rest are pulled to the other end of
 *   the arena and its attacks stop. The runner follows a red path to the portal, taking 1-3 every 7 ticks.
 *   The others see the runner's tile glow red and must follow the same path: a wrong tile hurts them and
 *   anyone beside them for 6.67% of their hitpoints + 15 (Entry 11) every tick. Once someone reaches the
 *   fourth row, a tornado follows the path hitting anyone it catches, gone again if they step back (in the
 *   realm instead, for a solo runner).
 * - Hard: all but one go to the realm, the maze divided among them by party order; the tornado also runs in
 *   the realm once the last runner, or the one left behind, is past the third row.
 * - Clearing the maze restores its Defence.
 * Cache: the ids per mode, the maze floors (33033 light, 33034 dark, 33035 red, 33036 wrong), the arena's and
 * realm's tiles, the portal (33037, standing at 3357,4330), Hard's section tiles (41750-41753: red for the
 * viewer whose varbit 12269 is that section's 1-4, dark for the rest).
 * Captured (Entry 101, 554; Normal 554, 1837; Hard 1837, 1852):
 * - The path's shape: a column on every second row, up to 5 tiles from the last, joined on the row between.
 * - Sections by rows; Hard's wrong tiles in the realm; the tile the tornado starts on, a tile a tick.
 * - Teleports: a white fade, moved 3 ticks later, faded in the tick after; the return tile and those of the
 *   ones pulled away; Sotetseg back in its waiting form through the maze; the light floor from the start.
 * - The animations, projectiles and sounds, the big ball's message (only to its target, unlike the Wiki's
 *   wording); the hitpoints each mode's kills show.
 * - Hitpoints: Normal is the Wiki's; Hard took 4500/5250/6000 for 3/4/5 players (1.5x the Wiki's infobox;
 *   its Hard Mode page says only that enemies "have more health"); Entry 560 solo, 1064 for two.
 * Estimates: half-and-half melee or magic beside it, the tornado's 35-45, the solo big ball's 70, the big
 * ball between the Wiki's 121 and 188, sections for three runners, Entry's hitpoints for three or more,
 * the maze ending as the first runner takes the portal (1 Hard sample), every Hard big ball's size.
 * Captures show smaller big balls (35 each for a Normal duo sharing): the Wiki decides.
 */

const Shared = require("./Shared.TheatreOfBlood");
const Raid = require("./RaidState.TheatreOfBlood");

const NPC_BY_MODE = {
  entry: { WAITING: 10864, FIGHTING: 10865, TORNADO: 10866 },
  normal: { WAITING: 8387, FIGHTING: 8388, TORNADO: 8389 },
  hard: { WAITING: 10867, FIGHTING: 10868, TORNADO: 10869 },
};
const NPC = NPC_BY_MODE.normal;
const OBJECT = { LIGHT: 33033, DARK: 33034, RED: 33035, WRONG: 33036, PORTAL: 33037, SECTION_BASE: 41750 };
const SPAWN = { x: 3277, y: 4326, z: 0 };
const MAZE = { minX: 3273, maxX: 3286, minY: 4310, maxY: 4324, z: 0 };
const REALM = { minX: 3354, maxX: 3367, minY: 4311, maxY: 4325, z: 3, start: { x: 3360, y: 4309, z: 3 } };
const PULLED_TO = { x: 3274, y: 4307, z: 0 };
const RETURN = { x: 3275, y: 4327, z: 0 };
/** Row of the maze a tornado starts past: the fourth (index 3). */
const TORNADO_ROW = 3;
/** Client varbit tob_sotetseg_hard_tiles_visible: which section a Hard runner's client shows red. */
const VARBIT_SECTION = 12269;
/** Captured: rows in each section by how many run (2 and 4 runners; 3 is an estimate). */
const SECTION_ROWS = { 1: [15], 2: [7, 8], 3: [5, 5, 5], 4: [4, 4, 4, 3] };

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
const SOUND = { BALL: 3539, BALL_DELAY: 10, MELEE: 4015, WRONG_TILE: 3970 };
const MESSAGE = {
  CHOSEN: "<col=7f7f7f>Sotetseg chooses you...</col>",
  BIG_BALL: "<col=bf0000>A large ball of energy is shot your way...</col>",
};
/** Captured: the fade to white, then the move, then the fade in. Going in takes 3 and 4 ticks, coming back 1 and 2. */
const TELEPORT = { inMove: 3, inFade: 4, outMove: 1, outFade: 2, fadeIn: 255 };

const ATTACK_TICKS = 5;
const MELEE = { max: { entry: 20, normal: 45 }, prayerMultiplier: 0.5 };
const BALL = { max: { entry: 22, normal: 50 }, prayerBlockSeconds: 3, beforeBig: 10 };
/** Wiki: Normal and Hard from 121 for two to 188 for five; Entry 15 solo and "around 80". */
const BIG_BALL = {
  entry: { solo: 15, group: 80, perPlayer: 0 },
  normal: { solo: 70, group: 121, perPlayer: 67 / 3 },
  count: { hard: 2, normal: 1, entry: 1 },
};
const MAZE_PHASES = [0.666, 0.333];
const REALM_DRAIN = { every: 7, min: 1, max: 3 };
const WRONG_TILE = { share: 0.0667, flat: { entry: 11, normal: 15 } };
const TORNADO = { min: 35, max: 45 };
/** Captured for one and two players in Entry, and three to five in Hard; see the header. */
const HITPOINTS = { entry: { 1: 560, 2: 1064, 3: 1680, 4: 1960, 5: 2240 }, normal: 4000, hard: 4000 };
/** A Timely Snack: big balls survived unshared. */
const SNACKS_NEEDED = 3;

const key = (tile) => `${tile.x},${tile.y}`;

class SotetsegRoom extends Raid.Room {
  onBuild() {
    this.ids = NPC_BY_MODE[this.raid.mode] ?? NPC;
    this.sotetseg = this.spawn(this.ids.WAITING, SPAWN, { scale: false, scripted: true, face: Shared.facing("SOUTH") });
    if (this.sotetseg) {
      const table = HITPOINTS[this.raid.mode] ?? HITPOINTS.normal;
      const hitpoints = typeof table === "object"
        ? table[Math.max(1, Math.min(5, this.raid.size))]
        : Math.floor(table * Shared.MODES[this.raid.mode].hitpoints(this.raid.size));
      this.sotetseg.setMaxHitpoints?.(hitpoints);
      this.sotetseg.setHitpoints(hitpoints);
      this.sotetseg.getMovementQueue().setBlockMovement(true);
    }
    this.maze = null;
    this.mazesDone = 0;
    this.bigBallsLeft = 0;
    this.snacks = 0;
    this.sharedWithAll = false;
    // Captured: the arena's floor is light from the moment a party arrives.
    this.setMazeFloor(OBJECT.LIGHT);
  }

  onStart() {
    const npc = this.sotetseg;
    if (!npc) return;
    npc.setNpcTransformationId?.(this.ids.FIGHTING);
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
    if (this.deathCount > 0 && !this.deathNoted) {
      this.deathNoted = true;
      this.raid.failTask("A Timely Snack", "Someone died.");
      this.raid.failTask("Harder Mode I", "Someone died.");
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
    if (this.maze) this.endMaze();
    if (this.deathCount === 0 && this.snacks >= SNACKS_NEEDED && this.raid.taskLive("A Timely Snack")) this.raid.completeTask("A Timely Snack");
    if (this.raid.taskLive("Perfect Sotetseg")) this.raid.completeTask("Perfect Sotetseg");
    if (this.raid.taskLive("Harder Mode I")) this.raid.completeTask("Harder Mode I");
    if (this.sharedWithAll) this.raid.completeTask("Just To Be Safe");
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
      const hit = this.strike(npc, target, "melee", Shared.byMode(this.raid, MELEE.max), 1, { prayerMultiplier: MELEE.prayerMultiplier });
      this.noteHit(target, "melee", hit.getTotalDamage());
      return;
    }
    npc.performAnimation(new Animation(ANIMATION.MAGIC));
    Shared.areaSound(this.area, npc, SOUND.BALL, SOUND.BALL_DELAY);
    if (this.bigBallsLeft === 0 && this.balls >= BALL.beforeBig) {
      this.balls = 0;
      this.bigBallsLeft = Shared.byMode(this.raid, BIG_BALL.count);
    }
    if (this.bigBallsLeft > 0) {
      this.bigBallsLeft--;
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
    Shared.damage(player, Shared.random(1, Shared.byMode(this.raid, BALL.max)));
    this.noteHit(player, style, 1);
    const { PrayerHandler } = Shared.core();
    for (const prayer of [PrayerHandler.PROTECT_FROM_MAGIC, PrayerHandler.PROTECT_FROM_MISSILES, PrayerHandler.PROTECT_FROM_MELEE]) {
      PrayerHandler.deactivatePrayer(player, prayer);
    }
    player.getCombat().getPrayerBlockTimer().start(BALL.prayerBlockSeconds);
  }

  /** Perfect Sotetseg and Harder Mode I, as the captures word them. */
  noteHit(player, style, damage) {
    if (damage <= 0) return;
    const name = Shared.displayName(player);
    this.raid.failTask("Harder Mode I", `${name} got hit by Sotetseg's ${style} attack.`);
    if (!Shared.isProtected(player, style)) this.raid.failTask("Perfect Sotetseg", `${name} got hit by Sotetseg's ${style} attack and didn't pray against it.`);
  }

  bigBall(target, fighters) {
    target.sendMessage(MESSAGE.BIG_BALL);
    const ticks = Shared.projectile(this.area, this.sotetseg, target, GRAPHIC.BIG_BALL, PROJECTILE.BIG_BALL);
    this.later(ticks, () => {
      const present = this.fighters();
      if (this.maze || !present.includes(target)) return;
      const sharing = present.filter((player) => Shared.distanceTo(target, player.getLocation()) <= 1);
      const damage = Shared.byMode(this.raid, BIG_BALL);
      const total = present.length <= 1 ? damage.solo : Math.round(damage.group + (present.length - 2) * damage.perPlayer);
      const each = Math.ceil(total / Math.max(1, sharing.length));
      for (const player of sharing) {
        player.performGraphic(Shared.gfx(GRAPHIC.BIG_IMPACT));
        Shared.damage(player, each);
      }
      if (sharing.length > 1) {
        const reason = "The ball was split between at least two team members.";
        this.raid.failTask("A Timely Snack", reason);
        this.raid.failTask("Harder Mode I", reason);
        if (sharing.length === present.length) this.sharedWithAll = true;
      } else {
        this.snacks++;
      }
    });
  }

  // -------------------------------------------------------------- the maze

  startMaze() {
    const fighters = this.fighters();
    if (fighters.length === 0) return;
    const { Animation } = Shared.core();
    // Hard: all but one, kept in party order (the orbs' order). Otherwise one.
    const left = this.raid.isHard && fighters.length > 1 ? Shared.randomOf(fighters) : null;
    const runners = this.raid.isHard ? fighters.filter((player) => player !== left) : [Shared.randomOf(fighters)];
    const path = generatePath();
    const sections = this.raid.isHard ? sectionsOf(runners.length) : null;
    this.maze = {
      runners, path, sections, solo: fighters.length === 1,
      pathKeys: new Set(path.map(key)), realTiles: new Set(path.map((tile) => key(toReal(tile)))),
      glows: new Map(), wrong: new Map(), tornadoes: new Map(), drain: 0,
    };
    this.sotetseg.setNpcTransformationId?.(this.ids.WAITING);
    this.sotetseg.performAnimation(new Animation(ANIMATION.MAGIC));
    this.later(TELEPORT.inMove, () => {
      if (!this.maze) return;
      this.setMazeFloor(OBJECT.DARK);
      for (const tile of path) this.placeObject(sections ? OBJECT.SECTION_BASE + sections[tile.y - REALM.minY] : OBJECT.RED, tile, 22, 0);
    });
    for (const player of fighters) {
      const slot = runners.indexOf(player);
      const text = slot >= 0 ? MESSAGE.CHOSEN : "";
      player.getCombat().reset?.();
      player.getPacketSender().sendClientScript(Shared.SCRIPT.FADE_WHITE, text);
      if (slot >= 0 && sections) player.getPacketSender().sendVarbit(VARBIT_SECTION, slot + 1);
      this.later(TELEPORT.inMove, () => player.moveTo(Shared.loc(slot >= 0 ? REALM.start : PULLED_TO)));
      this.later(TELEPORT.inFade, () => Shared.fade(player, TELEPORT.fadeIn, text));
    }
  }

  setMazeFloor(id) {
    for (let x = MAZE.minX; x <= MAZE.maxX; x++) {
      for (let y = MAZE.minY; y <= MAZE.maxY; y++) this.placeObject(id, { x, y, z: 0 }, 22, 0);
    }
  }

  tickMaze() {
    const maze = this.maze;
    const alive = maze.runners.filter((runner) => this.raid.players.includes(runner) && !this.raid.member(runner).jailed && runner.getHitpoints() > 0);
    if (alive.length === 0) {
      this.endMaze();
      return;
    }
    if (++maze.drain >= REALM_DRAIN.every) {
      maze.drain = 0;
      for (const runner of alive) {
        runner.performGraphic(Shared.gfx(GRAPHIC.DRAIN));
        this.later(2, () => Shared.damage(runner, Shared.random(REALM_DRAIN.min, REALM_DRAIN.max)));
      }
    }
    for (const runner of alive) this.mirrorRunner(runner);
    const arena = this.fighters().filter((player) => !alive.includes(player) && Shared.tileOf(player).z === MAZE.z);
    this.punishWrongTiles(arena, MAZE.z, (at) => at.z === MAZE.z && inBox(at, MAZE) && !maze.realTiles.has(key(at)));
    // Hard: the realm has wrong tiles of its own (captured); the Normal runner's are free.
    if (this.raid.isHard) this.punishWrongTiles(alive, REALM.z, (at) => at.z === REALM.z && inBox(at, REALM) && !maze.pathKeys.has(key(at)));
    this.tickTornadoes(alive, arena);
  }

  /** The runner's tile glows red on the real maze. */
  mirrorRunner(runner) {
    const maze = this.maze;
    const at = Shared.tileOf(runner);
    if (at.z !== REALM.z || !inBox(at, REALM)) return;
    const real = toReal(at);
    const glow = maze.glows.get(runner);
    if (glow && key(glow) === key(real)) return;
    if (glow) this.placeObject(OBJECT.DARK, glow, 22, 0);
    maze.glows.set(runner, real);
    this.placeObject(OBJECT.RED, real, 22, 0);
  }

  /** Off the path: the player and anyone beside them take a share of their hitpoints. */
  punishWrongTiles(players, plane, offPath) {
    const maze = this.maze;
    const standing = new Set(players.map((player) => tileKey(Shared.tileOf(player))));
    for (const [wrong, tile] of [...maze.wrong]) {
      if (tile.z !== plane || standing.has(wrong)) continue;
      maze.wrong.delete(wrong);
      this.placeObject(OBJECT.DARK, tile, 22, 0);
    }
    const flat = Shared.byMode(this.raid, WRONG_TILE.flat);
    for (const player of players) {
      const at = Shared.tileOf(player);
      if (!offPath(at)) continue;
      const reason = `${Shared.displayName(player)} stood on an incorrect tile.`;
      this.raid.failTask("Perfect Sotetseg", reason);
      this.raid.failTask("Harder Mode I", reason);
      const fresh = !maze.wrong.has(tileKey(at));
      if (fresh) {
        maze.wrong.set(tileKey(at), at);
        this.placeObject(OBJECT.WRONG, at, 22, 0);
        Shared.areaSound(this.area, at, SOUND.WRONG_TILE);
        Shared.graphicAt(this.area, GRAPHIC.EXPLOSION, at, { height: 10 });
      }
      for (const other of players) {
        if (Shared.distanceTo(player, other.getLocation()) > 1) continue;
        if (fresh) Shared.projectile(this.area, at, other, GRAPHIC.ZAP, PROJECTILE.ZAP);
        Shared.damage(other, Math.floor(other.getHitpoints() * WRONG_TILE.share) + flat);
      }
    }
  }

  /**
   * From the fourth row on, a tornado follows the path, a tile a tick, and leaves if they step back.
   * In the arena for those left there; in the realm for a solo runner and, in Hard, when the last
   * runner or the one left in the arena is past the third row.
   */
  tickTornadoes(runners, arena) {
    const maze = this.maze;
    const past = (player, box) => {
      const at = Shared.tileOf(player);
      return at.z === box.z && inBox(at, box) && at.y >= box.minY + TORNADO_ROW;
    };
    const arenaPast = arena.some((player) => past(player, MAZE));
    this.tickTornado("arena", arena, toReal, arenaPast);
    if (maze.solo) {
      this.tickTornado("realm", runners, (tile) => tile, runners.some((player) => past(player, REALM)));
    } else if (this.raid.isHard) {
      const last = maze.runners[maze.runners.length - 1];
      this.tickTornado("realm", runners, (tile) => tile, arenaPast || (runners.includes(last) && past(last, REALM)));
    }
  }

  tickTornado(where, players, toTile, triggered) {
    const maze = this.maze;
    let entry = maze.tornadoes.get(where);
    if (!triggered) {
      if (entry?.npc) this.despawn(entry.npc);
      maze.tornadoes.delete(where);
      return;
    }
    if (!entry) {
      const start = toTile(maze.path[0]);
      entry = { npc: this.spawn(this.ids.TORNADO, { x: start.x - 1, y: start.y - 1, z: start.z }, { scale: false, scripted: true }), step: 0 };
      maze.tornadoes.set(where, entry);
    }
    if (!entry.npc) return;
    for (const player of players) {
      if (Shared.distanceTo(entry.npc, player.getLocation()) > 0) continue;
      Shared.damage(player, Shared.random(TORNADO.min, TORNADO.max));
      const name = Shared.displayName(player);
      this.raid.failTask("Perfect Sotetseg", `${name} got hit by the tornado.`);
      this.raid.failTask("Harder Mode I", `${name} got hit by the tornado.`);
    }
    if (++entry.step >= maze.path.length) {
      this.despawn(entry.npc);
      entry.npc = null;
      return;
    }
    const next = toTile(maze.path[entry.step]);
    Shared.walkStraight(entry.npc, { x: next.x - 1, y: next.y - 1, z: next.z });
  }

  /** A runner takes the portal home; the maze is over for all of them and its Defence comes back. */
  leaveRealm(player) {
    if (!this.maze || !this.maze.runners.includes(player)) return false;
    this.endMaze();
    return true;
  }

  endMaze() {
    const maze = this.maze;
    this.maze = null;
    this.mazesDone++;
    for (const { npc } of maze.tornadoes.values()) if (npc) this.despawn(npc);
    for (const tile of maze.path) this.placeObject(OBJECT.DARK, tile, 22, 0);
    for (const tile of maze.wrong.values()) this.placeObject(OBJECT.DARK, tile, 22, 0);
    this.later(TELEPORT.outMove, () => this.setMazeFloor(OBJECT.LIGHT));
    if (this.sotetseg) {
      this.sotetseg.setNpcTransformationId?.(this.ids.FIGHTING);
      Shared.restoreDefence(this.sotetseg);
    }
    // Captured: it attacks again the tick after the runner is back.
    this.ticks = ATTACK_TICKS - TELEPORT.outMove - 1;
    for (const runner of maze.runners) {
      if (!this.raid.players.includes(runner) || this.raid.member(runner).jailed) continue;
      runner.getPacketSender().sendClientScript(Shared.SCRIPT.FADE_WHITE, "");
      this.later(TELEPORT.outMove, () => {
        if (Shared.tileOf(runner).z === REALM.z) runner.moveTo(Shared.loc(RETURN));
      });
      this.later(TELEPORT.outFade, () => Shared.fade(runner, TELEPORT.fadeIn, ""));
    }
  }
}

function tileKey(tile) {
  return `${tile.x},${tile.y},${tile.z}`;
}

function inBox(tile, box) {
  return tile.x >= box.minX && tile.x <= box.maxX && tile.y >= box.minY && tile.y <= box.maxY;
}

/** A realm tile's twin in the real maze. */
function toReal(tile) {
  return { x: MAZE.minX + (tile.x - REALM.minX), y: MAZE.minY + (tile.y - REALM.minY), z: 0 };
}

/** Each of the maze's rows' section, by how many run: index by row, value 0 to 3. */
function sectionsOf(runners) {
  const rows = SECTION_ROWS[Math.max(1, Math.min(4, runners))];
  return rows.flatMap((count, section) => Array(count).fill(section));
}

/**
 * The maze, as every captured one: eight columns, one for each even row, each up to 5 tiles from the last;
 * the odd row between runs from one column to the next. The top row's column leads on to the portal.
 */
function generatePath(random = Math.random) {
  const width = REALM.maxX - REALM.minX + 1;
  const rows = REALM.maxY - REALM.minY + 1;
  const pick = (min, max) => min + Math.floor(random() * (max - min + 1));
  const tiles = [];
  const add = (x, y) => tiles.push({ x: REALM.minX + x, y: REALM.minY + y, z: REALM.z });
  let x = pick(0, width - 1);
  add(x, 0);
  for (let y = 1; y < rows; y += 2) {
    const nextX = pick(Math.max(0, x - 5), Math.min(width - 1, x + 5));
    const step = nextX > x ? 1 : -1;
    for (let cx = x; cx !== nextX + step; cx += step) add(cx, y);
    add(nextX, y + 1);
    x = nextX;
  }
  return tiles;
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
