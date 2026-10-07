"use strict";

/**
 * Path of Scabaras, Test of Isolation: four puzzles behind fire gates (lights out, addition,
 * obelisk sequence, memory) in a random layout, then the tile-matching puzzle that ends the
 * room. Scarabs harass both halves of the room throughout.
 * Wiki: https://oldschool.runescape.wiki/w/Path_of_Scabaras#Puzzle_room
 */

const Shared = require("./ToaShared");
const Raid = require("./ToaRaid");

const PUZZLE = { LIGHT: "LIGHT", SUM: "SUM", PILLAR: "PILLAR", MEMORY: "MEMORY" };
const PUZZLE_TYPES = Object.values(PUZZLE);

const BASE_PUZZLE_TILES = [{ x: 3539, y: 5283 }, { x: 3556, y: 5283 }, { x: 3539, y: 5271 }, { x: 3556, y: 5271 }];
const NORTH_FIRE_TILES = [{ x: 3549, y: 5286 }, { x: 3564, y: 5286 }];
const SOUTH_FIRE_TILES = [{ x: 3549, y: 5274 }, { x: 3564, y: 5274 }];
const SCARAB_SPAWN_SOUTH = { x: 3535, y: 5274 };
const SCARAB_SPAWN_NORTH = { x: 3535, y: 5286 };
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
const ROCKFALL_CENTRE_OFFSET = [3, 3];

// Cache locs (several are nameless, so they have no identifier constant).
const FIRE = 45335; // ToA fire wall
const PRESSURE_BUTTON = 45338; // Ancient button
const SUM_TABLET = 45339; // Ancient tablet
const MEMORY_PLATE = 45340;
const MEMORY_YELLOW = 45341;
const MEMORY_RED = 45342;
const LIGHT_PLATE = 45344;
const SUM_PLATE_BASE = 45345; // 45345..45353, one per value 1..9
const MATCH_TILE = 45360; // Tile
const LIGHT_ACTIVE = 45384;
const SUM_LIGHTS = [45388, 45389, 45390, 45387, 45392, 45393, 45386, 45394, 45395];
const STATUE = 45205;
const TILE_LOCK = 43876;
const FLOOR_SHAPE = 22;
const OBJECT_SHAPE = 10;

const ANIMATION = { FLIP: 9490, FLIP_DONE: 827, BUTTON: 832, SCARAB_SPAWN: 9589, SCARAB_ATTACK: 9587 };
const GRAPHIC = { SMALL_ROCKS: 302, ROCKFALL: 317 };
const SOUND = {
  FLIP: 6560, PRESSURE: 6561, PUZZLE_DONE: 2655, ROCKFALL: 4459, RUMBLING: 6578,
  TILE: 6553, MATCH_FAIL: 6554, SUM_FAIL: 6558, BUTTON: 6559, MEMORY_FAIL: 6557, TABLET: 6548, OBELISK_HIT: 955,
};
// The shortcuts between the north and south paths (Near-Reality's PassageAction and
// SteppingStonesAction): a crawl through the passage (45343) in the west, a jump across the
// platform (45396) in the east. Each is used from the side the player stands on.
const PASSAGE = 45343;
const PASSAGE_SIDES = { north: { x: 3548, y: 5284 }, south: { x: 3548, y: 5276 } };
const PLATFORM = 45396;
const PLATFORM_TILE = { x: 3560, y: 5280 };
const PLATFORM_SIDES = { north: { x: 3560, y: 5283 }, south: { x: 3560, y: 5277 } };
const MIDDLE_Y = 5280;
const SHORTCUT = { CRAWL: 2796, JUMP: 741, CRAWL_SOUND: 2454, JUMP_SOUND: 2461 }; // HUMAN_LONGCRAWL, HUMAN_SPOT_JUMP

const SCARAB_PROJECTILE = 1766;
const SCARAB_MAX_HIT = 6;
const SCARAB_RANGE = 8;
const SCARAB_POINTS = 0.5;
const FLIP_DAMAGE = 20;
const FLIP_TICKS = 4;
const OBELISK_TIMEOUT = 5;
const SCARAB_FIRST_SPAWN = 30;
const SCARAB_INTERVAL = 10;
const SUM_MIN = 20;
const SUM_MAX = 45;
const SEQUENCE_LENGTH = 5;

