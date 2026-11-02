"use strict";

/**
 * Path of Scabaras, Test of Isolation: four puzzles behind barriers (memory, obelisks, lights
 * out, addition), then the tile-matching puzzle that ends the room. Scarabs harass both paths.
 * Wiki: https://oldschool.runescape.wiki/w/Tombs_of_Amascut/Strategies#Path_of_Scabaras
 *
 * Tiles are template coordinates; captures were compared by the exit barrier's offset.
 * From captures (44 Scabaras rooms, revs 223-235; rev/rec/tick):
 * - Layout: the west pair is {memory, obelisks} and the east {lights, addition}, or the reverse,
 *   each pair in either order. All 44 rooms fit; all 8 arrangements occur.
 * - Numbering: "Puzzle N" goes NW 1, SW 2, NE 3, SE 4 (223/00014 tick 730 NW, 774 SE; 227/00101
 *   tick 11604 SW, 11633 NE). A solved puzzle opens the barrier on the OTHER path at the same x:
 *   NW (3549,5274), SW (3549,5286), NE (3564,5274), SE (3564,5286).
 * - Order: NE needs SW and SE needs NW solved, or "This device won't function yet." (223/00014
 *   tick 784, the NE plate with only NW and SE done). Only one diagonal plus puzzle 5 is needed.
 * - Barriers open by swapping 45335 for 29733 (invisible_type8_nonblocking).
 * - Memory: button 832 + synth 6559; a tile shows for one tick from the next tick, 5 tiles; a
 *   stepped plate shows a tick after the step for 2 ticks; a wrong one plays roofcollapse (302,
 *   delay 30) on the tile, synths 6557/6558/1678, and hits a tick later (223/00014 tick 708).
 * - Lights: a step flips the plate and both neighbours on the ring, shown a tick later (227/01757
 *   tick 23864). Start lights are random: 1-8 lit across 44 rooms.
 * - Addition: each tile walked over counts, running included (223/00014 tick 768). Plate lights
 *   per value are the fx in SUM_LIGHTS (tick 774).
 * - Obelisks: 5 unlit plus one always lit at offset (5,0) (44/44). The fifth correct strike ends it
 *   a tick later, with no sixth strike (227/01852 tick 26682-26683). The order survives a wrong
 *   strike. A strike leaves no attack delay: a bow strikes every tick (227/01852 tick 26655-26658).
 *   Each strike is synth 6561 at the obelisk.
 * - Rockfall: tile graphic 317 (delay 20) with synth 4459 (delay 155), 6575, 6556 (delay 180); the
 *   hit lands 6 ticks later (227/01845, 01852, 01759); never within 6 ticks of the last.
 * - Matching: faces 45356-45364 down, 45365-45373 up (the same index), and 45384-45395 fx per pair.
 *   A second pick on a side flips the first; a mismatch flips back a tick later, synth 6554;
 *   solo, pairs 1, 3, 5 and 7 start solved (23/23 solo rooms) and the statue stands at (3569,5279).
 *   In a party it's at (3568,5279), with 29733 at (3569,5279) (227/01852 tick 11052).
 * - Puzzle 5's message, then the exit opens, then "Challenge complete" a tick later (223/00014
 *   tick 855-856).
 * - Passage 45343 and Platform 45396: walk to the near landing tile; the crawl (2796, synth 2454)
 *   starts 2 ticks after arriving and moves 2 ticks later (223/00014 tick 735-739; 227/01757 tick
 *   23870-23874). The jump (741, synth 2461) starts a tick after arriving, moves 3 tiles, and
 *   again 2 ticks later (223/00014 tick 778-781).
 * - Scarabs: first wave and interval by party size: 1-2: 33/27; 3: 21/15; 5: 20/14; 6 and 8: 19/13.
 *   One spawns per path each wave, up to the party size alive on a path (1p 23 rooms, 2p 6, 3p 10,
 *   5p 1, 6p 3, 8p 1), in a 3x3 around (3534, 5274/5286) or (3551, 5274/5286). Attack every 4 ticks
 *   (227/01852 tick 26673-26681), projectile 1766 from 51 cycles, 8 tiles (223/00014 tick 722).
 * - Perfect Scabaras: "X was hit by a puzzle." on the hit (223/00014 tick 709); "The path wasn't
 *   completed fast enough." at the end, at exactly 100 ticks too (227/00553 tick 7718).
 * From the Wiki: scarab 12 hitpoints (scaled), max hit 6, speed 4, Ranged; flipping does 20; the sum
 * is 20-45; no rocks target a player on the stairs.
 * Estimates:
 * - A scarab uses its path's second chamber when no player is left west of the first barrier.
 *   42 of 43 spawns with a player seen there were in the first chamber; low-resolution players
 *   aren't visible to the recording, so the other way round can't be checked.
 * - Party size 4 and 7 scarab waves aren't captured: 4 uses 5's, 7 uses 6's.
 * - Wrong memory or addition: 4-6 x the raid damage factor (not the path's). Fit from 5 memory
 *   samples: 4 at Entry (223/00014), 10, 12, 12, 15 at raid levels 520-555. No wrong addition is
 *   captured; it uses the same numbers, sounds and graphic.
 * - Rock: 14-15 x the same factor. Fit from 4 samples, 35-37 at raid levels 520-530.
 * - About 8 rock tiles a fall plus each player's own (5-13 seen, most 9).
 * - The obelisk order has no idle timeout: no capture shows lit obelisks reverting without a wrong
 *   strike, and one (a 5-tick gap) carries on. One sample only.
 * Still only from Near-Reality:
 * - The Flip option's messages, 4-tick animation (9490, then 827) and synth 6560: nobody flips in a
 *   capture. The sum tablet's refusal text, the memory button's two messages.
 */

const Shared = require("./Shared.TombsOfAmascut");
const Raid = require("./RaidState.TombsOfAmascut");

