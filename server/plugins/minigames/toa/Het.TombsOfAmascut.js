"use strict";

/**
 * Path of Het, Test of Strength. A beam from the caster statue must be bounced off mirrors onto
 * the shield statue. That weakens Het's seal for a while: mine it with a pickaxe before the walls
 * rise again in the next layout. Orbs of Darkness roll across the floor throughout.
 *
 * Where the numbers come from. Captures are rsprox <rev>/<rec>, ticks as recorded.
 *
 * Wiki (Het's Seal, Strategies, Mirror, Statue, Cavity):
 * - Seal hitpoints by team size (119, 225, 321, 417, 512, 608, 704, 800). Neither raid level nor
 *   invocations touch them. The 25 June 2025 and 20 May 2026 changes lowered them, so recordings
 *   are older than the table: 223/00014 ticks 1748-1763 shows a bar for about 125.
 * - Damage (Mod Ash's formula on the Strategies page): 8 / 15 / 17 below 85 / below 99 / 99+ visible
 *   Mining (the threshold moved to 99 on 25 June 2025), +2 for dragon or better, -3 below rune,
 *   then +0-2. A swing every 3 ticks for 35 Mining experience (also 223/00014 ticks 1747, 1750).
 * - The bronze pickaxe when nothing is stored, three mirrors that can be picked up, a new puzzle
 *   after a team wipe.
 *
 * Captures:
 * - Layouts: all 96 rises in the recorded rooms, solo to 8 players. Three wall layouts in a fixed
 *   cycle (40 -> 44 -> 47 walls, every change agrees), each with four sets of fixed mirrors drawn
 *   at random. The three loose mirrors never move. Each layout has walls that are always breakable
 *   and others that sometimes are. 223/00014 tick 1649, 227/01852 tick 18770.
 * - Beam: fires 10 ticks after the walls rise (223/00014 1649 -> 1659, 1765 -> 1775), then every
 *   9 ticks. One client cycle per tile; the end graphic on the blocking tile, at the last tile's delay.
 * - The strike: T beam, T+1 messages and the seal changes, T+2 everything is cleared and rocks start
 *   falling, T+25 the walls rise (223/00014 ticks 1740, 1741, 1742, 1765).
 * - Mining: message and swing on arrival, the first hit 2 ticks later, then one every 3 ticks
 *   (223/00014 ticks 1745, 1747, 1750). The room ends 2 ticks after the last swing (1987, 1989)
 *   and the seal becomes toa_het_goal_dead.
 * - Walls: rising ids for 2 ticks, then settled ones (1649, 1651). A broken one gives 25 Mining
 *   experience (ticks 1747-1854's experience).
 * - Mirrors: a placed one takes the player's tile, turned to their last step (N/E/S/W = 0-3; 6 of 6
 *   in 223/00014), and appears a tick later. A push lands a tick later too (1718, 1719).
 * - Orbs: warned with 382, born 4 ticks later with 379, two every 7 ticks from 7 ticks in (862 of
 *   862 gaps), one tile a tick. They burst on the walls and mirrors in their way and on whoever they
 *   hit. Spawn tiles and directions: every spawn in every recording (905 pairs).
 * - Dirty mirrors at the rise: team size - 2, at most 4 (2p 0, 3p 1, 5p 3, 6p 4, 8p 4).
 * - Sliding off a rising wall: exact move, no animation (25 of 25, 223/00014 tick 1765).
 * - Perfect Het's wording: 223/00014 tick 1687, 227/00553 ticks 6090 and 8037 (2 ticks after the rise).
 * - Pickaxes: "You take the Bronze pickaxe." 234/00844 tick 791. "There's already a pickaxe stored
 *   here." 227/01757 tick 24520.
 *
 * Estimates (fits, and what they rest on):
 * - Beam damage 4-8 and orb damage 8-12 before the raid's factor. The Wiki gives none. Beam, about 30
 *   hits: at the +150% cap 10, 12, 15, 17, 20; at raid level 0 5, 6, 8. Orb, about 25 hits: at the
 *   cap 20, 22, 25, 27, 30; at level 0 9, 10; at level 150 14, 16, 17. Every path-levelled sample is
 *   at the cap, so the path level's share can't be seen.
 * - Breaking a wall: the pickaxe's roll interval less 1 tick (bronze 7, 3 of 4 samples; adamant 3,
 *   8 of 8; rune 2, 3 of 3), one less again a third of the time on fast pickaxes (dragon: 1 tick 11
 *   times, 2 ticks 24).
 * - How many extra walls are breakable: none 48, one 42, two 4, of 94 rises. No link to team size.
 * - Rock graphics: six tiles in four boxes, from two strikes read closely (223/00014 ticks 1742,
 *   1983). They do nothing.
 *
 * No capture for these, kept as they were: the full-inventory messages, "You already have a pickaxe."
 * and "You need a pickaxe...".
 */

const Shared = require("./Shared.TombsOfAmascut");
const Raid = require("./RaidState.TombsOfAmascut");
const Mining = require("../../skills/Mining.plugin");

// Cache locs: walls rise as the id above their settled form, which is what they become.
const BREAKABLE_RISING = 45463; // toa_het_barrier_destructable_internal_rising
const BREAKABLE_END_RISING = 45465;
const SOLID_RISING = 45459; // toa_het_barrier_internal_rising
const SOLID_END_RISING = 45461;
const MIRROR = 45455; // toa_het_mirror: can be picked up, turned and pushed
const MIRROR_FIXED = 45456;
const MIRROR_DIRTY = 45457;
const BROKEN_WALL = 45466;
const SEAL_DEAD = 45489; // toa_het_goal_dead
const CASTER_STATUE = 45486;
const SHIELD_STATUE = 45485;
const PICKAXE_STAND = 45468;
const LOBBY_PICKAXE_CAVITY = 49566; // the same storage, by the lobby's scoreboard
const WALL_SHAPE = 10;
const MIRROR_SHAPE = 11;
const MIRROR_ITEM = 27296;

