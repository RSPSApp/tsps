"use strict";

/**
 * Ezekiel (section 1, west): a knight of judgement with animated swords, and a finale behind a
 * wall of blades below a third of his health.
 *
 * Captured as a spectator in one five-player fight (docs/fractured-archive.md):
 * - Ezekiel (16652, 3x3) at 4062,5537; 6,870 hitpoints for five. "To stand against good is to be
 *   evil, regardless of reason." He walks after his target, faced as an entity.
 * - A 36-37 tick cycle: his special, melee seven and twelve ticks later, the swords flying at
 *   fourteen, melee again at 26 and 31.
 * - Melee (melee01) is a cleave: tfa_wave_dust on the ring round him (delays 5-7), except the
 *   three tiles directly behind him, opposite his target. With the target out of reach, a magic
 *   attack (magic01) goes at everyone instead.
 * - The special (special01, ezekiel_special_crack_vfx01, area sound 12454): a star of explosions
 *   on the tiles one to three steps round him (spawn, marker and explosion at 34/64/94 cycles,
 *   two later per step out), and his swords (Animated Sword 16653, 3x3), each with a timer bar
 *   (headbar 87, 60 to 0 over 390 cycles). Fourteen ticks later each flies twelve tiles along
 *   its lane in one tick (a 30-cycle exact move) and fades. The patterns:
 *   - "Divine consequence!": a cross, one vertical lane (both ends) and one horizontal;
 *   - "Divine judgement!": three in a row from the north, flying a tick apart, west to east;
 *     or two vertical lanes, both ends.
 * - A sword flying through him: "Agh!", idle_to_weaken01 and the weakened stance (a base
 *   animation change to weaken01) for eight ticks, without attacking.
 * - Players' hits on a sword charge it (hitsplat 23 and a second bar, headbar 42, filling)
 *   instead of hurting it; the Wiki says the charge raises its damage.
 * - Below a third: he moves to 4059,5534 (a 60-cycle exact move), plays finale01 with its glow
 *   and stands in finale_loop01. The 9x9 round him is blocked except the 3x3 in front of him
 *   (4062-4064 x 5534-5536). Seven fence swords drop round it (drop0N, then idle0N) and three
 *   finale swords on his footprint (north, middle, south).
 * - Every 11 ticks a barrage in three steps a tick apart: lightning (telegraph) on two of the
 *   three finale swords each step. The one left out shows the safe tile (the guides: the east
 *   row of the 3x3, north, middle or south as the sword); impacts land over the rest.
 * - At 0: finale_death01, "...Formidable.", the finale swords' despawns, and his death sword
 *   (16656) left. Ten ticks later the room is won.
 * From the Wiki, the guides and the user (a spectator can't see players): the first player in is
 * his tank until they die; a player stepping out of a flying sword's lane rolls clear
 * (tfa_ezekiel_roll), as they roll between the finale's tiles; at the finale everyone is pushed
 * into the 3x3, unhurt.
 * Estimates: every damage figure, the swords' charge scale, the finale's safe tile, a sword
 * missing him healing him (Wiki: "a significant amount"; here 5%). The swords' fade-in isn't sent.
 */

const Shared = require("./Shared.FracturedArchive");
const Raid = require("./RaidState.FracturedArchive");

const { named, anim, spot } = Shared;

const LAYOUT = {
  ezekiel: { x: 4062, y: 5537, z: 0 },
  arena: { minX: 4056, maxX: 4068, minY: 5528, maxY: 5540 },
  finale: { x: 4059, y: 5534, z: 0 },
  wall: { minX: 4059, maxX: 4067, minY: 5531, maxY: 5539 },
  /** The finale's open 3x3 in front of him. */
  pen: { minX: 4062, maxX: 4064, minY: 5534, maxY: 5536 },
};
/** Five players captured (6,870); the rest follow Dreadnoth's ratios from the cache's 3,000. */
const HITPOINTS = { 2: 3000, 3: 4360, 4: 5610, 5: 6870 };