class ScabarasPuzzleRoom extends Raid.Room {
  build() {
    this.rotation = Shared.shuffle(PUZZLE_TYPES);
    this.completed = [false, false, false, false];
    this.lights = new Array(LIGHT_OFFSETS.length).fill(false);
    this.scarabs = new Set();
    this.obelisks = [];
    this.matchNorth = Shared.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    this.matchSouth = Shared.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]);

    const light = this.base(PUZZLE.LIGHT);
    for (const [dx, dy] of LIGHT_OFFSETS) this.setObject(LIGHT_PLATE, at(light, dx, dy), FLOOR_SHAPE, 0);
    const sum = this.base(PUZZLE.SUM);
    SUM_OFFSETS.forEach((tiles, value) => {
      for (const [dx, dy] of tiles) this.setObject(SUM_PLATE_BASE + value, at(sum, dx, dy), FLOOR_SHAPE, 1);
    });
    this.setObject(SUM_TABLET, at(sum, ...BUTTON_OFFSET), OBJECT_SHAPE, 0);
    const pillar = this.base(PUZZLE.PILLAR);
    const { NpcIdentifiers } = Shared.core();
    OBELISK_OFFSETS.forEach(([dx, dy], index) => {
      const tile = at(pillar, dx, dy);
      const id = index < 5 ? NpcIdentifiers.COL_00FFFF_OBELISK_COL : NpcIdentifiers.COL_00FFFF_OBELISK_COL_2;
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
    this.resetPuzzles();
  }

  base(type) {
    return BASE_PUZZLE_TILES[this.indexOf(type)];
  }

  indexOf(type) {
    return this.rotation.indexOf(type);
  }

  hasCompleted(type) {
    return this.completed[this.indexOf(type)];
  }

  gateOf(index) {
    return index < 2 ? NORTH_FIRE_TILES[index] : SOUTH_FIRE_TILES[index - 2];
  }

  resetPuzzles() {
    this.completed.fill(false);
    for (const tile of [...NORTH_FIRE_TILES, ...SOUTH_FIRE_TILES]) this.setObject(FIRE, tile, OBJECT_SHAPE, 3);
    for (let i = 0; i < EXIT_FIRE_LENGTH; i++) this.setObject(FIRE, at(EXIT_FIRE_BASE, 0, i), OBJECT_SHAPE, 3);
    this.resetObelisks();
    this.obeliskOrder = Shared.shuffle([0, 1, 2, 3, 4]);
    const light = this.base(PUZZLE.LIGHT);
    this.lights.forEach((lit, index) => {
      if (lit) this.toggleLight(light, index);
    });
    this.rockfallAt = 0;
    this.sumGoal = Shared.random(SUM_MIN, SUM_MAX);
    this.sum = 0;
    this.setSumLights(false);
    this.scarabTicks = SCARAB_FIRST_SPAWN;
    const memory = this.base(PUZZLE.MEMORY);
    for (const [dx, dy] of MEMORY_OFFSETS) this.setObject(-1, at(memory, dx, dy), OBJECT_SHAPE);
    MATCH_BASE_TILES.forEach((base) => {
      for (const [dx, dy] of MATCH_OFFSETS) {
        this.setObject(MATCH_TILE, at(base, dx, dy), FLOOR_SHAPE, 1);
        this.setObject(-1, at(base, dx, dy), OBJECT_SHAPE);
      }
    });
    this.northPick = -1;
    this.southPick = -1;
    this.matches = 0;
    this.resetSequence();
  }

  onStart() {
    this.setObject(-1, STATUE_TILE, OBJECT_SHAPE);
    this.setObject(-1, at(STATUE_TILE, -1, 0), OBJECT_SHAPE);
    this.setObject(STATUE, at(STATUE_TILE, this.teamSize > 1 ? -1 : 0, 0), OBJECT_SHAPE, 3);
    // Alone, three pairs are shown from the start so the tiles can still be matched.
    if (this.teamSize < 2) {
      for (const key of [0, 4, 5]) {
        this.pickMatch(true, this.matchNorth.indexOf(key), null, true);
        this.pickMatch(false, this.matchSouth.indexOf(key), null, true);
      }
    }
    const light = this.base(PUZZLE.LIGHT);
    for (let i = 0; i < LIGHT_OFFSETS.length; i++) {
      if (Shared.random(0, 1) === 0) this.toggleLight(light, i);
    }
  }

  onComplete() {
    this.killScarabs();
    for (let i = 0; i < EXIT_FIRE_LENGTH; i++) this.setObject(-1, at(EXIT_FIRE_BASE, 0, i), OBJECT_SHAPE);
    for (const tile of [...NORTH_FIRE_TILES, ...SOUTH_FIRE_TILES]) this.setObject(-1, tile, OBJECT_SHAPE);
    this.completed.fill(true);
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
    this.setObject(-1, this.gateOf(index), OBJECT_SHAPE);
    for (const player of this.challengePlayers()) player.sendMessage(`<col=06600c>Puzzle ${index + 1} has been completed!`);
    for (const player of this.puzzlePlayers(index)) Shared.sound(player, SOUND.PUZZLE_DONE);
  }

  /** The east puzzles only work once the west puzzle on the other side is done. */
  canUse(player, type, refusal) {
    if (!this.isStarted()) return false;
    const index = this.indexOf(type);
    if ((index === 1 && !this.completed[2]) || (index === 3 && !this.completed[0])) {
      player.sendMessage(refusal ?? "This device won't function yet.");
      return false;
    }
    return true;
  }

  tick() {
    if (!this.isStarted()) return;
    if (--this.scarabTicks <= 0) {
      this.scarabTicks = SCARAB_INTERVAL;
      const wanted = Math.floor((this.teamSize + 1) / 2);
      const south = [...this.scarabs].filter((scarab) => scarab.__toaSouth).length;
      const north = this.scarabs.size - south;
      if (north < wanted) this.spawnScarab(false);
      if (south < wanted) this.spawnScarab(true);
    }
    if (!this.hasCompleted(PUZZLE.PILLAR) && this.obeliskIndex < 5 && this.pillarTicks > 0 && --this.pillarTicks === 0) {
      this.resetObelisks();
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
    for (const scarab of this.scarabs) {
      if (scarab.getHitpoints() <= 0 || !scarab.isRegistered?.()) this.scarabs.delete(scarab);
    }
  }

  spawnScarab(south) {
    const { NpcIdentifiers, Animation } = Shared.core();
    const scarab = this.spawn(NpcIdentifiers.SCARAB, south ? SCARAB_SPAWN_SOUTH : SCARAB_SPAWN_NORTH, { scale: false, points: SCARAB_POINTS });
    if (!scarab) return;
    scarab.__toaScarab = true;
    scarab.__toaSouth = south;
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
    this.setObject(this.lights[index] ? LIGHT_ACTIVE : -1, at(base, dx, dy), OBJECT_SHAPE, 1);
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
        Shared.damage(player, FLIP_DAMAGE);
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
      for (const [dx, dy] of tiles) this.setObject(on ? SUM_LIGHTS[value] : -1, at(base, dx, dy), OBJECT_SHAPE, 1);
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
          this.setObject(SUM_LIGHTS[value], at(base, dx, dy), OBJECT_SHAPE, 1);
          Shared.sound(player, SOUND.PRESSURE);
        }
        return true;
      }
    }
    return false;
  }

  readTablet(player) {
    if (!this.canUse(player, PUZZLE.SUM, "You can't seem to make out the writing. Weird.")) return;
    player.sendMessage(`The number <col=ef1020>${this.sumGoal}</col> has been hastily chipped into the stone.`);
    Shared.sound(player, SOUND.TABLET);
  }

  // -------------------------------------------------------------- obelisks

  resetObelisks() {
    const { NpcIdentifiers } = Shared.core();
    this.obeliskIndex = 0;
    this.pillarTicks = 0;
    for (const obelisk of this.obelisks) {
      if (obelisk.__toaObelisk < 5) obelisk.setNpcTransformationId(NpcIdentifiers.COL_00FFFF_OBELISK_COL);
    }
  }

  /** Each correct obelisk lights up; a wrong one resets the order and brings the roof down. */
  hitObelisk(player, obelisk) {
    const { NpcIdentifiers } = Shared.core();
    Shared.sound(player, SOUND.OBELISK_HIT);
    if (this.obeliskIndex > 4) {
      this.complete(PUZZLE.PILLAR);
      return;
    }
    if (obelisk.__toaObelisk === this.obeliskOrder[this.obeliskIndex]) {
      this.obeliskIndex++;
      this.pillarTicks = OBELISK_TIMEOUT;
      obelisk.setNpcTransformationId(NpcIdentifiers.COL_00FFFF_OBELISK_COL_2);
      return;
    }
    this.resetObelisks();
    if (this.rockfallAt >= Shared.cycle()) return;
    this.rockfallAt = Shared.cycle() + 5;
    this.pillarRockfall();
  }

  pillarRockfall() {
    const index = this.indexOf(PUZZLE.PILLAR);
    const base = BASE_PUZZLE_TILES[index];
    const gate = this.gateOf(index);
    const { RegionManager } = Shared.core();
    const candidates = [];
    for (let x = base.x - 6; x < gate.x; x++) {
      for (let y = base.y; y <= base.y + 6; y++) {
        if (RegionManager.getClipping?.(x, y, 0, this.area) === 0) candidates.push({ x, y });
      }
    }
    const tiles = Shared.shuffle(candidates).slice(0, 7);
    const players = this.puzzlePlayers(index);
    for (const player of players) {
      if (!tiles.some((tile) => tile.x === player.getLocation().getX() && tile.y === player.getLocation().getY())) {
        tiles.push({ x: player.getLocation().getX(), y: player.getLocation().getY() });
      }
      Shared.sound(player, SOUND.RUMBLING);
      Shared.sound(player, SOUND.ROCKFALL);
    }
    for (const tile of tiles) {
      for (const viewer of players) Shared.graphicAt(viewer, GRAPHIC.ROCKFALL, Shared.loc(tile, 0));
    }
    this.later(5, () => {
      for (const player of this.challengePlayers()) {
        if (tiles.some((tile) => tile.x === player.getLocation().getX() && tile.y === player.getLocation().getY())) {
          const low = Math.floor(7 * this.raid.damageFactor(0));
          Shared.damage(player, Shared.random(low, low + 6));
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
    this.later(1, () => !this.hasCompleted(PUZZLE.MEMORY) && this.setObject(-1, plate, OBJECT_SHAPE));
    if (this.sequence[this.sequenceStep] === index) {
      if (++this.sequenceStep === SEQUENCE_LENGTH) {
        this.complete(PUZZLE.MEMORY);
        for (const [dx, dy] of MEMORY_OFFSETS) this.setObject(MEMORY_YELLOW, at(base, dx, dy), OBJECT_SHAPE, 0);
      }
    } else {
      Shared.sound(player, SOUND.MEMORY_FAIL);
      this.smallRockfall(player);
      this.resetSequence();
    }
    return true;
  }

  smallRockfall(player) {
    Shared.damage(player, Math.floor(this.raid.damageFactor(0) * 6));
    Shared.sound(player, SOUND.SUM_FAIL);
    Shared.graphicAt(player, GRAPHIC.SMALL_ROCKS, player.getLocation());
  }

  // -------------------------------------------------------------- matching

  turnMatchTile(player, location) {
    for (let side = 0; side < MATCH_BASE_TILES.length; side++) {
      const base = MATCH_BASE_TILES[side];
      const index = MATCH_OFFSETS.findIndex(([dx, dy]) => base.x + dx === location.getX() && base.y + dy === location.getY());
      if (index !== -1) {
        this.pickMatch(side === 1, index, player, false);
        return;
      }
    }
  }

  /** Turns a tile on one side; once both sides have one up, they stay lit if they match. */
  pickMatch(north, index, player, initial) {
    if (!this.isStarted() && !initial) return;
    const order = north ? this.matchNorth : this.matchSouth;
    const key = order[index];
    const base = MATCH_BASE_TILES[north ? 1 : 0];
    this.setObject(SUM_PLATE_BASE + key, at(base, ...MATCH_OFFSETS[index]), FLOOR_SHAPE, 1);
    const previous = north ? this.northPick : this.southPick;
    if (previous !== -1 && previous !== key) {
      this.setObject(MATCH_TILE, at(base, ...MATCH_OFFSETS[order.indexOf(previous)]), FLOOR_SHAPE, 1);
    }
    if (north) this.northPick = key;
    else this.southPick = key;
    if (player) Shared.sound(player, SOUND.TILE);
    if (this.northPick === -1 || this.southPick === -1) return;
    const northKey = this.northPick;
    const southKey = this.southPick;
    const resolve = () => {
      const northTile = at(MATCH_BASE_TILES[1], ...MATCH_OFFSETS[this.matchNorth.indexOf(northKey)]);
      const southTile = at(MATCH_BASE_TILES[0], ...MATCH_OFFSETS[this.matchSouth.indexOf(southKey)]);
      if (northKey === southKey) {
        this.setObject(SUM_LIGHTS[northKey], northTile, OBJECT_SHAPE, 1);
        this.setObject(SUM_LIGHTS[southKey], southTile, OBJECT_SHAPE, 1);
        if (player) Shared.sound(player, SOUND.PRESSURE);
        if (++this.matches >= MATCH_OFFSETS.length) {
          for (const member of this.challengePlayers()) member.sendMessage("<col=06600c>Puzzle 5 has been completed!");
          this.complete();
        }
      } else {
        if (player) Shared.sound(player, SOUND.MATCH_FAIL);
        this.setObject(MATCH_TILE, northTile, FLOOR_SHAPE, 1);
        this.setObject(MATCH_TILE, southTile, FLOOR_SHAPE, 1);
      }
      this.northPick = -1;
      this.southPick = -1;
    };
    if (initial) resolve();
    else this.later(1, resolve);
  }

  // -------------------------------------------------------------- movement

  onStep(player, _from, to) {
    if (!this.isStarted() || !this.inChallenge(player)) return;
    if (this.stepSum(player, to)) return;
    if (this.stepLight(player, to, false)) return;
    this.stepMemory(player, to);
  }

  /** Players standing in one puzzle's chamber. */
  puzzlePlayers(index) {
    const base = BASE_PUZZLE_TILES[index];
    const gate = this.gateOf(index);
    return this.challengePlayers((player) => {
      const location = player.getLocation();
      return location.getX() >= base.x - 4 && location.getX() < gate.x
        && location.getY() >= base.y && location.getY() <= base.y + 6;
    });
  }
}

function at(base, dx, dy) {
  return { x: base.x + dx, y: base.y + dy, z: 0 };
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
  if (room.canUse(player, PUZZLE.PILLAR) && npc.__toaObelisk < 5) room.hitObelisk(player, npc);
}

function canHitObelisk(event) {
  const npc = event.target;
  if (npc?.__toaObelisk === undefined) return;
  const room = npc.__toaRoom;
  if (!(room instanceof ScabarasPuzzleRoom) || npc.__toaObelisk >= 5) {
    event.allow = false;
    return;
  }
  if (event.attacker?.isPlayer?.() && !room.canUse(event.attacker, PUZZLE.PILLAR)) event.allow = false;
  if (!event.attacker?.isPlayer?.()) event.allow = false;
}

/** Striking an obelisk costs no attack delay: the next one can be struck at once (Near-Reality). */
function struckObelisk(event) {
  const { player, target } = event;
  if (target?.__toaObelisk === undefined || !(target.__toaRoom instanceof ScabarasPuzzleRoom)) return;
  Shared.skipAttackDelay(player, target);
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
  player.performAnimation(new Animation(SHORTCUT.CRAWL));
  Shared.sound(player, SHORTCUT.CRAWL_SOUND);
  Shared.later(player, 1, () => {
    if (!scabarasRoom(player)) return;
    player.performAnimation(new Animation(-1));
    player.moveTo(Shared.loc(to, 0));
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
  const jump = (target) => {
    const location = player.getLocation();
    Shared.sound(player, SHORTCUT.JUMP_SOUND);
    Shared.knockback(player, target.x - location.getX(), target.y - location.getY(),
      { ticks: 1, speed: 35, direction, animation: SHORTCUT.JUMP });
  };
  player.getMovementQueue().reset();
  jump(PLATFORM_TILE);
  Shared.later(player, 2, () => scabarasRoom(player) && jump(to));
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