/** A wall runs from x,y along dx,dy for `length` tiles: [x, y, dx, dy, length]. Mirrors: [x, y, rotation]. */
const LAYOUTS = [
  {
    breakable: [[3671, 5277, 1, 0, 5], [3685, 5284, 1, 0, 5]],
    others: [[3678, 5274, 0, 1, 5], [3674, 5282, 1, 0, 5], [3676, 5285, 1, 0, 5], [3680, 5275, 1, 0, 5], [3682, 5282, 0, 1, 5], [3682, 5278, 1, 0, 5]],
    mirrors: [
      [[3673, 5280, 1], [3675, 5273, 1], [3684, 5277, 2], [3687, 5281, 2]],
      [[3673, 5286, 1], [3674, 5273, 0], [3684, 5273, 3], [3685, 5285, 2]],
      [[3673, 5280, 0], [3679, 5272, 3], [3684, 5287, 2], [3688, 5276, 3]],
      [[3674, 5276, 0], [3685, 5286, 2], [3687, 5281, 2], [3687, 5283, 0]],
    ],
  },
  {
    breakable: [[3675, 5276, 1, 0, 5], [3679, 5282, 0, 1, 5], [3683, 5274, 1, 0, 5], [3686, 5278, 0, 1, 5]],
    others: [[3671, 5281, 1, 0, 5], [3682, 5275, 0, 1, 4], [3682, 5283, 1, 0, 5], [3675, 5283, 0, 1, 5], [3682, 5284, 0, 1, 5]],
    mirrors: [
      [[3674, 5280, 1], [3677, 5289, 1], [3680, 5277, 2], [3684, 5289, 2]],
      [[3675, 5273, 0], [3684, 5276, 1], [3688, 5276, 3], [3688, 5286, 2]],
      [[3673, 5277, 0], [3677, 5282, 1], [3683, 5272, 3], [3689, 5280, 3]],
      [[3677, 5289, 1], [3680, 5272, 1], [3680, 5277, 2], [3687, 5285, 2]],
    ],
  },
  {
    breakable: [[3680, 5282, 1, 0, 6], [3685, 5286, 1, 0, 4]],
    others: [[3674, 5281, 0, 1, 5], [3687, 5279, 0, 1, 5], [3681, 5284, 0, 1, 4], [3676, 5285, 1, 0, 5], [3683, 5284, 0, 1, 4], [3682, 5272, 0, 1, 4], [3678, 5278, 1, 0, 10]],
    mirrors: [
      [[3673, 5277, 0], [3686, 5279, 3], [3688, 5282, 1], [3689, 5284, 2]],
      [[3674, 5277, 0], [3675, 5288, 1], [3677, 5276, 0], [3689, 5285, 2]],
      [[3673, 5280, 1], [3676, 5275, 3], [3682, 5283, 1], [3682, 5289, 2]],
      [[3672, 5280, 1], [3675, 5276, 3], [3675, 5283, 1], [3689, 5277, 3]],
    ],
  },
];
/** The mirrors that can be picked up: the same in every layout. */
const LOOSE_MIRRORS = [[3675, 5271, 1], [3675, 5289, 3], [3689, 5285, 2]];
/** Of 94 rises, how many of a layout's other walls were breakable: 48 none, 42 one, 4 two. */
const EXTRA_BREAKABLE_ODDS = { ROLL: 94, NONE: 48, ONE: 90 };

// Every tile an orb was seen to start from, by the way it rolled.
const ORB_SPAWNS = {
  EAST: [[3670, 5277], [3670, 5278], [3670, 5279], [3670, 5280], [3670, 5281], [3670, 5282], [3670, 5283], [3671, 5274], [3671, 5275], [3671, 5276], [3671, 5284], [3671, 5285], [3671, 5286], [3672, 5272], [3672, 5273], [3672, 5287], [3672, 5288], [3674, 5271], [3674, 5289], [3677, 5270], [3677, 5290]],
  WEST: [[3683, 5270], [3683, 5272], [3686, 5271], [3686, 5289], [3688, 5272], [3688, 5273], [3688, 5288], [3689, 5274], [3689, 5275], [3689, 5276], [3689, 5284], [3689, 5285], [3689, 5286], [3690, 5277], [3690, 5278], [3690, 5279], [3690, 5280], [3690, 5281], [3690, 5282], [3690, 5283]],
  NORTH: [[3670, 5277], [3671, 5274], [3672, 5272], [3673, 5272], [3674, 5271], [3675, 5271], [3676, 5271], [3677, 5270], [3678, 5270], [3679, 5270], [3680, 5270], [3681, 5270], [3682, 5270], [3683, 5270], [3684, 5271], [3685, 5271], [3686, 5271], [3687, 5272], [3688, 5272], [3689, 5274], [3690, 5277]],
  SOUTH: [[3670, 5283], [3671, 5286], [3672, 5288], [3673, 5288], [3674, 5289], [3675, 5289], [3676, 5289], [3677, 5290], [3678, 5290], [3679, 5290], [3680, 5290], [3681, 5290], [3682, 5290], [3683, 5290], [3684, 5289], [3685, 5289], [3686, 5289], [3687, 5288], [3688, 5288], [3689, 5286], [3690, 5283]],
};
const ORB_TABLE = Object.entries(ORB_SPAWNS).flatMap(([direction, tiles]) => tiles.map(([x, y]) => ({ x, y, direction })));

const SEAL_TILE = { x: 3679, y: 5279, z: 0 };
const CASTER_TILE = { x: 3676, y: 5279, z: 0 };
const SHIELD_TILE = { x: 3682, y: 5279, z: 0 };
const BEAM_START = { x: 3676, y: 5280, z: 0 };
const SHIELD_HIT_TILE = { x: 3683, y: 5280, z: 0 };
const ROOM_CENTRE = { x: 3680, y: 5280, z: 0 };
// [minX, maxX, minY, maxY, how many]
const ROCK_BOXES = [[3674, 3679, 5275, 5278, 2], [3682, 3685, 5276, 5277, 2], [3676, 3681, 5285, 5286, 1], [3683, 3686, 5283, 5286, 1]];
const BARRIER_BASE = { x: 3669, y: 5279, z: 0 };

/** Wiki, Het's Seal: by team size. */
const SEAL_HITPOINTS = [119, 225, 321, 417, 512, 608, 704, 800];
const SEAL_POINTS = 2.5;
/**
 * Captured: 24 in every recording. The Wiki says 15, but also that a seal takes 8 swings a phase at
 * 3 ticks a swing, which only 24 allows (first hit +2, last +23).
 */