const TIME = {
  FIRST_SPECIAL: 6,
  CYCLE: 36,
  MELEES: [7, 12, 26, 31],
  FLY: 14,
  STAGGER: 1,
  SWORDS_GONE: 2,
  WEAKEN: 8,
  FINALE_SETUP: 3,
  FINALE_SWORDS: 5,
  FIRST_BARRAGE: 9,
  BARRAGE: 11,
  WON_AFTER_DEATH: 10,
};
const DAMAGE = { MELEE: 35, MAGIC: 25, STAR: 25, SWORD: 45, SWORD_ON_HIM: 30, BARRAGE: 40, HEAL_SHARE: 0.05 };
const STAR_DELAYS = [34, 64, 94];
const SWORD_TIMER = { id: 87, fill: 60, cycles: 390 };
const SWORD_CHARGE = { id: 42, width: 30, full: 32 };
const ROLL_CYCLES = 30;
/** A roll between the finale's tiles takes a tick, as the strikes come a tick apart. */
const FINALE_ROLL_CYCLES = 30;
/** How long a dodge's facing is remembered for the next (estimate: a barrage's span). */
const FACING_HOLDS = 6;
/** A click out of a sword's lane this close to its flight is a roll (estimate). */
const SWORD_DODGE_TICKS = 2;

/** The swords ([side, lane's first tile, stagger in ticks]). */
const PATTERNS = [
  () => {
    const x = Shared.randomOf([4059, 4065]);
    const y = Shared.randomOf([5534, 5537]);
    return { line: "Divine consequence!", swords: [["N", x, 0], ["S", x, 0], ["W", y, 0], ["E", y, 0]] };
  },
  () => ({ line: "Divine judgement!", swords: [["N", 4059, 0], ["N", 4062, 1], ["N", 4065, 2]] }),
  () => ({ line: "Divine judgement!", swords: [["N", 4060, 0], ["S", 4060, 0], ["N", 4064, 0], ["S", 4064, 0]] }),
];

/** The fence swords (captured tiles, with their drop and idle numbers). */
const FENCE = [[4065, 5537, 3], [4059, 5537, 1], [4062, 5537, 2], [4059, 5531, 6], [4062, 5531, 7], [4065, 5534, 4], [4065, 5531, 1]];
/** The finale swords on his footprint: their lightning graphic and sound (captured), and the 3x3 row each keeps safe. */
const FINALE_SWORDS = [
  { x: 4060, y: 5536, number: 3, telegraph: "vfx_ezekiel_sword_telegraph03", sound: 12413, row: 5536 },
  { x: 4061, y: 5535, number: 1, telegraph: "vfx_ezekiel_sword_telegraph01", sound: 12417, row: 5535 },
  { x: 4060, y: 5534, number: 4, telegraph: "vfx_ezekiel_sword_telegraph04", sound: 12423, row: 5534 },
];
const IMPACT_DELAYS = [124, 154, 184];

class EzekielRoom extends Raid.Room {
  onBuild() {
    this.ezekiel = this.spawn(named("npc", "tfa_ezekiel"), LAYOUT.ezekiel, { scripted: true });
    this.swords = new Map();
    this.weakened = false;
    this.inFinale = false;
    this.rollUntil = -1;
    this.dead = false;
  }

  onStart() {
    this.setHitpoints(this.ezekiel, this.scaled(HITPOINTS));
    this.showBar(this.ezekiel.getId(), this.ezekiel.getMaxHitpoints());
    this.ezekiel.forceChat("To stand against good is to be evil, regardless of reason.");
    this.tank = this.fighters().includes(this.starter) ? this.starter : this.fighters()[0] ?? null;
    this.ezekiel.setMobileInteraction(this.tank);
    this.later(TIME.FIRST_SPECIAL, () => this.cycle());
  }

  tick() {
    if (!this.isStarted() || this.dead) return;
    this.barTo(this.ezekiel.getHitpoints());
    // The swords' hitpoints never go down: hits charge them instead.
    for (const sword of this.swords.keys()) if (sword.getHitpoints() < sword.getMaxHitpoints()) sword.setHitpoints(sword.getMaxHitpoints());
    if (this.inFinale) return;
    if (!this.weakened) this.chase();
    if (this.ezekiel.getHitpoints() < this.ezekiel.getMaxHitpoints() / 3) this.finale();
  }