const PUZZLE = { LIGHT: "LIGHT", SUM: "SUM", PILLAR: "PILLAR", MEMORY: "MEMORY" };
const WEST_EAST_PAIRS = [[PUZZLE.MEMORY, PUZZLE.PILLAR], [PUZZLE.LIGHT, PUZZLE.SUM]];

/** By the number in "Puzzle N has been completed!", less one. `opens` is on the other path. */
const CHAMBERS = [
  { base: { x: 3539, y: 5283 }, gateX: 3549, opens: { x: 3549, y: 5274 }, needs: -1 }, // NW
  { base: { x: 3539, y: 5271 }, gateX: 3549, opens: { x: 3549, y: 5286 }, needs: -1 }, // SW
  { base: { x: 3556, y: 5283 }, gateX: 3564, opens: { x: 3564, y: 5274 }, needs: 1 }, // NE
  { base: { x: 3556, y: 5271 }, gateX: 3564, opens: { x: 3564, y: 5286 }, needs: 0 }, // SE
];
const GATE_TILES = [{ x: 3549, y: 5286 }, { x: 3564, y: 5286 }, { x: 3549, y: 5274 }, { x: 3564, y: 5274 }];
const CHAMBER_FLOOR = { minDx: 1, maxDx: 5, minDy: 0, maxDy: 6 };
const STAIRS_OFFSET = 4; // Tiles west of a chamber's base that count as inside it.
const MATCH_BASE_TILES = [{ x: 3568, y: 5271 }, { x: 3568, y: 5283 }];
const EXIT_FIRE_BASE = { x: 3575, y: 5272 };
const EXIT_FIRE_LENGTH = 17;
const STATUE_TILE = { x: 3569, y: 5279 };

const MEMORY_OFFSETS = [[2, 4], [1, 3], [2, 2], [3, 5], [3, 3], [3, 1], [4, 4], [4, 2], [5, 3]];
const SUM_OFFSETS = [
  [[1, 1], [4, 4], [5, 4]], [[2, 2], [4, 2], [4, 5]], [[2, 5], [3, 3], [5, 1]],
  [[4, 1], [5, 2], [3, 4]], [[3, 1], [5, 3]], [[1, 2], [2, 3], [2, 4]],
  [[1, 4], [3, 2], [3, 5]], [[1, 3], [4, 3]], [[1, 5], [2, 1], [5, 5]],
];
const OBELISK_OFFSETS = [[1, 6], [3, 6], [5, 6], [1, 0], [3, 0], [5, 0]];
const LIGHT_OFFSETS = [[1, 1], [1, 3], [1, 5], [3, 5], [5, 5], [5, 3], [5, 1], [3, 1]];
const MATCH_OFFSETS = [[1, 1], [3, 1], [5, 1], [1, 3], [3, 3], [5, 3], [1, 5], [3, 5], [5, 5]];
const BUTTON_OFFSET = [-1, 5];

// Cache locs, by their Jagex names.
const FIRE = 45335; // toa_scabaras_barrier
const OPEN_BARRIER = 29733; // invisible_type8_nonblocking
const FLOOR_KIT = 45380; // floorkit_tomb_basic01
const PRESSURE_BUTTON = 45338; // toa_scabaras_simonsays_button
const SUM_TABLET = 45339; // toa_scabaras_totaltiles_tablet
const MEMORY_PLATE = 45340; // toa_scabaras_simonsays_tile_up
const MEMORY_YELLOW = 45341; // toa_scabaras_simonsays_tile_down
const MEMORY_RED = 45342; // toa_scabaras_simonsays_tile_down_player
const LIGHT_PLATE = 45344; // toa_scabaras_lightsout_tile_off
const LIGHT_ACTIVE = 45384; // toa_scabaras_fx01
const SUM_PLATE_BASE = 45345; // toa_scabaras_totaltiles_tile1..9, one per value 1..9
const MATCH_DOWN_BASE = 45356; // toa_scabaras_memorygame_button1..9
const MATCH_UP_BASE = 45365; // toa_scabaras_memorygame_tile1..9
const FX = { 3: 45386, 4: 45387, 5: 45388, 6: 45389, 7: 45390, 8: 45391, 9: 45392, 10: 45393, 11: 45394, 12: 45395 };
const SUM_LIGHTS = [FX[5], FX[6], FX[7], FX[8], FX[9], FX[10], FX[3], FX[11], FX[12]];
const MATCH_LIGHTS = [FX[5], FX[6], FX[3], FX[8], FX[9], FX[4], FX[10], FX[11], FX[12]];
const STATUE = 45205; // toa_scabaras_statue01_3x3
const TILE_LOCK = 43876; // invisible_type8_blocking_active
const FLOOR_SHAPE = 22;
const OBJECT_SHAPE = 10;
const BARRIER_FACE = 3;
const FX_FACE = 1;
const SUM_FACE = 1;
const MATCH_FACE = 1;

const ANIMATION = { FLIP: 9490, FLIP_DONE: 827, BUTTON: 832, SCARAB_SPAWN: 9589, SCARAB_ATTACK: 9587 };
const GRAPHIC = { SMALL_ROCKS: 302, ROCKFALL: 317 };
const SOUND = {
  FLIP: 6560, PRESSURE: 6561, PUZZLE_DONE: 2655, MEMORY_DONE: 6549, TILE: 6553, MATCH_FAIL: 6554,
  SUM_FAIL: 6558, MEMORY_FAIL: 6557, ROOF_COLLAPSE: 1678, BUTTON: 6559, TABLET: 6548,
  ROCK_RUMBLE: 6575, ROCK_FALL: 4459, ROCK_LAND: 6556,
};
const SMALL_ROCKS_DELAY = 30;
const ROCK_GRAPHIC_DELAY = 20;
const ROCK_FALL_SOUND_DELAY = 155;
const ROCK_LAND_SOUND_DELAY = 180;