const WEAKENED_TICKS = 24;
const WALLS_RISE_TICKS = 2;
const BEAM_FIRST = 10;
const BEAM_INTERVAL = 9;
const BEAM_MAX_LENGTH = 200;
const ORB_FIRST_WARNING = 7;
const ORB_INTERVAL = 7;
const ORB_WARNING_TICKS = 4;
const ORBS_PER_WAVE = 2;
const BEAM_DAMAGE = [4, 8];
const ORB_DAMAGE = [8, 12];
const SEAL_GLOW_INTERVAL = 3;
const SEAL_FIRST_SWING = 2;
const SEAL_SWING_INTERVAL = 3;
const SEAL_BROKEN_DELAY = 2;
const PHASE_FAILED_DELAY = 2;
const MINING_XP_SEAL = 35;
const MINING_XP_WALL = 25;
const FAST_WALL_CHANCE = 1 / 3;
const MAX_DIRTY_MIRRORS = 4;
const SEAL_REACH = 4;

const DIRECTION = {
  NORTH: [0, 1], SOUTH: [0, -1], EAST: [1, 0], WEST: [-1, 0],
  NORTH_EAST: [1, 1], NORTH_WEST: [-1, 1], SOUTH_EAST: [1, -1], SOUTH_WEST: [-1, -1],
};
// A mirror's rotation is the diagonal it faces.
const MIRROR_FACING = ["NORTH_EAST", "SOUTH_EAST", "SOUTH_WEST", "NORTH_WEST"];
const BEAM_GRAPHIC = {
  horizontal: 2114, vertical: 2064, SOUTH_EAST: 2116, SOUTH_WEST: 2117, NORTH_WEST: 2118, NORTH_EAST: 2119, end: 2120,
};
const GRAPHIC = { ROCK: 60, SHIELD_HIT: 732, ORB_WARNING: 382, ORB_BURST: 379, SEAL_PROTECTED: 2122, SEAL_WEAKENED: 2123 };
const ROCK_GRAPHIC_DELAY = 15;
const BEAM_HEIGHT = 255;
const ANIMATION = { PICK_UP: 827, PUSH: 810, TAKE: 832 };
const SOUND = { BEAM: 6540, BEAM_MIRROR: 6538, BEAM_END: 6546, BEAM_SHIELD: 6536, ROCKS: 6542, STATUE: 2655, WALLS: 6535, END: 6539, MIRROR_TURN: 6543, PICK_UP: 2581, PUSH: 86, PLACE: 2739, WALL_BROKEN: 6547, SEAL_SWING: 3600, ORB_BORN: 6545, ORB_BURST: 179, TAKE: 2582 };
// How far the area sounds carry, from the captures.
const RADIUS = { BEAM: 30, BEAM_MIRROR: 3, BEAM_END: 5, BEAM_SHIELD: 15, ROOM: 15, ORB: 4 };

const ATTR_STORED_PICKAXE = "toa:stored-pickaxe";
const VARBIT_PICKAXE_STORED = 14440; // TOA_PICKAXE_STORED
const BRONZE_PICKAXE = 1265;
/** In the order of the statue's multiloc (value - 1). Rune = 6 and adamant = 5 are captured (223/00014, 227/01757). */
const STORABLE_PICKAXES = [
  1267, 1269, 12297, 1273, 1271, 1275, 23276, // iron, steel, black, mithril, adamant, rune, gilded
  11920, 12797, 23677, 13243, 13244, 20014, // dragon, dragon (or), zalcano's, infernal (and empty), 3rd age
  23680, 23682, 25112, 25063, 25369, 25376, // crystal (and inactive), Echo, the trailblazers
  30345, 30346, 30351, // the trailblazer reloaded pickaxes
];
/** Wiki: dragon or better hit the seal alike; rune next; everything below it the same. */
const SEAL_TIER_BONUS = { dragon: 2, crystal: 2, infernal: 2, rune: 0 };
const SEAL_TIER_BONUS_LOW = -3;
const SEAL_MINING_LEVELS = [[99, 17], [85, 15], [1, 8]];
const SEAL_DAMAGE_SPREAD = 2;

const hetSwings = new Map();
const wallSwings = new Map();

class HetPuzzleRoom extends Raid.Room {
  build() {
    const { NpcIdentifiers } = Shared.core();
    this.layout = new Map();
    this.orbs = new Set();
    this.miners = new Set();
    this.lastStep = new Map();
    this.previousTile = new Map();
    this.weakenedTicks = 0;
    this.risingTicks = 0;
    this.nextBeam = 0;
    this.nextOrbs = 0;
    this.nextGlow = 0;
    this.nextLayout = Shared.random(0, LAYOUTS.length - 1);
    this.weakenPending = false;
    this.clearPending = false;
    this.sealHealth = 0;
    this.seal = this.spawn(NpcIdentifiers.COL_00FFFF_HETS_SEAL_PROTECTED_COL, SEAL_TILE, { scale: false, points: SEAL_POINTS, inert: true });
    if (this.seal) {
      this.seal.__toaScripted = true;
      this.seal.__toaSeal = true;
      this.seal.getMovementQueue().setBlockMovement(true);
    }
    this.setObject(CASTER_STATUE, CASTER_TILE, WALL_SHAPE, 1);
    this.setObject(SHIELD_STATUE, SHIELD_TILE, WALL_SHAPE, 3);
  }

  onStart() {
    this.sealHealth = SEAL_HITPOINTS[Math.min(this.teamSize, SEAL_HITPOINTS.length) - 1];
    this.seal.setMaxHitpoints(this.sealHealth);
    this.seal.setHitpoints(this.sealHealth);
    this.nextOrbs = Shared.cycle() + ORB_FIRST_WARNING;
    this.nextGlow = Shared.cycle() + SEAL_GLOW_INTERVAL;
    this.raiseWalls();
    this.openBossHud(this.seal);
  }

  onPlayerArrive(player) {
    sendStoredPickaxe(player);
  }

  onComplete() {
    const { Animation } = Shared.core();
    this.clearLayout();
    this.takeMirrors(false);
    for (const player of this.roomPlayers()) {
      Shared.sound(player, SOUND.END);
      if (this.miners.has(player)) player.performAnimation(new Animation(-1));
    }
    this.miners.clear();
    for (let i = 0; i < 3; i++) this.setObject(-1, { x: BARRIER_BASE.x, y: BARRIER_BASE.y + i, z: 0 }, WALL_SHAPE);
    for (const orb of this.orbs) this.despawn(orb);
    this.orbs.clear();
    this.despawn(this.seal);
    this.setObject(SEAL_DEAD, SEAL_TILE, WALL_SHAPE, 0);
    this.raid.completeTask("Perfect Het");
  }