  /** His tank: the first player in, until they die (Wiki); then the nearest fighter. */
  target() {
    if (!this.fighters().includes(this.tank)) {
      this.tank = nearest(this.ezekiel, this.fighters());
      this.ezekiel.setMobileInteraction(this.tank ?? null);
    }
    return this.tank;
  }

  chase() {
    const target = this.target();
    if (!target || Shared.distanceTo(this.ezekiel, target.getLocation()) <= 1) return;
    const movement = this.ezekiel.getMovementQueue();
    if (movement.size() > 0) return;
    const at = target.getLocation();
    movement.reset().addSteps(Shared.loc({ x: at.getX(), y: at.getY(), z: 0 }));
  }

  /** The special, then melee at 7 and 12, the swords at 14, melee at 26 and 31 (captured). */
  cycle() {
    if (this.dead || this.inFinale) return;
    this.special();
    for (const at of TIME.MELEES) this.later(at, () => !this.dead && !this.inFinale && !this.weakened && this.attack());
    this.later(TIME.CYCLE + Shared.random(0, 1), () => this.cycle());
  }

  /** The cleave round him (all but the three tiles behind him), or magic at everyone. */
  attack() {
    const target = this.target();
    if (!target) return;
    if (Shared.distanceTo(this.ezekiel, target.getLocation()) > 1) {
      this.ezekiel.performAnimation(anim("npc_ezekiel_magic01"));
      for (const player of this.fighters()) {
        player.performGraphic(spot("ezekiel_magic_attack_vfx01"));
        this.strike(this.ezekiel, player, "magic", DAMAGE.MAGIC, 2, { prayerMultiplier: 0 });
      }
      return;
    }
    this.ezekiel.getMovementQueue().reset();
    this.ezekiel.performAnimation(anim("npc_ezekiel_melee01"));
    const tiles = this.cleaveTiles(Shared.tileOf(target));
    for (const tile of tiles) Shared.graphicAt(this.area, named("spotanim", "tfa_wave_dust"), tile, { delay: Shared.random(5, 7) });
    this.later(1, () => {
      for (const player of this.fighters()) {
        const at = Shared.tileOf(player);
        if (!tiles.some((tile) => tile.x === at.x && tile.y === at.y)) continue;
        const hit = this.styledHit(this.ezekiel, player, "melee", DAMAGE.MELEE, 0, { prayerMultiplier: 0.3 });
        Shared.core().CombatFactory.executeHit(hit);
      }
    });
  }

  /** The ring touching his 3x3, less the three tiles on the side away from `toward`. */
  cleaveTiles(toward) {
    const at = this.ezekiel.getLocation();
    const x0 = at.getX();
    const y0 = at.getY();
    const dx = toward.x < x0 ? -1 : toward.x > x0 + 2 ? 1 : 0;
    const dy = toward.y < y0 ? -1 : toward.y > y0 + 2 ? 1 : 0;
    // The side behind him: the axis the target is off, the vertical one when off both.
    const behind = dy !== 0 ? { y: dy > 0 ? y0 - 1 : y0 + 3 } : dx !== 0 ? { x: dx > 0 ? x0 - 1 : x0 + 3 } : null;
    const tiles = [];
    for (let x = x0 - 1; x <= x0 + 3; x++) {
      for (let y = y0 - 1; y <= y0 + 3; y++) {
        if (x >= x0 && x <= x0 + 2 && y >= y0 && y <= y0 + 2) continue;
        if (behind?.y !== undefined && y === behind.y && x >= x0 && x <= x0 + 2) continue;
        if (behind?.x !== undefined && x === behind.x && y >= y0 && y <= y0 + 2) continue;
        tiles.push({ x, y, z: 0 });
      }
    }
    return tiles;
  }

  // ---------------------------------------------------------------- the special