const PASSAGE = 45343; // toa_scabaras_spawn_hole
const PASSAGE_SIDES = { north: { x: 3548, y: 5284 }, south: { x: 3548, y: 5276 } };
const PLATFORM = 45396; // toa_scabaras_stepping_stone
const PLATFORM_TILE = { x: 3560, y: 5280 };
const PLATFORM_SIDES = { north: { x: 3560, y: 5283 }, south: { x: 3560, y: 5277 } };
const MIDDLE_Y = 5280;
const SHORTCUT = {
  CRAWL: 2796, JUMP: 741, CRAWL_SOUND: 2454, JUMP_SOUND: 2461,
  CRAWL_WAIT: 2, CRAWL_TICKS: 2, JUMP_WAIT: 1, JUMP_GAP: 2,
  // ExactMove lengths in client cycles, 223/00014 tick 779 and 781.
  JUMP_ONTO: 45, JUMP_OFF: 28,
};

const SCARAB_PROJECTILE = 1766;
const SCARAB_MAX_HIT = 6;
const SCARAB_RANGE = 8;
const SCARAB_ATTACK_SPEED = 4;
const SCARAB_POINTS = 0.5;
const SCARAB_CENTRES = {
  first: { north: { x: 3534, y: 5286 }, south: { x: 3534, y: 5274 } },
  second: { north: { x: 3551, y: 5286 }, south: { x: 3551, y: 5274 } },
};
const FIRST_BARRIER_X = 3549;
/** [ticks to the first wave, ticks between waves] by party size. */
const SCARAB_WAVES = { 1: [33, 27], 2: [33, 27], 3: [21, 15], 4: [20, 14], 5: [20, 14], 6: [19, 13], 7: [19, 13], 8: [19, 13] };

const FLIP_DAMAGE = 20;
const FLIP_TICKS = 4;
const ROCK_TICKS = 6;
const ROCK_TILES = 8;
const ROCK_MIN_HIT = 14;
const ROCK_MAX_HIT = 15;
const WRONG_MIN_HIT = 4;
const WRONG_MAX_HIT = 6;
const SUM_MIN = 20;
const SUM_MAX = 45;
const SEQUENCE_LENGTH = 5;
const OBELISK_COUNT = 5;
const PLATE_SHOWN_TICKS = 2;
const SOLO_SOLVED_PAIRS = [0, 2, 4, 6];
const PERFECT_TICKS = 100;
const PERFECT_TASK = "Perfect Scabaras";