  onReset() {
    this.clearLayout();
    this.takeMirrors(false);
    for (const orb of this.orbs) this.despawn(orb);
    this.despawn(this.seal);
    this.build();
  }

  /** The room's shaking breaks whatever mirrors anyone is carrying. */
  takeMirrors(announce) {
    for (const player of this.roomPlayers()) {
      const inventory = player.getInventory();
      if (!inventory.contains(MIRROR_ITEM)) continue;
      inventory.delete(MIRROR_ITEM, 28);
      if (announce) player.sendMessage("The shaking breaks the mirrors you're holding.");
    }
  }

  // -------------------------------------------------------------- layout

  /** Walls and mirrors rise from the floor in the next layout; anyone in the way slides off. */
  raiseWalls() {
    this.risingTicks = WALLS_RISE_TICKS;
    this.nextBeam = Shared.cycle() + BEAM_FIRST;
    this.areaSound(SOUND.WALLS, ROOM_CENTRE, RADIUS.ROOM);
    const layout = LAYOUTS[this.nextLayout];
    this.nextLayout = (this.nextLayout + 1) % LAYOUTS.length;
    for (const wall of layout.breakable) this.placeWall(wall, true);
    const extra = new Set(Shared.shuffle(layout.others.map((_, index) => index)).slice(0, extraBreakableWalls()));
    layout.others.forEach((wall, index) => this.placeWall(wall, extra.has(index)));
    const fixed = Shared.randomOf(layout.mirrors);
    const dirtyCount = Math.min(MAX_DIRTY_MIRRORS, Math.max(0, this.teamSize - 2));
    const dirty = new Set(Shared.shuffle(fixed.map((_, index) => index)).slice(0, dirtyCount));
    fixed.forEach(([x, y, rotation], index) => this.placeLayout({ x, y, z: 0 }, dirty.has(index) ? MIRROR_DIRTY : MIRROR_FIXED, MIRROR_SHAPE, rotation));
    for (const [x, y, rotation] of LOOSE_MIRRORS) this.placeLayout({ x, y, z: 0 }, MIRROR, MIRROR_SHAPE, rotation);
    for (const player of this.challengePlayers()) {
      const location = player.getLocation();
      if (this.layout.has(key(location.getX(), location.getY()))) this.slideOff(player);
    }
  }

  /** A wall's ends face outwards; the tiles between are turned either way. */
  placeWall([x, y, dx, dy, length], breakable) {
    const [first, last] = dx !== 0 ? [2, 0] : [1, 3];
    for (let i = 0; i < length; i++) {
      const end = i === 0 || i === length - 1;
      const id = breakable ? (end ? BREAKABLE_END_RISING : BREAKABLE_RISING) : (end ? SOLID_END_RISING : SOLID_RISING);
      const rotation = i === 0 ? first : i === length - 1 ? last : (Shared.random(0, 1) === 0 ? first : last);
      this.placeLayout({ x: x + dx * i, y: y + dy * i, z: 0 }, id, WALL_SHAPE, rotation);
    }
  }

  placeLayout(tile, id, shape, rotation) {
    this.layout.set(key(tile.x, tile.y), { id, shape, rotation, x: tile.x, y: tile.y });
    this.setObject(id, tile, shape, rotation);
  }

  removeLayout(x, y) {
    const entry = this.layout.get(key(x, y));
    if (!entry) return null;
    this.layout.delete(key(x, y));
    this.setObject(-1, { x, y, z: 0 }, entry.shape);
    return entry;
  }

  clearLayout() {
    for (const entry of [...this.layout.values()]) this.removeLayout(entry.x, entry.y);
  }

  slideOff(player) {
    const location = player.getLocation();
    for (let radius = 1; radius <= 2; radius++) {
      for (let x = -radius; x <= radius; x++) {
        for (let y = -radius; y <= radius; y++) {
          if (Math.abs(x) !== radius && Math.abs(y) !== radius) continue;
          const tile = location.transform(x, y);
          if (!Shared.floorFree(this.area, tile) || this.layout.has(key(tile.getX(), tile.getY()))) continue;
          Shared.knockback(player, x, y, { ticks: 1, speed: 29 });
          return;
        }
      }
    }
  }

  // -------------------------------------------------------------- tick

  tick() {
    if (!this.isStarted()) return;
    const now = Shared.cycle();
    if (now >= this.nextGlow) {
      this.nextGlow = now + SEAL_GLOW_INTERVAL;
      this.seal.performGraphic(Shared.gfx(this.weakenedTicks > 0 ? GRAPHIC.SEAL_WEAKENED : GRAPHIC.SEAL_PROTECTED));
    }
    if (now >= this.nextOrbs) {
      this.nextOrbs = now + ORB_INTERVAL;
      for (let i = 0; i < ORBS_PER_WAVE; i++) this.warnOrb();
    }
    this.moveOrbs();
    if (this.clearPending) {
      this.clearPending = false;
      this.clearLayout();
      this.dropRocks();
    }
    if (this.weakenedTicks > 0 && --this.weakenedTicks <= 0) this.protectSeal();
    if (this.weakenPending) {
      this.weakenPending = false;
      this.weaken();
    }
    if (this.weakenedTicks <= 0 && !this.clearPending && now >= this.nextBeam) {
      this.nextBeam = now + BEAM_INTERVAL;
      this.fireBeam();
    }
    if (this.risingTicks > 0 && --this.risingTicks <= 0) {
      // Walls finish rising into their settled ids.
      for (const entry of this.layout.values()) {
        if (entry.shape !== WALL_SHAPE || entry.id === BROKEN_WALL) continue;
        entry.id -= 1;
        this.setObject(entry.id, { x: entry.x, y: entry.y, z: 0 }, entry.shape, entry.rotation);
      }
    }
  }

  dropRocks() {
    this.areaSound(SOUND.ROCKS, ROOM_CENTRE, RADIUS.ROOM);
    for (const [minX, maxX, minY, maxY, count] of ROCK_BOXES) {
      for (let i = 0; i < count; i++) {
        this.graphic(GRAPHIC.ROCK, { x: Shared.random(minX, maxX), y: Shared.random(minY, maxY) }, { delay: ROCK_GRAPHIC_DELAY });
      }
    }
  }