  special() {
    this.ezekiel.getMovementQueue().reset();
    this.ezekiel.performAnimation(anim("npc_ezekiel_special01"));
    this.ezekiel.performGraphicInSlot(2, spot("ezekiel_special_crack_vfx01"));
    Shared.areaSound(this.area, this.ezekiel, 12454);
    this.star();
    const pattern = Shared.randomOf(PATTERNS)();
    this.ezekiel.forceChat(pattern.line);
    this.raiseSwords(pattern.swords);
  }

  /** The star: the tiles one to three steps (Manhattan) round his footprint, timed by distance. */
  star() {
    const at = this.ezekiel.getLocation();
    const tiles = [];
    for (let x = at.getX() - 3; x <= at.getX() + 5; x++) {
      for (let y = at.getY() - 3; y <= at.getY() + 5; y++) {
        const dx = x < at.getX() ? at.getX() - x : x > at.getX() + 2 ? x - at.getX() - 2 : 0;
        const dy = y < at.getY() ? at.getY() - y : y > at.getY() + 2 ? y - at.getY() - 2 : 0;
        const manhattan = dx + dy;
        if (manhattan >= 1 && manhattan <= 3 && dx !== dy) tiles.push({ x, y, z: 0, step: manhattan });
      }
    }
    const names = ["vfx_ezekiel_star_explosion_spawn01", "vfx_ezekiel_star_explosion_marker01", "vfx_ezekiel_star_explosion01"];
    for (const tile of tiles) names.forEach((name, i) => Shared.graphicAt(this.area, named("spotanim", name), tile, { delay: STAR_DELAYS[i] + 2 * (tile.step - 1) }));
    Shared.areaSound(this.area, this.ezekiel, 12441, 90);
    // On the tick the explosions show (94-98 cycles: tick 3), applied at once.
    this.later(Math.floor(STAR_DELAYS[2] / 30), () => {
      for (const player of this.fighters()) {
        const p = Shared.standingOn(player);
        if (tiles.some((tile) => tile.x === p.x && tile.y === p.y)) Shared.damageNow(player, Shared.random(DAMAGE.STAR / 2, DAMAGE.STAR));
      }
    });
  }

  /** The swords at their lanes' ends with their timers; each flies `TIME.FLY` (+ stagger) later. */
  raiseSwords(placements) {
    const { arena } = LAYOUT;
    const raised = [];
    for (const [side, lane, stagger] of placements) {
      const tile = side === "N" ? { x: lane, y: arena.maxY } : side === "S" ? { x: lane, y: arena.minY }
        : side === "W" ? { x: arena.minX, y: lane } : { x: arena.maxX, y: lane };
      const sword = this.spawn(named("npc", "tfa_ezekiel_sword"), { ...tile, z: 0 }, { scripted: true, fadeIn: 30 });
      if (!sword) continue;
      sword.showHeadbar(SWORD_TIMER.id, { fill: SWORD_TIMER.fill, endFill: 0, duration: SWORD_TIMER.cycles });
      const state = { side, tile, charge: 0, fliesAt: Shared.cycle() + TIME.FLY + stagger * TIME.STAGGER };
      this.swords.set(sword, state);
      raised.push([sword, state, stagger]);
    }
    let hitHim = false;
    let flown = 0;
    for (const [sword, state, stagger] of raised) {
      this.later(TIME.FLY + stagger * TIME.STAGGER, () => {
        if (this.swords.has(sword) && !this.dead && !this.inFinale && this.fly(sword, state)) hitHim = true;
        if (++flown < raised.length || this.dead || this.inFinale) return;
        if (hitHim) this.weaken();
        else this.heal();
      });
    }
  }

  /** Whether a tile is in a sword's lane: its three tiles across, along the line it flies. */
  inLane(state, tile) {
    const { side, tile: from } = state;
    return side === "N" || side === "S" ? tile.x >= from.x && tile.x <= from.x + 2 : tile.y >= from.y && tile.y <= from.y + 2;
  }