class ScabarasPuzzleRoom extends Raid.Room {
  build() {
    this.rotation = pickLayout();
    this.completed = [false, false, false, false];
    this.lights = new Array(LIGHT_OFFSETS.length).fill(false);
    this.scarabs = new Set();
    this.obelisks = [];
    this.matchNorth = Shared.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    this.matchSouth = Shared.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]);

    CHAMBERS.forEach((chamber) => {
      for (let dx = CHAMBER_FLOOR.minDx; dx <= CHAMBER_FLOOR.maxDx; dx++) {
        for (let dy = CHAMBER_FLOOR.minDy; dy <= CHAMBER_FLOOR.maxDy; dy++) {
          this.setObject(FLOOR_KIT, at(chamber.base, dx, dy), FLOOR_SHAPE, 0);
        }
      }
    });
    const light = this.base(PUZZLE.LIGHT);
    for (const [dx, dy] of LIGHT_OFFSETS) this.setObject(LIGHT_PLATE, at(light, dx, dy), FLOOR_SHAPE, 0);
    const sum = this.base(PUZZLE.SUM);
    SUM_OFFSETS.forEach((tiles, value) => {
      for (const [dx, dy] of tiles) this.setObject(SUM_PLATE_BASE + value, at(sum, dx, dy), FLOOR_SHAPE, SUM_FACE);
    });
    this.setObject(SUM_TABLET, at(sum, ...BUTTON_OFFSET), OBJECT_SHAPE, 0);
    const pillar = this.base(PUZZLE.PILLAR);
    const { NpcIdentifiers } = Shared.core();
    OBELISK_OFFSETS.forEach(([dx, dy], index) => {
      const tile = at(pillar, dx, dy);
      const id = index < OBELISK_COUNT ? NpcIdentifiers.COL_00FFFF_OBELISK_COL : NpcIdentifiers.COL_00FFFF_OBELISK_COL_2;
      const obelisk = this.spawn(id, tile, { scale: false, inert: true });
      if (!obelisk) return;
      obelisk.getMovementQueue().setBlockMovement(true);
      obelisk.__toaObelisk = index;
      this.setObject(TILE_LOCK, tile, OBJECT_SHAPE, 0);
      this.obelisks.push(obelisk);
    });
    const memory = this.base(PUZZLE.MEMORY);
    this.setObject(PRESSURE_BUTTON, at(memory, ...BUTTON_OFFSET), OBJECT_SHAPE, 0);
    for (const [dx, dy] of MEMORY_OFFSETS) this.setObject(MEMORY_PLATE, at(memory, dx, dy), FLOOR_SHAPE, 0);
    this.setObject(-1, STATUE_TILE, OBJECT_SHAPE);
    this.setObject(-1, at(STATUE_TILE, -1, 0), OBJECT_SHAPE);
    if (this.teamSize > 1) {
      this.setObject(OPEN_BARRIER, STATUE_TILE, OBJECT_SHAPE, BARRIER_FACE);
      this.setObject(STATUE, at(STATUE_TILE, -1, 0), OBJECT_SHAPE, BARRIER_FACE);
    } else {
      this.setObject(STATUE, STATUE_TILE, OBJECT_SHAPE, BARRIER_FACE);
    }
    this.resetPuzzles();
  }

  chamberOf(type) {
    return CHAMBERS[this.indexOf(type)];
  }

  base(type) {
    return this.chamberOf(type).base;
  }

  indexOf(type) {
    return this.rotation.indexOf(type);
  }

  hasCompleted(type) {
    return this.completed[this.indexOf(type)];
  }

  resetPuzzles() {
    this.completed.fill(false);
    for (const tile of GATE_TILES) this.setObject(FIRE, tile, OBJECT_SHAPE, BARRIER_FACE);
    for (let i = 0; i < EXIT_FIRE_LENGTH; i++) this.setObject(FIRE, at(EXIT_FIRE_BASE, 0, i), OBJECT_SHAPE, BARRIER_FACE);
    this.resetObelisks();
    this.obeliskOrder = Shared.shuffle([0, 1, 2, 3, 4]);
    const light = this.base(PUZZLE.LIGHT);
    this.lights.forEach((lit, index) => {
      if (lit) this.toggleLight(light, index);
    });
    for (let i = 0; i < LIGHT_OFFSETS.length; i++) {
      if (Shared.random(0, 1) === 0) this.toggleLight(light, i);
    }
    if (this.lights.every(Boolean)) this.toggleLight(light, Shared.random(0, LIGHT_OFFSETS.length - 1));
    this.rockfallAt = 0;
    this.sumGoal = Shared.random(SUM_MIN, SUM_MAX);
    this.sum = 0;
    this.setSumLights(false);
    const waves = SCARAB_WAVES[Math.min(8, Math.max(1, this.teamSize))];
    this.scarabInterval = waves[1];
    this.scarabTicks = waves[0];
    const memory = this.base(PUZZLE.MEMORY);
    for (const [dx, dy] of MEMORY_OFFSETS) this.setObject(-1, at(memory, dx, dy), OBJECT_SHAPE);
    this.northPick = -1;
    this.southPick = -1;
    this.matchPending = false;
    this.matched = new Set();
    MATCH_BASE_TILES.forEach((base, side) => {
      const order = side === 1 ? this.matchNorth : this.matchSouth;
      MATCH_OFFSETS.forEach(([dx, dy], index) => {
        this.setObject(MATCH_DOWN_BASE + order[index], at(base, dx, dy), FLOOR_SHAPE, MATCH_FACE);
        this.setObject(-1, at(base, dx, dy), OBJECT_SHAPE);
      });
    });
    if (this.teamSize < 2) {
      for (const key of SOLO_SOLVED_PAIRS) this.showMatched(key);
    }
    this.resetSequence();
  }

  onComplete() {
    this.killScarabs();
    for (let i = 0; i < EXIT_FIRE_LENGTH; i++) this.setObject(OPEN_BARRIER, at(EXIT_FIRE_BASE, 0, i), OBJECT_SHAPE, BARRIER_FACE);
    for (const tile of GATE_TILES) this.setObject(OPEN_BARRIER, tile, OBJECT_SHAPE, BARRIER_FACE);
    this.completed.fill(true);
    if (Shared.cycle() - this.startCycle < PERFECT_TICKS) this.raid.completeTask(PERFECT_TASK);
    else this.raid.failTask(PERFECT_TASK, "The path wasn't completed fast enough.");
  }

  onReset() {
    this.killScarabs();
    this.resetPuzzles();
  }

  killScarabs() {
    for (const scarab of this.scarabs) this.despawn(scarab);
    this.scarabs.clear();
  }

  pointsPerDamage(npc) {
    return npc.__toaScarab ? SCARAB_POINTS : 0;
  }

  complete(type) {
    if (type === undefined) {
      super.complete();
      return;
    }
    if (this.hasCompleted(type)) return;
    const index = this.indexOf(type);
    this.completed[index] = true;
    this.setObject(OPEN_BARRIER, CHAMBERS[index].opens, OBJECT_SHAPE, BARRIER_FACE);
    for (const player of this.challengePlayers()) {
      player.sendMessage(`<col=229628>Puzzle ${index + 1} has been completed!`);
      Shared.sound(player, SOUND.PUZZLE_DONE);
    }
  }

  /** The east puzzles only work once a west puzzle on the other path is done. */
  canUse(player, type, refusal) {
    if (!this.isStarted()) return false;
    const { needs } = this.chamberOf(type);
    if (needs !== -1 && !this.completed[needs]) {
      player.sendMessage(refusal ?? "This device won't function yet.");
      return false;
    }
    return true;
  }

  /** Damage from the room itself: Perfect Scabaras is gone on the first of it. */
  puzzleHit(player, amount) {
    if (amount <= 0) return;
    Shared.damage(player, amount);
    this.raid.failTask(PERFECT_TASK, `${Shared.displayName(player)} was hit by a puzzle.`);
  }

  tick() {
    if (!this.isStarted()) return;
    for (const scarab of this.scarabs) {
      if (scarab.getHitpoints() <= 0 || !scarab.isRegistered?.()) this.scarabs.delete(scarab);
    }
    if (--this.scarabTicks <= 0) {
      this.scarabTicks = this.scarabInterval;
      this.spawnScarab("north");
      this.spawnScarab("south");
    }
    if (!this.hasCompleted(PUZZLE.MEMORY) && this.sequenceShown !== -1 && this.sequence) {
      const memory = this.base(PUZZLE.MEMORY);
      const [dx, dy] = MEMORY_OFFSETS[this.sequence[this.sequenceShown]];
      const tile = at(memory, dx, dy);
      this.setObject(MEMORY_YELLOW, tile, OBJECT_SHAPE, 0);
      this.later(1, () => !this.hasCompleted(PUZZLE.MEMORY) && this.setObject(-1, tile, OBJECT_SHAPE));
      for (const player of this.puzzlePlayers(this.indexOf(PUZZLE.MEMORY))) Shared.sound(player, SOUND.PRESSURE);
      if (++this.sequenceShown >= SEQUENCE_LENGTH) this.sequenceShown = -1;
    }
  }

  /** One a wave on each path, up to the party's size alive there. */
  spawnScarab(side) {
    const alive = [...this.scarabs].filter((scarab) => scarab.__toaSide === side).length;
    if (alive >= Math.max(1, this.teamSize)) return;
    const { NpcIdentifiers, Animation } = Shared.core();
    const someoneBehind = this.challengePlayers((player) => sideOf(player) === side && player.getLocation().getX() < FIRST_BARRIER_X).length > 0;
    const centre = SCARAB_CENTRES[someoneBehind ? "first" : "second"][side];
    const tile = { x: centre.x + Shared.random(-1, 1), y: centre.y + Shared.random(-1, 1) };
    const scarab = this.spawn(NpcIdentifiers.SCARAB, tile, { pathLevel: 0, points: SCARAB_POINTS });
    if (!scarab) return;
    scarab.__toaScarab = true;
    scarab.__toaSide = side;
    scarab.performAnimation(new Animation(ANIMATION.SCARAB_SPAWN));
    this.scarabs.add(scarab);
    const target = this.nearestPlayer(scarab);
    if (target) scarab.getCombat().attack(target);
  }

  nearestPlayer(npc) {
    let best = null;
    let distance = Infinity;
    for (const player of this.challengePlayers()) {
      const d = player.getLocation().getDistance(npc.getLocation());
      if (d < distance) {
        best = player;
        distance = d;
      }
    }
    return best;
  }

  // -------------------------------------------------------------- lights out

  toggleLight(base, index) {
    this.lights[index] = !this.lights[index];
    const [dx, dy] = LIGHT_OFFSETS[index];
    this.setObject(this.lights[index] ? LIGHT_ACTIVE : -1, at(base, dx, dy), OBJECT_SHAPE, FX_FACE);
  }

  /** Stepping on a plate flips it and its neighbours; flipping by hand flips only it. */
  stepLight(player, tile, flipOnly) {
    if (this.hasCompleted(PUZZLE.LIGHT)) return false;
    const base = this.base(PUZZLE.LIGHT);
    const index = LIGHT_OFFSETS.findIndex(([dx, dy]) => base.x + dx === tile.getX() && base.y + dy === tile.getY());
    if (index === -1) return false;
    if (!this.canUse(player, PUZZLE.LIGHT)) return true;
    Shared.sound(player, SOUND.PRESSURE);
    this.toggleLight(base, index);
    if (!flipOnly) {
      this.toggleLight(base, (index + this.lights.length - 1) % this.lights.length);
      this.toggleLight(base, (index + 1) % this.lights.length);
    }
    if (this.lights.every(Boolean)) this.complete(PUZZLE.LIGHT);
    return true;
  }

  flipTablet(player, tile) {
    const { Animation } = Shared.core();
    player.sendMessage("You attempt to get a grip of the tile in order to flip it.");
    player.performAnimation(new Animation(ANIMATION.FLIP));
    Shared.sound(player, SOUND.FLIP);
    player.getMovementQueue().setBlockMovement(true);
    this.later(FLIP_TICKS, () => {
      player.getMovementQueue().setBlockMovement(false);
      if (player.getHitpoints() <= 0 || !this.inChallenge(player)) return;
      if (this.stepLight(player, tile, true)) {
        player.sendMessage("You manage to flip the tile over.");
        this.puzzleHit(player, FLIP_DAMAGE);
        player.performAnimation(new Animation(ANIMATION.FLIP_DONE));
      } else {
        player.sendMessage("You fail to flip the tile over.");
      }
    });
  }

  // -------------------------------------------------------------- addition

  setSumLights(on) {
    const base = this.base(PUZZLE.SUM);
    SUM_OFFSETS.forEach((tiles, value) => {
      for (const [dx, dy] of tiles) this.setObject(on ? SUM_LIGHTS[value] : -1, at(base, dx, dy), OBJECT_SHAPE, FX_FACE);
    });
  }

  stepSum(player, tile) {
    if (this.hasCompleted(PUZZLE.SUM)) return false;
    const base = this.base(PUZZLE.SUM);
    for (let value = 0; value < SUM_OFFSETS.length; value++) {
      for (const [dx, dy] of SUM_OFFSETS[value]) {
        if (base.x + dx !== tile.getX() || base.y + dy !== tile.getY()) continue;
        if (!this.canUse(player, PUZZLE.SUM)) return true;
        this.sum += value + 1;
        if (this.sum === this.sumGoal) {
          Shared.sound(player, SOUND.PRESSURE);
          this.complete(PUZZLE.SUM);
          this.setSumLights(true);
        } else if (this.sum > this.sumGoal) {
          this.setSumLights(false);
          this.smallRockfall(player);
          this.sum = 0;
        } else {
          this.setObject(SUM_LIGHTS[value], at(base, dx, dy), OBJECT_SHAPE, FX_FACE);
          Shared.sound(player, SOUND.PRESSURE);
        }
        return true;
      }
    }
    return false;
  }

  readTablet(player) {
    if (!this.canUse(player, PUZZLE.SUM, "You can't seem to make out the writing. Weird.")) return;
    player.sendMessage(`The number <col=ff3045>${this.sumGoal}</col> has been hastily chipped into the stone.`);
    Shared.sound(player, SOUND.TABLET);
  }

  // -------------------------------------------------------------- obelisks

  resetObelisks() {
    const { NpcIdentifiers } = Shared.core();
    this.obeliskIndex = 0;
    for (const obelisk of this.obelisks) {
      if (obelisk.__toaObelisk < OBELISK_COUNT) obelisk.setNpcTransformationId(NpcIdentifiers.COL_00FFFF_OBELISK_COL);
    }
  }

  /** Each correct obelisk lights up, and the fifth ends it; a wrong one resets and brings the roof down. */
  hitObelisk(player, obelisk) {
    const { NpcIdentifiers } = Shared.core();
    for (const viewer of this.puzzlePlayers(this.indexOf(PUZZLE.PILLAR))) Shared.sound(viewer, SOUND.PRESSURE);
    if (this.obeliskIndex >= OBELISK_COUNT) return;
    if (obelisk.__toaObelisk === this.obeliskOrder[this.obeliskIndex]) {
      this.obeliskIndex++;
      obelisk.setNpcTransformationId(NpcIdentifiers.COL_00FFFF_OBELISK_COL_2);
      if (this.obeliskIndex === OBELISK_COUNT) this.later(1, () => this.complete(PUZZLE.PILLAR));
      return;
    }
    this.resetObelisks();
    if (this.rockfallAt > Shared.cycle()) return;
    this.rockfallAt = Shared.cycle() + ROCK_TICKS;
    this.pillarRockfall();
  }

  pillarRockfall() {
    const index = this.indexOf(PUZZLE.PILLAR);
    const { base, gateX } = CHAMBERS[index];
    const { RegionManager } = Shared.core();
    const candidates = [];
    for (let x = base.x - STAIRS_OFFSET; x < gateX; x++) {
      for (let y = base.y; y <= base.y + 6; y++) {
        if (RegionManager.getClipping?.(x, y, 0, this.area) === 0) candidates.push({ x, y });
      }
    }
    const tiles = Shared.shuffle(candidates).slice(0, ROCK_TILES);
    const players = this.puzzlePlayers(index);
    for (const player of players) {
      if (!tiles.some((tile) => tile.x === player.getLocation().getX() && tile.y === player.getLocation().getY())) {
        tiles.push({ x: player.getLocation().getX(), y: player.getLocation().getY() });
      }
      Shared.sound(player, SOUND.ROCK_RUMBLE);
      Shared.sound(player, SOUND.ROCK_FALL, ROCK_FALL_SOUND_DELAY);
      Shared.sound(player, SOUND.ROCK_LAND, ROCK_LAND_SOUND_DELAY);
    }
    for (const tile of tiles) {
      for (const viewer of players) Shared.graphicAt(viewer, GRAPHIC.ROCKFALL, Shared.loc(tile, 0), { delay: ROCK_GRAPHIC_DELAY });
    }
    this.later(ROCK_TICKS, () => {
      for (const player of this.challengePlayers()) {
        if (tiles.some((tile) => tile.x === player.getLocation().getX() && tile.y === player.getLocation().getY())) {
          this.puzzleHit(player, Math.floor(Shared.random(ROCK_MIN_HIT, ROCK_MAX_HIT) * this.raid.damageFactor(0)));
        }
      }
    });
  }

  // -------------------------------------------------------------- memory

  pressButton(player) {
    if (!this.canUse(player, PUZZLE.MEMORY)) return;
    if (this.hasCompleted(PUZZLE.MEMORY)) {
      player.sendMessage("You have already completed this puzzle.");
      return;
    }
    if (this.sequenceShown !== -1) {
      player.sendMessage("You must wait until the sequence has finished before you can request another.");
      return;
    }
    const { Animation } = Shared.core();
    this.resetSequence();
    player.performAnimation(new Animation(ANIMATION.BUTTON));
    Shared.sound(player, SOUND.BUTTON);
    this.sequence = Shared.shuffle(MEMORY_OFFSETS.map((_, index) => index)).slice(0, SEQUENCE_LENGTH);
    this.sequenceShown = 0;
  }

  resetSequence() {
    this.sequence = null;
    this.sequenceStep = 0;
    this.sequenceShown = -1;
  }

  stepMemory(player, tile) {
    if (this.hasCompleted(PUZZLE.MEMORY) || !this.sequence) return false;
    if (!this.canUse(player, PUZZLE.MEMORY)) return false;
    const base = this.base(PUZZLE.MEMORY);
    const index = MEMORY_OFFSETS.findIndex(([dx, dy]) => base.x + dx === tile.getX() && base.y + dy === tile.getY());
    if (index === -1) return false;
    const plate = at(base, ...MEMORY_OFFSETS[index]);
    this.setObject(MEMORY_RED, plate, OBJECT_SHAPE, 0);
    this.later(PLATE_SHOWN_TICKS, () => !this.hasCompleted(PUZZLE.MEMORY) && this.setObject(-1, plate, OBJECT_SHAPE));
    if (this.sequence[this.sequenceStep] === index) {
      if (++this.sequenceStep === SEQUENCE_LENGTH) {
        this.complete(PUZZLE.MEMORY);
        for (const [dx, dy] of MEMORY_OFFSETS) this.setObject(MEMORY_YELLOW, at(base, dx, dy), OBJECT_SHAPE, 0);
        for (const viewer of this.puzzlePlayers(this.indexOf(PUZZLE.MEMORY))) Shared.sound(viewer, SOUND.MEMORY_DONE);
      }
    } else {
      Shared.sound(player, SOUND.MEMORY_FAIL);
      this.smallRockfall(player);
      this.resetSequence();
    }
    return true;
  }

  /** The hit lands the tick after the rocks start to fall. */
  smallRockfall(player) {
    Shared.sound(player, SOUND.SUM_FAIL);
    Shared.sound(player, SOUND.ROOF_COLLAPSE);
    Shared.graphicAt(player, GRAPHIC.SMALL_ROCKS, player.getLocation(), { delay: SMALL_ROCKS_DELAY });
    this.later(1, () => {
      if (player.getHitpoints() <= 0 || !this.inChallenge(player)) return;
      this.puzzleHit(player, Math.floor(Shared.random(WRONG_MIN_HIT, WRONG_MAX_HIT) * this.raid.damageFactor(0)));
    });
  }

  // -------------------------------------------------------------- matching

  turnMatchTile(player, location) {
    for (let side = 0; side < MATCH_BASE_TILES.length; side++) {
      const base = MATCH_BASE_TILES[side];
      const index = MATCH_OFFSETS.findIndex(([dx, dy]) => base.x + dx === location.getX() && base.y + dy === location.getY());
      if (index !== -1) {
        this.pickMatch(side === 1, index, player);
        return;
      }
    }
  }

  matchTile(north, key) {
    const order = north ? this.matchNorth : this.matchSouth;
    return at(MATCH_BASE_TILES[north ? 1 : 0], ...MATCH_OFFSETS[order.indexOf(key)]);
  }

  showFace(north, key, up) {
    this.setObject((up ? MATCH_UP_BASE : MATCH_DOWN_BASE) + key, this.matchTile(north, key), FLOOR_SHAPE, MATCH_FACE);
  }

  showMatched(key) {
    this.matched.add(key);
    for (const north of [true, false]) {
      this.showFace(north, key, true);
      this.setObject(MATCH_LIGHTS[key], this.matchTile(north, key), OBJECT_SHAPE, FX_FACE);
    }
  }

  /** Turns a tile on one side; once both sides have one up, they stay lit if they match. */
  pickMatch(north, index, player) {
    if (!this.isStarted()) return;
    const key = (north ? this.matchNorth : this.matchSouth)[index];
    if (this.matched.has(key)) return;
    if (this.matchPending) {
      this.later(1, () => this.pickMatch(north, index, player));
      return;
    }
    const previous = north ? this.northPick : this.southPick;
    if (previous === key) return;
    this.showFace(north, key, true);
    if (previous !== -1) this.showFace(north, previous, false);
    if (north) this.northPick = key;
    else this.southPick = key;
    Shared.sound(player, SOUND.TILE);
    if (this.northPick === -1 || this.southPick === -1) return;
    this.matchPending = true;
    this.later(1, () => this.resolveMatch(player));
  }

  resolveMatch(player) {
    const northKey = this.northPick;
    const southKey = this.southPick;
    this.northPick = -1;
    this.southPick = -1;
    this.matchPending = false;
    if (northKey === southKey) {
      this.showMatched(northKey);
      Shared.sound(player, SOUND.PRESSURE);
      if (this.matched.size >= MATCH_OFFSETS.length) this.finishMatching();
      return;
    }
    Shared.sound(player, SOUND.MATCH_FAIL);
    this.showFace(true, northKey, false);
    this.showFace(false, southKey, false);
  }

  /** The message and the open exit come a tick before the challenge completes. */
  finishMatching() {
    for (const member of this.challengePlayers()) {
      member.sendMessage("<col=229628>Puzzle 5 has been completed!");
      Shared.sound(member, SOUND.PUZZLE_DONE);
    }
    for (let i = 0; i < EXIT_FIRE_LENGTH; i++) this.setObject(OPEN_BARRIER, at(EXIT_FIRE_BASE, 0, i), OBJECT_SHAPE, BARRIER_FACE);
    this.later(1, () => this.complete());
  }

  // -------------------------------------------------------------- movement

  onStep(player, _from, to) {
    if (!this.isStarted() || !this.inChallenge(player)) return;
    if (this.stepSum(player, to)) return;
    if (this.stepLight(player, to, false)) return;
    this.stepMemory(player, to);
  }

  /** Players standing in one puzzle's chamber, the stairs below it excepted. */
  puzzlePlayers(index) {
    const { base, gateX } = CHAMBERS[index];
    return this.challengePlayers((player) => {
      const location = player.getLocation();
      return location.getX() >= base.x - STAIRS_OFFSET && location.getX() < gateX
        && location.getY() >= base.y && location.getY() <= base.y + 6;
    });
  }
}