  /** An area sound, for whoever it reaches. */
  areaSound(id, tile, radius, delay = 0) {
    for (const player of this.roomPlayers()) {
      const location = player.getLocation();
      if (Math.max(Math.abs(location.getX() - tile.x), Math.abs(location.getY() - tile.y)) <= radius) Shared.sound(player, id, delay);
    }
  }

  /** Remembers each player's last step: a mirror they put down faces it. */
  onStep(player, _from, to) {
    const previous = this.previousTile.get(player);
    if (previous && (previous.x !== to.getX() || previous.y !== to.getY())) {
      this.lastStep.set(player, [Math.sign(to.getX() - previous.x), Math.sign(to.getY() - previous.y)]);
    }
    this.previousTile.set(player, { x: to.getX(), y: to.getY() });
  }

  /** The beam hit the shield statue: the seal can be mined until the walls come back. */
  weaken() {
    const { NpcIdentifiers } = Shared.core();
    this.weakenedTicks = WEAKENED_TICKS;
    for (const player of this.roomPlayers()) {
      player.sendMessage("<col=185820>The statue has been struck! The seal weakens!</col>");
      player.sendMessage("The room begins to shake violently!");
      Shared.sound(player, SOUND.STATUE);
    }
    this.graphic(GRAPHIC.SHIELD_HIT, SHIELD_HIT_TILE, { height: 254 });
    this.seal.setNpcTransformationId(NpcIdentifiers.COL_00FFFF_HETS_SEAL_WEAKENED_COL);
    this.takeMirrors(true);
    this.clearPending = true;
  }

  /** Time's up with the seal still standing: it goes back behind the next layout's walls. */
  protectSeal() {
    this.seal.setNpcTransformationId(-1);
    this.raiseWalls();
    this.later(PHASE_FAILED_DELAY, () => {
      if (this.isStarted()) this.raid.failTask("Perfect Het", "Het's seal wasn't destroyed in a single phase.");
    });
  }

  canDestroySeal() {
    return this.weakenedTicks > 0;
  }

  /** Traces the beam west from the caster statue, turning at mirrors. */
  fireBeam() {
    this.areaSound(SOUND.BEAM, BEAM_START, RADIUS.BEAM);
    let x = BEAM_START.x;
    let y = BEAM_START.y;
    let direction = "WEST";
    for (let i = 0; i < BEAM_MAX_LENGTH; i++) {
      const [lastX, lastY] = [x, y];
      x += DIRECTION[direction][0];
      y += DIRECTION[direction][1];
      const delay = 1 + i;
      const hitsShield = inside3x3(SHIELD_TILE, x, y);
      const stopped = hitsShield || inside3x3(CASTER_TILE, x, y) || inside3x3(SEAL_TILE, x, y);
      const blocker = stopped ? null : this.blockerAt(x, y);
      if (!stopped && !blocker) {
        this.beamHits(x, y);
        this.beamGraphic(x, y, direction, delay);
        continue;
      }
      if (blocker && (blocker.id === MIRROR || blocker.id === MIRROR_FIXED)) {
        const facing = MIRROR_FACING[blocker.rotation & 3];
        const turned = this.turn(facing, direction);
        if (turned) {
          this.beamHits(x, y);
          this.beamGraphic(x, y, facing, delay);
          this.areaSound(SOUND.BEAM_MIRROR, { x, y }, RADIUS.BEAM_MIRROR);
          direction = turned;
          continue;
        }
      }
      if (hitsShield) {
        this.weakenPending = true;
        this.areaSound(SOUND.BEAM_SHIELD, { x: lastX, y: lastY }, RADIUS.BEAM_SHIELD, 1);
      }
      this.beamGraphic(x, y, null, delay - 1);
      this.areaSound(SOUND.BEAM_END, { x, y }, RADIUS.BEAM_END);
      break;
    }
  }

  /** Whoever stands in the beam is hurt a tick later. */
  beamHits(x, y) {
    for (const player of this.challengePlayers()) {
      const location = player.getLocation();
      if (location.getX() !== x || location.getY() !== y) continue;
      this.later(1, () => {
        if (player.getHitpoints() <= 0) return;
        const amount = this.maxHit(Shared.random(BEAM_DAMAGE[0], BEAM_DAMAGE[1]));
        if (amount >= player.getHitpoints()) this.raid.tally(player, "moth");
        Shared.damage(player, amount);
        this.raid.failTask("Perfect Het", `${Shared.displayName(player)} was hit by a light beam.`);
      });
    }
  }

  /** A diagonal mirror passes the beam on along the side it didn't come in from. */
  turn(facing, travelling) {
    const [fx, fy] = DIRECTION[facing];
    const [tx, ty] = DIRECTION[travelling];
    const incoming = [-tx, -ty];
    if (incoming[0] === fx && incoming[1] === 0) return fy > 0 ? "NORTH" : "SOUTH";
    if (incoming[0] === 0 && incoming[1] === fy) return fx > 0 ? "EAST" : "WEST";
    return null;
  }

  /** Whatever stops or turns the beam on a tile: walls of this layout, or the map's own. */
  blockerAt(x, y) {
    const entry = this.layout.get(key(x, y));
    if (entry) return entry.id === BROKEN_WALL ? null : entry;
    const tile = { x, y, z: 0 };
    const object = this.objectAt(tile, WALL_SHAPE) ?? this.objectAt(tile, MIRROR_SHAPE);
    return object ? { id: object.getId(), rotation: object.getFace() } : null;
  }

  beamGraphic(x, y, direction, delay) {
    let id = BEAM_GRAPHIC.end;
    if (direction === "EAST" || direction === "WEST") id = BEAM_GRAPHIC.horizontal;
    else if (direction === "NORTH" || direction === "SOUTH") id = BEAM_GRAPHIC.vertical;
    else if (direction) id = BEAM_GRAPHIC[direction];
    this.graphic(id, { x, y }, { delay, height: BEAM_HEIGHT });
  }

  graphic(id, tile, options = {}) {
    const viewer = this.roomPlayers()[0];
    if (viewer) Shared.graphicAt(viewer, id, Shared.loc({ x: tile.x, y: tile.y, z: 0 }), options);
  }

  // -------------------------------------------------------------- orbs