  /** Twelve tiles along its lane in one tick; returns whether it went through Ezekiel. */
  fly(sword, state) {
    const step = { N: [0, -12], S: [0, 12], W: [12, 0], E: [-12, 0] }[state.side];
    sword.removeHeadbar(SWORD_CHARGE.id);
    sword.exactMove(Shared.loc({ x: state.tile.x + step[0], y: state.tile.y + step[1], z: 0 }), { endCycles: 30 });
    // It fades out as it ends its flight (captured: cycles 30 to 60).
    sword.fade(255, { from: 0, startCycles: 30, endCycles: 60 });
    const damage = Math.round(DAMAGE.SWORD * (1 + Math.min(state.charge, SWORD_CHARGE.full) / SWORD_CHARGE.full));
    for (const player of this.fighters()) {
      if (!this.inLane(state, Shared.standingOn(player)) || this.rollOut(player, state)) continue;
      Shared.damage(player, Shared.random(Math.floor(damage / 2), damage));
    }
    this.later(TIME.SWORDS_GONE, () => {
      this.swords.delete(sword);
      this.despawn(sword);
    });
    const at = this.ezekiel.getLocation();
    const vertical = state.side === "N" || state.side === "S";
    const through = vertical
      ? state.tile.x <= at.getX() + 2 && state.tile.x + 2 >= at.getX()
      : state.tile.y <= at.getY() + 2 && state.tile.y + 2 >= at.getY();
    if (through) Shared.damage(this.ezekiel, DAMAGE.SWORD_ON_HIM);
    return through;
  }

  /** A player walking out of a flying sword's lane rolls clear (Wiki, user). */
  rollOut(player, state) {
    const destination = player.getMovementQueue().getDestination?.();
    if (!destination) return false;
    const at = Shared.tileOf(player);
    const clear = { x: clamp(destination.getX(), at.x - 3, at.x + 3), y: clamp(destination.getY(), at.y - 3, at.y + 3), z: 0 };
    if (this.inLane(state, clear) || !Shared.floorFree(this.area, clear)) return false;
    this.dodge(player, clear, ROLL_CYCLES);
    return true;
  }

  /** A walk click mid roll, from the raid's area: the next roll at once. */
  forcedWalk(player, destination) {
    return this.routeRoll(player, destination);
  }

  /**
   * A walk click while a dodge is due rolls at once, before it becomes a step (no delay between
   * rolls): in the finale's 3x3 from the barrage's start to its last impact, or out of a sword's
   * lane in the two ticks before it flies. Returns whether the click was taken.
   */
  routeRoll(player, destination) {
    if (!this.isStarted() || this.dead || !this.fighters().includes(player)) return false;
    // Mid-roll, the dodge starts from where that roll lands.
    const rolling = player.__tfaForceMove;
    const at = rolling && player.getForceMovement?.() === rolling.movement
      ? { x: rolling.end.getX(), y: rolling.end.getY(), z: rolling.end.getZ() }
      : Shared.tileOf(player);
    const now = Shared.cycle();
    if (this.inFinale) {
      if (now > this.rollUntil || !inPen(at)) return false;
      const { pen } = LAYOUT;
      const goal = { x: clamp(destination.x, pen.minX, pen.maxX), y: clamp(destination.y, pen.minY, pen.maxY), z: 0 };
      if (goal.x === at.x && goal.y === at.y) return false;
      this.dodge(player, goal, FINALE_ROLL_CYCLES);
      return true;
    }
    const due = [...this.swords.values()].find((state) => state.fliesAt - now <= SWORD_DODGE_TICKS && state.fliesAt >= now && this.inLane(state, at));
    if (!due) return false;
    const goal = { x: clamp(destination.x, at.x - 3, at.x + 3), y: clamp(destination.y, at.y - 3, at.y + 3), z: 0 };
    if (this.inLane(due, goal) || !Shared.floorFree(this.area, goal)) return false;
    this.dodge(player, goal, ROLL_CYCLES);
    return true;
  }

  /**
   * A roll, or a quick step back (tfa_ezekiel_strafe, keeping their facing) when the move goes
   * against the way the player faces (user). They face their target while attacking one, else
   * the way their last dodge left them, else Ezekiel.
   */
  dodge(player, goal, cycles) {
    const rolling = player.__tfaForceMove;
    const at = rolling && player.getForceMovement?.() === rolling.movement
      ? { x: rolling.end.getX(), y: rolling.end.getY() }
      : Shared.tileOf(player);
    const [fx, fy] = this.facingOf(player, at);
    const mx = Math.sign(goal.x - at.x);
    const my = Math.sign(goal.y - at.y);
    if (mx * fx + my * fy < 0) {
      Shared.forceMove(player, goal, cycles, named("seq", "tfa_ezekiel_strafe"), directionIndex(fx, fy));
      return;
    }
    Shared.forceMove(player, goal, cycles, named("seq", "tfa_ezekiel_roll"));
    player.__tfaFacing = { x: mx, y: my, cycle: Shared.cycle() };
  }