function at(base, dx, dy) {
  return { x: base.x + dx, y: base.y + dy, z: 0 };
}

/** NW, SW, NE, SE: one pair west and the other east, each in either order. */
function pickLayout() {
  const pairs = Shared.shuffle(WEST_EAST_PAIRS);
  return [...Shared.shuffle(pairs[0]), ...Shared.shuffle(pairs[1])];
}

function scabarasRoom(player) {
  const room = Raid.roomOf(player);
  return room instanceof ScabarasPuzzleRoom && !room.destroyed ? room : null;
}

// ------------------------------------------------------------------ hooks

function flipLightPlate(event) {
  const room = scabarasRoom(event.player);
  if (!room || event.objectId !== LIGHT_PLATE || event.option !== "Flip") return false;
  room.flipTablet(event.player, event.object.getLocation());
  return true;
}

function readSumTablet(event) {
  const room = scabarasRoom(event.player);
  if (!room) return false;
  room.readTablet(event.player);
  return true;
}

function pressAncientButton(event) {
  const room = scabarasRoom(event.player);
  if (!room) return false;
  room.pressButton(event.player);
  return true;
}

function turnTile(event) {
  const room = scabarasRoom(event.player);
  if (!room) return false;
  room.turnMatchTile(event.player, event.object.getLocation());
  return true;
}