  warnOrb() {
    const { x, y, direction } = Shared.randomOf(ORB_TABLE);
    this.graphic(GRAPHIC.ORB_WARNING, { x, y });
    this.later(ORB_WARNING_TICKS, () => {
      const { NpcIdentifiers } = Shared.core();
      if (!this.isStarted()) return;
      const orb = this.spawn(NpcIdentifiers.COL_00FFFF_ORB_OF_DARKNESS_COL, { x, y, z: 0 }, { scale: false, points: 0 });
      if (!orb) return;
      orb.__toaScripted = true;
      orb.__toaOrb = direction;
      orb.setUntargetable(true);
      this.graphic(GRAPHIC.ORB_BURST, { x, y });
      this.areaSound(SOUND.ORB_BORN, { x, y }, RADIUS.ORB);
      this.orbs.add(orb);
    });
  }

  /** Orbs roll one tile a tick until they hit something or someone. */
  moveOrbs() {
    for (const orb of [...this.orbs]) {
      const location = orb.getLocation();
      const [dx, dy] = DIRECTION[orb.__toaOrb];
      const next = location.transform(dx, dy);
      const victims = this.challengePlayers((player) => player.getLocation().equals(location));
      if (victims.length > 0) {
        for (const victim of victims) {
          Shared.damage(victim, this.maxHit(Shared.random(ORB_DAMAGE[0], ORB_DAMAGE[1])));
          this.raid.failTask("Perfect Het", `${Shared.displayName(victim)} was hit by an orb.`);
        }
        this.burstOrb(orb, next);
      } else if (!Shared.floorFree(this.area, next) || this.layoutBlocks(next.getX(), next.getY())) {
        this.burstOrb(orb, next);
      } else {
        Shared.walkStraight(orb, next);
      }
    }
  }

  layoutBlocks(x, y) {
    const entry = this.layout.get(key(x, y));
    return !!entry && entry.id !== BROKEN_WALL;
  }

  burstOrb(orb, next) {
    this.graphic(GRAPHIC.ORB_BURST, { x: orb.getLocation().getX(), y: orb.getLocation().getY() });
    this.areaSound(SOUND.ORB_BURST, { x: next.getX(), y: next.getY() }, RADIUS.ORB);
    this.orbs.delete(orb);
    this.despawn(orb);
  }

  // -------------------------------------------------------------- mirrors & walls

  useMirror(player, object, option) {
    const location = object.getLocation();
    const entry = this.layout.get(key(location.getX(), location.getY()));
    if (!entry) return;
    const { Animation } = Shared.core();
    if (entry.id === MIRROR_DIRTY) {
      player.sendMessage("You quickly brush away the dust coating the mirror.");
      entry.id = MIRROR_FIXED;
      this.setObject(MIRROR_FIXED, { x: entry.x, y: entry.y, z: 0 }, entry.shape, entry.rotation);
      Shared.sound(player, SOUND.PICK_UP);
      player.performAnimation(new Animation(ANIMATION.TAKE));
      return;
    }
    if (entry.id !== MIRROR) return;
    if (option === "Pick-up") {
      if (player.getInventory().getFreeSlots() < 1) {
        player.sendMessage("You don't have enough space in your inventory.");
        return;
      }
      this.removeLayout(entry.x, entry.y);
      Shared.sound(player, SOUND.PICK_UP);
      player.performAnimation(new Animation(ANIMATION.PICK_UP));
      player.getInventory().adds(MIRROR_ITEM, 1);
    } else if (option === "Rotate-clockwise" || option === "Rotate-anticlockwise") {
      entry.rotation = (entry.rotation + (option === "Rotate-clockwise" ? 1 : 3)) % 4;
      this.setObject(MIRROR, { x: entry.x, y: entry.y, z: 0 }, entry.shape, entry.rotation);
      Shared.sound(player, SOUND.MIRROR_TURN);
    } else if (option === "Push") {
      this.pushMirror(player, entry);
    }
  }

  pushMirror(player, entry) {
    const { Animation } = Shared.core();
    const { x, y } = entry;
    const target = { x: x + Math.sign(x - player.getLocation().getX()), y: y + Math.sign(y - player.getLocation().getY()), z: 0 };
    Shared.sound(player, SOUND.PUSH);
    player.performAnimation(new Animation(ANIMATION.PUSH));
    this.later(1, () => {
      const moving = this.layout.get(key(x, y));
      if (moving?.id !== MIRROR || this.layout.has(key(target.x, target.y)) || this.objectAt(target, WALL_SHAPE)) return;
      if (!Shared.floorFree(this.area, Shared.loc(target))) return;
      this.removeLayout(x, y);
      this.placeLayout(target, MIRROR, MIRROR_SHAPE, moving.rotation);
    });
  }

  /** Goes down on the player's own tile, facing their last step. */
  placeMirror(player, slot) {
    const location = player.getLocation();
    const tile = { x: location.getX(), y: location.getY(), z: 0 };
    if (!this.inChallenge(player) || this.layout.has(key(tile.x, tile.y)) || this.objectAt(tile, WALL_SHAPE)) {
      player.sendMessage("There isn't enough room to put that here.");
      return;
    }
    const { Animation } = Shared.core();
    Shared.sound(player, SOUND.PLACE);
    player.performAnimation(new Animation(ANIMATION.PICK_UP));
    const rotation = stepRotation(this.lastStep.get(player));
    this.later(1, () => {
      if (!player.getInventory().contains(MIRROR_ITEM) || this.layout.has(key(tile.x, tile.y))) return;
      player.getInventory().deleteAtSlot(slot, 1);
      this.placeLayout(tile, MIRROR, MIRROR_SHAPE, rotation);
    });
  }

  mineWall(player, object) {
    const pickaxe = Mining.findBestPickaxe(player);
    if (!pickaxe) {
      Shared.statement(player, "You need a pickaxe to do that. You do not have a pickaxe which you have the Mining level to use.");
      return;
    }
    const location = object.getLocation();
    player.performAnimation(wallSwing(pickaxe));
    player.sendMessage("You swing your pick at the barrier.");
    this.later(wallBreakTicks(pickaxe), () => {
      const entry = this.layout.get(key(location.getX(), location.getY()));
      if (!entry || (entry.id !== BREAKABLE_RISING - 1 && entry.id !== BREAKABLE_END_RISING - 1)) return;
      player.performAnimation(new (Shared.core().Animation)(-1));
      player.sendMessage("The barrier crumbles apart.");
      entry.id = BROKEN_WALL;
      entry.rotation = 0;
      this.setObject(BROKEN_WALL, { x: entry.x, y: entry.y, z: 0 }, entry.shape, 0);
      Shared.sound(player, SOUND.WALL_BROKEN);
      addMiningXp(player, MINING_XP_WALL);
    });
  }