  /** The way a player faces, as a unit step. */
  facingOf(player, at) {
    const target = player.getInteractingMobile?.();
    if (target) return toward(at, target);
    // A dodge's facing holds until the player walks; a few ticks covers a barrage's dodges.
    const last = player.__tfaFacing;
    if (last && (last.x || last.y) && Shared.cycle() - last.cycle <= FACING_HOLDS) return [last.x, last.y];
    return toward(at, this.ezekiel);
  }

  weaken() {
    this.weakened = true;
    this.ezekiel.getMovementQueue().reset();
    this.ezekiel.forceChat("Agh!");
    this.ezekiel.performAnimation(anim("npc_ezekiel_idle_to_weaken01"));
    const weakened = named("seq", "npc_ezekiel_weaken01");
    this.ezekiel.setBaseAnimations({ idle: weakened, turnLeft: weakened, turnRight: weakened });
    this.later(TIME.WEAKEN, () => {
      this.weakened = false;
      if (this.dead || this.inFinale) return;
      this.ezekiel.setBaseAnimations(null);
      this.ezekiel.performAnimation(anim("npc_ezekiel_weaken_to_idle01"));
    });
  }

  heal() {
    const max = this.ezekiel.getMaxHitpoints();
    this.ezekiel.setHitpoints(Math.min(max, this.ezekiel.getHitpoints() + Math.round(max * DAMAGE.HEAL_SHARE)));
  }

  // ---------------------------------------------------------------- the finale

  finale() {
    if (this.inFinale) return;
    this.inFinale = true;
    this.weakened = false;
    this.ezekiel.setBaseAnimations(null);
    for (const sword of [...this.swords.keys()]) this.despawn(sword);
    this.swords.clear();
    this.ezekiel.getMovementQueue().reset();
    this.ezekiel.exactMove(Shared.loc(LAYOUT.finale), { endCycles: 60 });
    this.ezekiel.performAnimation(anim("npc_ezekiel_walk01"));
    this.later(TIME.FINALE_SETUP, () => {
      this.ezekiel.setMobileInteraction(null);
      this.ezekiel.setPositionToFace(Shared.loc({ x: LAYOUT.pen.maxX, y: LAYOUT.pen.minY + 1, z: 0 }));
      this.ezekiel.performAnimation(anim("npc_ezekiel_finale01"));
      this.ezekiel.performGraphicInSlot(1, spot("vfx_ezekiel_finale_cast_glow01"));
      this.ezekiel.setBaseAnimations({ idle: named("seq", "npc_ezekiel_finale_loop01") });
      this.later(2, () => this.ezekiel.performGraphicInSlot(5, spot("vfx_ezekiel_finale_cast_glow_loop01")));
      this.pushIn();
      const { wall, pen } = LAYOUT;
      const blocker = named("loc", "invisible_type8_blocking");
      this.blockers = [];
      for (let x = wall.minX; x <= wall.maxX; x++) {
        for (let y = wall.minY; y <= wall.maxY; y++) {
          if (x >= pen.minX && x <= pen.maxX && y >= pen.minY && y <= pen.maxY) continue;
          this.blockers.push(this.placeObject(blocker, { x, y, z: 0 }));
        }
      }
      Shared.areaSound(this.area, this.ezekiel, 12407);
      this.fence = FENCE.map(([x, y, number]) => {
        const sword = this.spawn(named("npc", "tfa_ezekiel_sword_noop"), { x, y, z: 0 }, { scripted: true });
        if (!sword) return null;
        sword.performAnimation(anim(`vfx_ezekiel_sword_fence_drop0${number}`));
        sword.setBaseAnimations({ idle: named("seq", `vfx_ezekiel_sword_fence_idle0${number}`) });
        return sword;
      }).filter(Boolean);
    });
    this.later(TIME.FINALE_SWORDS, () => {
      this.finaleSwords = FINALE_SWORDS.map((def) => {
        const sword = this.spawn(named("npc", "tfa_ezekiel_finale_vfx"), { x: def.x, y: def.y, z: 0 }, { scripted: true, face: Shared.core().Direction.EAST.getId() });
        if (!sword) return null;
        sword.performAnimation(anim(`vfx_ezekiel_finale_sword_drop0${def.number}`));
        if (def.number !== 1) {
          const idle = named("seq", `vfx_ezekiel_finale_sword_idle0${def.number}`);
          sword.setBaseAnimations({ idle, walk: idle });
        }
        Shared.areaSound(this.area, sword, 12400);
        return { sword, def };
      }).filter(Boolean);
    });
    this.later(TIME.FIRST_BARRAGE, () => {
      if (this.dead) return;
      this.barrage();
      this.repeat(TIME.BARRAGE, () => {
        if (this.dead) return false;
        this.barrage();
        return true;
      });
    });
  }