/** Hitting an obelisk does no damage; it just counts as touching it. */
function hitObelisk(event) {
  const npc = event.npc;
  if (npc?.__toaObelisk === undefined) return;
  const room = npc.__toaRoom;
  for (const hit of event.hit.getHits()) hit.setDamage(0);
  event.hit.updateTotalDamage();
  const player = event.hit.getAttacker?.();
  if (!player?.isPlayer?.() || !(room instanceof ScabarasPuzzleRoom)) return;
  player.getCombat().reset();
  if (room.canUse(player, PUZZLE.PILLAR) && npc.__toaObelisk < OBELISK_COUNT) room.hitObelisk(player, npc);
}

function canHitObelisk(event) {
  const npc = event.target;
  if (npc?.__toaObelisk === undefined) return;
  const room = npc.__toaRoom;
  if (!(room instanceof ScabarasPuzzleRoom) || npc.__toaObelisk >= OBELISK_COUNT) {
    event.allow = false;
    return;
  }
  if (event.attacker?.isPlayer?.() && !room.canUse(event.attacker, PUZZLE.PILLAR)) event.allow = false;
  if (!event.attacker?.isPlayer?.()) event.allow = false;
}

/** Striking an obelisk costs no attack delay: a bow strikes a tick apart (227/01852 tick 26655-26658). */
function struckObelisk(event) {
  const { player, target } = event;
  if (target?.__toaObelisk === undefined || !(target.__toaRoom instanceof ScabarasPuzzleRoom)) return;
  Shared.skipAttackDelay(player, target);
}