  /** Mining the weakened seal; damage depends on the pickaxe and Mining level. */
  destroySeal(player) {
    if (!this.isStarted()) {
      player.sendMessage("You don't have to do that right now.");
      return;
    }
    if (!this.canDestroySeal()) {
      player.sendMessage("A strange force is protecting the seal from damage. It must be weakened somehow.");
      return;
    }
    const pickaxe = Mining.findBestPickaxe(player);
    if (!pickaxe) {
      Shared.statement(player, "You need a pickaxe to do that. You do not have a pickaxe which you have the Mining level to use.");
      return;
    }
    player.sendMessage("You swing your pick at the seal.");
    player.performAnimation(sealSwing(pickaxe));
    if (this.miners.has(player)) return;
    this.miners.add(player);
    const swing = () => {
      if (!this.miners.has(player) || !this.isStarted() || !this.canDestroySeal() || this.sealHealth <= 0
        || player.getLocation().getDistance(this.seal.getLocation()) > SEAL_REACH || player.getMovementQueue().size() > 0) {
        this.miners.delete(player);
        return false;
      }
      this.swingAtSeal(player, pickaxe);
      return true;
    };
    this.later(SEAL_FIRST_SWING, () => {
      if (swing()) this.repeat(SEAL_SWING_INTERVAL, swing);
    });
  }

  swingAtSeal(player, pickaxe) {
    player.performAnimation(sealSwing(pickaxe));
    Shared.sound(player, SOUND.SEAL_SWING);
    addMiningXp(player, MINING_XP_SEAL);
    const dealt = Math.min(sealDamage(player, pickaxe), this.sealHealth);
    this.sealHealth -= dealt;
    Shared.damage(this.seal, dealt);
    this.raid.member(player).damageDone += dealt;
    this.raid.addPoints(player, dealt * SEAL_POINTS);
    if (this.sealHealth <= 0) this.later(SEAL_BROKEN_DELAY, () => this.complete());
  }
}

function extraBreakableWalls() {
  const roll = Shared.random(1, EXTRA_BREAKABLE_ODDS.ROLL);
  return roll <= EXTRA_BREAKABLE_ODDS.NONE ? 0 : roll <= EXTRA_BREAKABLE_ODDS.ONE ? 1 : 2;
}

function key(x, y) {
  return `${x},${y}`;
}

function inside3x3(corner, x, y) {
  return x >= corner.x && x <= corner.x + 2 && y >= corner.y && y <= corner.y + 2;
}

/** North, east, south, west: 0-3. A diagonal step counts as its east or west part. */
function stepRotation(step) {
  if (!step) return 0;
  const [dx, dy] = step;
  if (dx > 0) return 1;
  if (dx < 0) return 3;
  return dy < 0 ? 2 : 0;
}

/** Wiki (Mod Ash): 8 / 15 / 17 by visible Mining, +2 or -3 by pickaxe, then +0-2. */
function sealDamage(player, pickaxe) {
  const { Skill } = Shared.core();
  const level = player.getSkillManager().getCurrentLevel(Skill.MINING);
  const [, base] = SEAL_MINING_LEVELS.find(([needed]) => level >= needed);
  return base + (SEAL_TIER_BONUS[pickaxe.key] ?? SEAL_TIER_BONUS_LOW) + Shared.random(0, SEAL_DAMAGE_SPREAD);
}

/** human_mining_het_<pickaxe>_pickaxe: the seal has swings of its own (223/00014 tick 1745). */
function sealSwing(pickaxe) {
  return namedSwing(hetSwings, `human_mining_het_${pickaxe.key}_pickaxe`, pickaxe);
}

/** human_mining_<pickaxe>_pickaxe_wall (223/00014 tick 1667). */
function wallSwing(pickaxe) {
  return namedSwing(wallSwings, `human_mining_${pickaxe.key}_pickaxe_wall`, pickaxe);
}

function namedSwing(cache, sequence, pickaxe) {
  if (!cache.has(sequence)) {
    const { Animation, CacheDefinitions } = Shared.core();
    const id = CacheDefinitions.getSeqId(sequence);
    cache.set(sequence, id == null ? pickaxe.animation : new Animation(id));
  }
  return cache.get(sequence);
}

function wallBreakTicks(pickaxe) {
  const fast = pickaxe.fastRollChance && Math.random() < FAST_WALL_CHANCE;
  return Math.max(1, pickaxe.attemptIntervalTicks - 1 - (fast ? 1 : 0));
}

function addMiningXp(player, amount) {
  const { Skill } = Shared.core();
  player.getSkillManager().addExperiences(Skill.MINING, amount);
}

function hetRoom(player) {
  const room = Raid.roomOf(player);
  return room instanceof HetPuzzleRoom && !room.destroyed ? room : null;
}

// ------------------------------------------------------------------ hooks

function useMirror(event) {
  const room = hetRoom(event.player);
  if (!room) return false;
  room.useMirror(event.player, event.object, event.option);
  return true;
}

function placeMirror(event) {
  const room = hetRoom(event.player);
  if (!room) return false;
  room.placeMirror(event.player, event.slot);
  return true;
}

function mineBarrier(event) {
  const room = hetRoom(event.player);
  if (!room || (event.objectId !== BREAKABLE_RISING - 1 && event.objectId !== BREAKABLE_END_RISING - 1)) return false;
  room.mineWall(event.player, event.object);
  return true;
}

function destroySeal({ player }) {
  const room = hetRoom(player);
  if (!room) return false;
  room.destroySeal(player);
  return true;
}

/** The seal can't be fought, only mined. */
function sealUnattackable(event) {
  if (event.target?.__toaSeal && event.attacker?.isPlayer?.()) event.allow = false;
}

/** The seal never dies by its hitpoints: swingAtSeal ends the room two ticks after the last swing. */
function sealDowned(event) {
  if (event.npc?.__toaSeal) event.preventDeath = true;
}

/**
 * The statues and the lobby's cavity (TOA_PICKAXE_STORED's multilocs) keep one pickaxe per player,
 * shown by varbit 14440: its value is the pickaxe's place in STORABLE_PICKAXES plus one, 0 for none,
 * which the statues draw as the free bronze one and the cavity as empty (Wiki; dump.loc).
 */