  /** At the finale everyone is pushed into the 3x3, unhurt (the user's report of live). */
  pushIn() {
    const { pen } = LAYOUT;
    const free = [];
    for (let x = pen.minX; x <= pen.maxX; x++) for (let y = pen.minY; y <= pen.maxY; y++) free.push({ x, y });
    Shared.shuffle(free);
    this.fighters().forEach((player, i) => {
      if (inPen(Shared.tileOf(player))) return;
      Shared.forceMove(player, free[i % free.length], 60);
    });
  }

  /**
   * Three steps a tick apart: lightning on two of the three finale swords each step. The one
   * left out keeps its row's east tile safe; the rest of the 3x3 is struck.
   */
  barrage() {
    const swords = this.finaleSwords ?? [];
    if (swords.length === 0) return;
    this.ezekiel.performGraphic(spot("vfx_ezekiel_finale_cast01", { delay: 225 }));
    Shared.areaSound(this.area, this.ezekiel, 12416, 225);
    this.rollUntil = Shared.cycle() + Math.ceil(IMPACT_DELAYS[IMPACT_DELAYS.length - 1] / 30);
    const { pen } = LAYOUT;
    Shared.shuffle([0, 1, 2]).forEach((open, step) => {
      swords.forEach(({ sword, def }, index) => {
        if (index !== open) {
          sword.performGraphicInSlot(step, spot(def.telegraph, { delay: 30 * step }));
          Shared.areaSound(this.area, sword, def.sound, 30 * step);
        }
      });
      const safeRow = swords[open]?.def.row;
      const struck = [];
      for (let x = pen.minX; x <= pen.maxX; x++) {
        for (let y = pen.minY; y <= pen.maxY; y++) {
          if (x === pen.maxX && y === safeRow) continue;
          struck.push({ x, y });
          const impact = (x + y) % 2 ? "vfx_ezekiel_finale_impact_medium01" : "vfx_ezekiel_finale_impact_small01";
          Shared.graphicAt(this.area, named("spotanim", impact), { x, y, z: 0 }, { delay: IMPACT_DELAYS[step] });
        }
      }
      Shared.areaSound(this.area, this.ezekiel, 12407, 120 + 30 * step);
      // On the tick the impact shows (captured: 124/154/184 cycles, ticks 4-6), applied at once.
      this.later(Math.floor(IMPACT_DELAYS[step] / 30), () => {
        if (this.dead) return;
        for (const player of this.fighters()) {
          const at = Shared.standingOn(player);
          if (struck.some((tile) => tile.x === at.x && tile.y === at.y)) Shared.damageNow(player, Shared.random(DAMAGE.BARRAGE / 2, DAMAGE.BARRAGE));
        }
      });
    });
  }

  // ---------------------------------------------------------------- damage and death