/** Counts a puzzle scarab for the title. */
function scarabKilled(event) {
  const { npc } = event;
  const room = npc?.__toaRoom;
  if (!npc?.__toaScarab || !(room instanceof ScabarasPuzzleRoom)) return;
  const killer = npc.getCombat().getKiller?.(false);
  if (killer) room.raid.tally(killer, "scarabsKilled");
}

// ------------------------------------------------------------------ shortcuts

/** The side of the room the player is on, and so the side the shortcut takes them from. */
function sideOf(player) {
  return player.getLocation().getY() < MIDDLE_Y ? "south" : "north";
}

/** Both shortcuts are used from the near side's landing tile; neither tile is reachable as a loc. */
function routeToShortcut(event) {
  if (event.objectId !== PASSAGE && event.objectId !== PLATFORM) return;
  if (!scabarasRoom(event.player)) return;
  const sides = event.objectId === PASSAGE ? PASSAGE_SIDES : PLATFORM_SIDES;
  event.destination = { ...sides[sideOf(event.player)], z: 0 };
}

function crawlPassage(event) {
  const { player } = event;
  if (event.objectId !== PASSAGE || !scabarasRoom(player)) return false;
  const { Animation } = Shared.core();
  const to = PASSAGE_SIDES[sideOf(player) === "south" ? "north" : "south"];
  player.getMovementQueue().reset();
  Shared.later(player, SHORTCUT.CRAWL_WAIT, () => {
    if (!scabarasRoom(player)) return;
    player.performAnimation(new Animation(SHORTCUT.CRAWL));
    Shared.sound(player, SHORTCUT.CRAWL_SOUND);
    Shared.later(player, SHORTCUT.CRAWL_TICKS, () => {
      if (!scabarasRoom(player)) return;
      player.performAnimation(new Animation(-1));
      player.moveTo(Shared.loc(to, 0));
    });
  });
  return true;
}