function usePickaxeStand(event) {
  const { player, option } = event;
  if (!canReachCavity(player)) return false;
  if (option === "Take-pickaxe") takeStoredPickaxe(player, event.objectId);
  else {
    const held = heldPickaxes(player);
    if (held.length === 0) player.sendMessage("You don't have anything to deposit.");
    else storePickaxe(player, held.reduce((best, next) => (storableIndex(next.id) > storableIndex(best.id) ? next : best)));
  }
  return true;
}

/** Use a pickaxe on the cavity to store that one. */
function pickaxeOnStand(event) {
  if (event.objectId !== PICKAXE_STAND && event.objectId !== LOBBY_PICKAXE_CAVITY) return;
  const { player } = event;
  if (!canReachCavity(player)) return;
  event.handled = true;
  const held = heldPickaxes(player).find((entry) => entry.id === event.itemId && entry.worn === false);
  if (!held) {
    player.sendMessage("Nothing interesting happens.");
    return;
  }
  storePickaxe(player, held);
}

/** Its cavities are in the Path of Het and the lobby. */
function canReachCavity(player) {
  return !!hetRoom(player) || !!Raid.raidOf(player) || Shared.inLobby(player.getLocation());
}

/** With nothing stored a statue still holds out a bronze pickaxe; the cavity has nothing to give. */
function takeStoredPickaxe(player, objectId) {
  const stored = player.getAttribute(ATTR_STORED_PICKAXE);
  const { Animation, ItemDefinition } = Shared.core();
  if (!stored && objectId === LOBBY_PICKAXE_CAVITY) return;
  const taken = stored || BRONZE_PICKAXE;
  if (heldPickaxes(player).length > 0) player.sendMessage("You already have a pickaxe.");
  else if (player.getInventory().getFreeSlots() < 1) player.sendMessage("You don't have any space in your inventory.");
  else {
    player.performAnimation(new Animation(ANIMATION.TAKE));
    Shared.sound(player, SOUND.TAKE);
    player.getInventory().adds(taken, 1);
    if (stored) setStoredPickaxe(player, null);
    player.sendMessage(`You take the ${ItemDefinition.forId(taken).getName()}.`);
  }
}

function storePickaxe(player, held) {
  const { Animation, ItemDefinition } = Shared.core();
  if (player.getAttribute(ATTR_STORED_PICKAXE)) {
    player.sendMessage("There's already a pickaxe stored here.");
    return;
  }
  if (storableIndex(held.id) < 0) {
    player.sendMessage("There's no point storing a bronze pickaxe here. Het will provide.");
    return;
  }
  player.performAnimation(new Animation(ANIMATION.TAKE));
  Shared.sound(player, SOUND.TAKE);
  if (held.worn) {
    const { Flag, WeaponInterfaceManager } = Shared.core();
    player.getEquipment().delete(held.id, 1);
    player.getEquipment().refreshItems();
    Shared.api().getBonusManager().update(player);
    WeaponInterfaceManager.assign(player);
    player.getUpdateFlag().flag(Flag.APPEARANCE);
  } else {
    player.getInventory().delete(held.id, 1);
  }
  setStoredPickaxe(player, held.id);
  player.sendMessage(`You place down the ${ItemDefinition.forId(held.id).getName()}.`);
}

/** Pickaxes in the inventory or wielded, bronze included (it's turned away, not ignored). */
function heldPickaxes(player) {
  const { Equipment } = Shared.core();
  const held = [];
  for (const item of player.getInventory().getValidItems()) {
    if (item.getId() === BRONZE_PICKAXE || storableIndex(item.getId()) >= 0) held.push({ id: item.getId(), worn: false });
  }
  const weapon = player.getEquipment().getItems()[Equipment.WEAPON_SLOT];
  const id = weapon?.getId?.() ?? -1;
  if (id === BRONZE_PICKAXE || storableIndex(id) >= 0) held.push({ id, worn: true });
  return held;
}

function storableIndex(id) {
  return STORABLE_PICKAXES.indexOf(id);
}

function setStoredPickaxe(player, id) {
  player.setAttribute(ATTR_STORED_PICKAXE, id);
  sendStoredPickaxe(player);
}

/** Shows the stored pickaxe in the cavities. */
function sendStoredPickaxe(player) {
  const stored = player.getAttribute(ATTR_STORED_PICKAXE);
  player.getPacketSender().sendVarbit(VARBIT_PICKAXE_STORED, stored ? storableIndex(stored) + 1 : 0);
}

function sendStoredPickaxeOnLogin({ player }) {
  if (player.getAttribute(ATTR_STORED_PICKAXE)) sendStoredPickaxe(player);
}

module.exports = function registerHetPuzzle(api) {
  Shared.bind(api);
  Raid.registerRoom("HET_PUZZLE", HetPuzzleRoom);
  Raid.registerRaidItems(MIRROR_ITEM);
  for (const clickType of [1, 2, 3, 4]) api.onObjectClick([MIRROR, MIRROR_DIRTY], clickType, useMirrorObject);
  api.onObjectClick([BREAKABLE_RISING - 1, BREAKABLE_END_RISING - 1], 1, mineBarrier);
  for (const clickType of [1, 2]) api.onObjectClick([PICKAXE_STAND, LOBBY_PICKAXE_CAVITY], clickType, usePickaxeStandObject);
  api.onItemAction("Mirror", { Place: placeMirror });
  api.onNpcInteraction("<col=00ffff>Het's Seal (weakened)</col>", { Destroy: destroySeal });
  api.onNpcInteraction("<col=00ffff>Het's Seal (protected)</col>", { Destroy: destroySeal });
  Raid.onRaidArea("canAttack", sealUnattackable);
  api.onNpcBeforeDeath(sealDowned);
  api.persistAttribute(ATTR_STORED_PICKAXE);
  api.onItemOnObject(pickaxeOnStand);
  api.onPlayerLogin(sendStoredPickaxeOnLogin);
};

function useMirrorObject(event) {
  return useMirror(withOption(event));
}

function usePickaxeStandObject(event) {
  return usePickaxeStand(withOption(event));
}

/** Id hooks don't name the option; read it off the object definition. */
function withOption(event) {
  event.option = event.definition?.getInteractions?.()?.[event.clickType - 1] ?? event.object?.getDefinition?.()?.getInteractions?.()?.[event.clickType - 1] ?? "";
  return event;
}