  /** Players' hits on a sword charge it (captured: hitsplat 23 and its second bar). */
  modifyHit(npc, hit) {
    const state = this.swords.get(npc);
    if (!state) return;
    state.charge += hit.getTotalDamage?.() ?? 0;
    for (const part of hit.getHits?.() ?? []) part.setSplatTypes?.(22, 23);
    npc.showHeadbar(SWORD_CHARGE.id, { fill: Math.min(SWORD_CHARGE.width, Math.round((state.charge * SWORD_CHARGE.width) / SWORD_CHARGE.full)) });
  }

  holdsOn(npc) {
    if (npc === this.ezekiel) {
      this.fall();
      return true;
    }
    if (this.swords.has(npc)) {
      npc.setHitpoints(npc.getMaxHitpoints());
      return true;
    }
    return false;
  }

  fall() {
    if (this.dead) return;
    this.dead = true;
    this.ezekiel.setHitpoints(1);
    this.ezekiel.setBaseAnimations(null);
    this.ezekiel.performAnimation(anim("npc_ezekiel_finale_death01"));
    this.ezekiel.forceChat("...Formidable.");
    // He fades out late in his death (captured: cycles 210 to 270).
    this.ezekiel.fade(255, { from: 0, startCycles: 210, endCycles: 270 });
    for (const { sword, def } of this.finaleSwords ?? []) sword.performAnimation(anim(`vfx_ezekiel_finale_sword_despawn0${def.number}`));
    this.spawn(named("npc", "tfa_ezekiel_death_sword"), Shared.tileOf(this.ezekiel), { scripted: true });
    // The fence swords fade out the tick before they go (captured).
    this.later(TIME.WON_AFTER_DEATH - 1, () => {
      for (const sword of this.fence ?? []) sword.fade(255, { from: 0, endCycles: 30 });
    });
    this.later(TIME.WON_AFTER_DEATH, () => {
      this.despawn(this.ezekiel);
      for (const npc of [...(this.finaleSwords ?? []).map((entry) => entry.sword), ...(this.fence ?? [])]) this.despawn(npc);
      // The 9x9 is walkable again once the swords are gone.
      for (const blocker of this.blockers ?? []) this.removeObject(blocker);
      this.blockers = [];
      this.complete();
    });
  }

  canAttack(attacker, target) {
    if (attacker?.isPlayer?.() && target === this.ezekiel && this.dead) return false;
    return null;
  }

  onComplete() {
    this.hideBars();
  }
}

function roomOf(player) {
  const room = Raid.raidOf(player)?.room;
  return room instanceof EzekielRoom ? room : null;
}

/** A walk click: a roll when one is due (Ezekiel's swords and finale), else a normal walk. */
function walkRoute(event) {
  const room = roomOf(event.player);
  if (!room || !room.routeRoll(event.player, event.destination)) return false;
  event.handled = true;
  return true;
}

/** The unit step from a tile towards an actor's footprint centre. */
function toward(at, actor) {
  const tile = Shared.tileOf(actor);
  const half = ((actor.getSize?.() ?? 1) - 1) / 2;
  return [Math.sign(tile.x + half - at.x), Math.sign(tile.y + half - at.y)];
}

/** A forced move's facing (0 north, 1 east, 2 south, 3 west) for a unit step. */
function directionIndex(dx, dy) {
  return Math.abs(dx) >= Math.abs(dy) && dx !== 0 ? (dx > 0 ? 1 : 3) : (dy > 0 ? 0 : 2);
}

function inPen({ x, y }) {
  const { pen } = LAYOUT;
  return x >= pen.minX && x <= pen.maxX && y >= pen.minY && y <= pen.maxY;
}

function nearest(npc, players) {
  let best = null;
  for (const player of players) if (!best || Shared.distanceTo(npc, player.getLocation()) < Shared.distanceTo(npc, best.getLocation())) best = player;
  return best;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

module.exports = function registerEzekiel(api) {
  Shared.bind(api);
  Raid.registerRoom("EZEKIEL", EzekielRoom);
  api.onWalkRoute(walkRoute);
  // A click mid-roll chains the next roll at once (user: no delay between them).
};

Object.assign(module.exports, { EzekielRoom, LAYOUT, HITPOINTS, TIME, DAMAGE });