/** Jumps onto the platform, then on to the far side. */
function jumpPlatform(event) {
  const { player } = event;
  if (event.objectId !== PLATFORM || !scabarasRoom(player)) return false;
  const north = sideOf(player) === "south";
  const to = PLATFORM_SIDES[north ? "north" : "south"];
  const direction = north ? 0 : 2;
  const jump = (target, speed) => {
    const location = player.getLocation();
    Shared.sound(player, SHORTCUT.JUMP_SOUND);
    Shared.knockback(player, target.x - location.getX(), target.y - location.getY(),
      { ticks: 1, speed, direction, animation: SHORTCUT.JUMP });
  };
  player.getMovementQueue().reset();
  Shared.later(player, SHORTCUT.JUMP_WAIT, () => {
    if (!scabarasRoom(player)) return;
    jump(PLATFORM_TILE, SHORTCUT.JUMP_ONTO);
    Shared.later(player, SHORTCUT.JUMP_GAP, () => scabarasRoom(player) && jump(to, SHORTCUT.JUMP_OFF));
  });
  return true;
}

/**
 * "Hit" is an attack: walk only into the weapon's reach (with line of sight) before striking,
 * as for Attack, rather than up to the obelisk. Melee still walks to it.
 */
function routeToObelisk(event) {
  if (event.npc?.__toaObelisk === undefined || !scabarasRoom(event.player)) return;
  const { CombatFactory } = Shared.core();
  event.range = Math.max(1, CombatFactory.getMethod(event.player)?.attackDistance?.(event.player) ?? 1);
}

function attackObelisk(event) {
  const npc = event.npc;
  if (npc?.__toaObelisk === undefined) return false;
  event.player.getCombat().attack(npc);
  return true;
}

module.exports = function registerScabarasPuzzle(api) {
  Shared.bind(api);
  Raid.registerRoom("SCABARAS_PUZZLE", ScabarasPuzzleRoom);
  Shared.onObject(api, "Pressure plate", flipLightPlate);
  Shared.onObject(api, "Ancient tablet", readSumTablet);
  Shared.onObject(api, "Ancient button", pressAncientButton);
  Shared.onObject(api, "Tile", turnTile);
  Shared.onObject(api, "Passage", crawlPassage);
  Shared.onObject(api, "Platform", jumpPlatform);
  api.onObjectRoute(routeToShortcut);
  api.onNpcInteraction("<col=00ffff>Obelisk</col>", { Hit: attackObelisk });
  api.onNpcRoute(routeToObelisk);
  api.onNpcHitModify(hitObelisk);
  api.onPlayerDealtDamage(struckObelisk);
  api.onNpcBeforeDeath(scarabKilled);
  Raid.onRaidArea("canAttack", canHitObelisk);
  registerScarabCombat(api);
};

/** The puzzle room's scarabs spit from range. */
function registerScarabCombat(api) {
  const { CombatMethod, CombatType, Animation, Projectile, NpcIdentifiers } = api.core;
  class ScarabCombatMethod extends CombatMethod {
    type() {
      return CombatType.RANGED;
    }

    attackDistance() {
      return SCARAB_RANGE;
    }

    attackSpeed() {
      return SCARAB_ATTACK_SPEED;
    }

    start(npc, target) {
      npc.performAnimation(new Animation(ANIMATION.SCARAB_ATTACK));
      Projectile.createProjectile(npc, target, SCARAB_PROJECTILE, 51, Projectile.arrivalCycles(npc, target, 51), 11, 22).sendProjectile();
    }

    hits(npc, target) {
      const room = npc.__toaRoom;
      const delay = Projectile.arrivalTicks(npc, target, 51);
      if (room instanceof ScabarasPuzzleRoom) return [room.styledHit(npc, target, this, "ranged", SCARAB_MAX_HIT, delay, { scale: false })];
      return [];
    }
  }
  api.registerNpcCombatMethodProvider(NpcIdentifiers.SCARAB, ScarabCombatMethod);
}
