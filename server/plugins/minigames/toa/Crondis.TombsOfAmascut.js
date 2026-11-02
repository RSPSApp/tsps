"use strict";

/**
 * Path of Crondis, Test of Resourcefulness: carry water from the waterfalls to the Palm of
 * Resourcefulness past acid trails, spear statues and crocodiles. Getting hit spills half
 * of what you carry; crocodiles also drink from the palm. The room ends once it is watered.
 * Wiki: https://oldschool.runescape.wiki/w/Tombs_of_Amascut/Strategies#Path_of_Crondis
 *
 * Captured (tiles are offsets from the palm, here written as this map's tiles):
 * - Layout: statues, containers, the palm's block, wall openings: 223/00014 ticks 135-138.
 * - Acid: rows every 5 ticks from a tick after the start, 2-3 orbs (TOA_CRONDIS_ORB) a row and one
 *   sound (4424, radius 14) at the row's centre; the clouds (2129) start 2 ticks in at 10 cycles a
 *   tile, the orbs go at 3 (231/00389 ticks 171-186). It hurts whoever stood on the tile last tick,
 *   4 + floor(tiles / 3) ticks after the orb, tiles 1-10 from the row (40 hits over 44 rooms). The
 *   hit fails Perfect Crondis the tick after (223/00014 ticks 163-164).
 * - Spears: each statue's own phase in a 10 tick cycle, counted from "Challenge started" (231/00389,
 *   every statue, 43 cycles; 223/00014 ticks 248-258 agrees). 9563 at the phase; the spear 9565 and
 *   sound 6493 (radius 5, delay 14) 3 ticks on, 9562 again at 6 and 7. It hurts for the 3 ticks after
 *   the spear, across all 5 tiles of its row (96 of 110 hits; dx 0 and 4 from either side; last tick's tile).
 * - Waterfalls: refill by party size: 1: 129 (223/00014), 3: 29 (48 samples), 5: 19 (11), 6: 14 (29),
 *   8: 4 (15). Filling: anim 827 and 6522 delayed 10. A fill below half energy gives 25% more and
 *   "While you're there..." (223/00014 ticks 186, 319: 47% and 17%; not at 51% or 72%).
 * - Watering: 827, sounds 6534 and 6516 delayed 15, hitsplat 11 with the amount on the palm's bar
 *   (type 11, out of 120); its stage at each quarter (223/00014 tick 198, 235/03431 tick 114).
 *   100 is "a lot...!", 85 and 50 are "a reasonable amount." (235/03429 tick 272, 223/00014 tick 172).
 * - Crocodiles: one spawn corner per two players, rounded up, its own timer of 46-50 ticks from the
 *   start (44 rooms, sizes 1-8; 234/03280 and 231/00389 agree). They wait 5 ticks and step every other
 *   tick (223/00014 ticks 187-206). Each bite on the palm is 9804 with sound 386 (radius 4) and hitsplat
 *   15, every 7 ticks. They die (2038) 3 ticks after the palm is grown (235/03431 tick 145).
 * Wiki (numbers):
 * - 175 water and 125 for each extra player. 2025 recordings agree for solo (100 fills 69/120: 234/00844,
 *   234/03280, 235/03431); the 2024 party recordings show the old 200 a player.
 * - A hit from a trap: half the water, Defence -6, Agility -3, Prayer -2 (223/00014 tick 192 agrees).
 * - Crocodiles: 18, +3 per trap hit in the last 30 seconds, at most 36; Protect from Melee: a third and
 *   -12 Prayer; at most 8; targets in the page's order.
 * Estimates:
 * - Trap damage 4-7 before scaling, both kinds (fit: 71 hits, Entry to raid level 555, solo and party;
 *   hits of 8-10 appear, in parties only, and aren't modelled).
 * - A bite takes 3-5 from a solo palm, 6-9 for three, 10-11 for six (fit, 25 samples, whatever the raid
 *   level): +1.5 and +2 per extra player.
 * - Refill for 2 players, between solo and three: 79. No capture sees one (still dry after 55 ticks); 4
 *   and 7 follow the line through 3, 5, 6 and 8.
 * - Crocodile aggro range 3, and "a small amount" under 25: nothing recorded.
 * - No capture fails Perfect Crondis for a crocodile or the time: the bite's reason is a guess, and a
 *   late finish announces nothing.
 * - A reset bringing the crocodiles 10 ticks sooner: still only from OpenRune.
 */

const Shared = require("./Shared.TombsOfAmascut");
const Raid = require("./RaidState.TombsOfAmascut");

const CONTAINER = 27295; // Water container
const WATERFALL_FULL = 45398;
const WATERFALL_EMPTY = 45399;
const STATUE = 45414;
const SPEAR_STATUE = 45415; // its spear is the next id
const ACID = 45403;
const INVISIBLE_BLOCK = 32740;
const BARRIER = 45135;

const CONTAINER_TILES = [{ x: 3934, y: 5273 }, { x: 3938, y: 5287 }];
const STATUE_SOUTH = [{ x: 3943, y: 5255 }, { x: 3929, y: 5255 }];
const STATUE_NORTH = [{ x: 3929, y: 5304 }, { x: 3943, y: 5304 }];
const WATERFALL_SOUTH = [{ x: 3926, y: 5250 }, { x: 3940, y: 5250 }];
const WATERFALL_NORTH = [{ x: 3926, y: 5306 }, { x: 3940, y: 5306 }];
const ACID_SOUTH = [{ x: 3941, y: 5257 }, { x: 3927, y: 5257 }];
const ACID_NORTH = [{ x: 3941, y: 5303 }, { x: 3927, y: 5303 }];
const SPEAR_ROWS = [{ x: 3925, y: 5293 }, { x: 3939, y: 5293 }, { x: 3925, y: 5258 }, { x: 3939, y: 5258 }];
/** Each statue's phase in the 10 tick cycle from "Challenge started": five west, five east, south to north (231/00389). */
const SPEAR_PHASES = [[3, 5, 7, 9, 1, 3, 5, 7, 9, 1], [5, 8, 1, 4, 7, 5, 8, 1, 4, 7], [5, 4, 4, 3, 3, 5, 5, 4, 4, 3], [4, 5, 6, 7, 8, 8, 7, 6, 5, 4]];
const SPEAR_CYCLE = 10;
/** A spear covers its whole corridor: this many tiles from the row's statue. */
const SPEAR_REACH = { FROM: 2, TO: 6 };
// The corners crocodiles come in by, picked when the room is built; each has two wall openings
// (toa_wall02_crocodiles04), there from the start (223/00014 tick 135; 227/01838 tick 150, all four).
const CROCODILE_WALL = 45434;
const CROCODILE_CORNERS = [
  { spawn: { x: 3946, y: 5274 }, walls: [{ x: 3950, y: 5273, face: 0 }, { x: 3948, y: 5271, face: 1 }] },
  { spawn: { x: 3946, y: 5285 }, walls: [{ x: 3950, y: 5287, face: 0 }, { x: 3948, y: 5289, face: 3 }] },
  { spawn: { x: 3925, y: 5285 }, walls: [{ x: 3922, y: 5287, face: 2 }, { x: 3923, y: 5289, face: 3 }] },
  { spawn: { x: 3925, y: 5274 }, walls: [{ x: 3922, y: 5273, face: 2 }, { x: 3924, y: 5271, face: 1 }] },
];
const PALM_TILE = { x: 3934, y: 5278, z: 0 };
const END_BARRIER = { x: 3922, y: 5279 };

// Wiki (strategies): 175 water, and 125 more for each extra player.
const WATER_FIRST_PLAYER = 175;
const WATER_PER_EXTRA_PLAYER = 125;
const CONTAINER_FULL = 100;
const WATER_MESSAGES = [
  { above: 85, text: "You empty a lot of water onto the palm!" },
  { above: 25, text: "You empty a reasonable amount of water onto the palm." },
  { above: 0, text: "You empty a small amount of water onto the palm." },
];
/** Ticks a waterfall stays dry, by party size (see the header; 2, 4 and 7 are estimates). */
const WATERFALL_REFILL = [129, 129, 79, 29, 24, 19, 14, 9, 4];
const DRINK = { BELOW: 50, ENERGY: 25, MESSAGE: "While you're there, you take a drink of refreshing water!" };
const ACID_GRAPHIC = 2129;
const ACID_PERIOD = 5;
const ACID_TIMING = { CLOUD_TICKS: 2, ORB_TICKS: 3, TILES: 10, CLOUD_CYCLES_PER_TILE: 10, HIT_BASE_TICKS: 4, TILES_PER_TICK: 3 };
const ACID_ROW_SOUND_OFFSET = 2;
const ANIMATION = { FILL: 827, SPEAR_END: 9562, MOUTH: 9563, SPEAR: 9565, CROCODILE_BITE: 9804, CROCODILE_DEATH: 2038 };
const SOUND = { FILL: 6522, EMPTY: 6524, SPILL: 2401, WATER_PALM: 6534, PALM_UP: 6516, PALM_DOWN: 6529, TAKE: 2582, ACID: 4424, SPEAR: 6493, CROCODILE_BITE: 386, CROCODILE_DEATH: 387 };
const SOUND_DELAY = { FILL: 10, SPILL: 10, PALM: 15, SPEAR: 14 };
const SOUND_RADIUS = { ACID: 14, SPEAR: 5, CROCODILE_BITE: 4, CROCODILE_DEATH: 8 };
const SPLAT = { WATER: { mine: 11, others: 11 }, BITE: { mine: 15, others: 15 } };
const PALM_BAR = { id: 11, width: 120 };
// Each corner spawns every 46-50 ticks; the first after a reset 10 sooner (OpenRune). Wiki: at most
// 8, biting every 7 ticks, going for anyone carrying water within reach, then a watered palm, then
// anyone without a container who hit them.
const CROCODILE_WAVE_TICKS = [46, 50];
const CROCODILE_RESET_SOONER = 10;
const CROCODILE_WAKE_TICKS = 5;
const CROCODILE_STEP_TICKS = 2;
const CROCODILE_DEATH_TICKS = 3;
const CROCODILE_LIMIT = 8;
const CROCODILE_ATTACK_TICKS = 7;
const CROCODILE_SIGHT = 3;
const PALM_BITE = { MIN: 3, MIN_PER_PLAYER: 1.5, MAX: 5, MAX_PER_PLAYER: 2 };
// Wiki: 18, and 3 more for each acid or spear hit in the last 30 seconds, up to 36.
const CROCODILE_BITE = 18;
const CROCODILE_BITE_PER_HAZARD = 3;
const CROCODILE_BITE_MAX = 36;
const HAZARD_WINDOW_TICKS = 50;
/** A trap's hit before scaling (fit) and what it saps (Wiki). */
const TRAP_DAMAGE = { MIN: 4, MAX: 7 };
const TRAP_DRAIN = { DEFENCE: 6, AGILITY: 3, PRAYER: 2 };
const TRAP_COOLDOWN = { acid: 2, spear: 3 };
const PERFECT = "Perfect Crondis";
const PERFECT_TICKS = 100;

class CrondisPuzzleRoom extends Raid.Room {
  build() {
    const { NpcIdentifiers } = Shared.core();
    this.water = new Map();
    this.watered = 0;
    this.goal = WATER_FIRST_PLAYER;
    this.acidTicks = 0;
    this.acid = [];
    this.crocodiles = new Set();
    this.recentHits = new Map();
    this.floorContainers = new Map();
    for (const tile of STATUE_SOUTH) this.setObject(STATUE, { ...tile, z: 0 }, 10, 0);
    for (const tile of STATUE_NORTH) this.setObject(STATUE, { ...tile, z: 0 }, 10, 2);
    this.palm = this.spawn(NpcIdentifiers.COL_00FFFF_PALM_OF_RESOURCEFULNESS_COL, PALM_TILE, { scale: false, points: 0 });
    if (this.palm) {
      this.palm.__toaScripted = true;
      this.palm.__toaPalm = true;
      this.palm.setUntargetable(true);
      this.palm.getMovementQueue().setBlockMovement(true);
    }
    this.setObject(INVISIBLE_BLOCK, PALM_TILE, 10, 0);
    const corners = Math.ceil(this.teamSize / 2);
    this.corners = Shared.shuffle(CROCODILE_CORNERS).slice(0, corners).map((corner) => ({ ...corner, ticks: this.nextCrocodileWave() }));
    for (const corner of this.corners) {
      for (const wall of corner.walls) this.setObject(CROCODILE_WALL, { x: wall.x, y: wall.y, z: 0 }, 10, wall.face);
    }
  }

  nextCrocodileWave() {
    return Shared.random(CROCODILE_WAVE_TICKS[0], CROCODILE_WAVE_TICKS[1]);
  }

  onPlayerArrive(player) {
    this.placeContainers(player);
  }

  /** Each player sees their own pair of containers to pick up (untradeables only show to their owner). */
  placeContainers(player) {
    const { ItemOnGroundManager, Item } = Shared.core();
    const items = CONTAINER_TILES.map((tile) =>
      ItemOnGroundManager.registerLocation(player, new Item(CONTAINER, 1), Shared.loc(tile, 0), this.area));
    this.floorContainers.set(player, items);
  }

  onStart() {
    this.goal = WATER_FIRST_PLAYER + (this.teamSize - 1) * WATER_PER_EXTRA_PLAYER;
    this.watered = 0;
    this.palm.setMaxHitpoints(this.goal);
    this.palm.setHitpoints(this.goal);
    this.openBossHud(this.palm);
    this.updatePalm();
  }

  onComplete() {
    if (Shared.cycle() - this.startCycle < PERFECT_TICKS) this.raid.completeTask(PERFECT);
    this.killCrocodiles();
    this.clear();
    for (let y = 0; y < 3; y++) this.setObject(-1, { x: END_BARRIER.x, y: END_BARRIER.y + y, z: 0 }, 10);
  }

  onReset() {
    this.clear();
    this.despawn(this.palm);
    for (const corner of this.corners) {
      for (const wall of corner.walls) this.setObject(-1, { x: wall.x, y: wall.y, z: 0 }, 10);
    }
    this.build();
    for (const corner of this.corners) corner.ticks -= CROCODILE_RESET_SOONER;
    for (const player of this.roomPlayers()) this.placeContainers(player);
  }

  clear() {
    for (const crocodile of this.crocodiles) this.despawn(crocodile);
    this.crocodiles.clear();
    this.acid = [];
    for (const player of this.roomPlayers()) player.getInventory().delete(CONTAINER, 28);
    this.water.clear();
    const { ItemOnGroundManager } = Shared.core();
    for (const items of this.floorContainers.values()) for (const item of items) ItemOnGroundManager.deregister(item);
    this.floorContainers.clear();
    for (const tiles of [WATERFALL_SOUTH, WATERFALL_NORTH]) {
      tiles.forEach((tile) => this.setObject(WATERFALL_FULL, { ...tile, z: 0 }, 10, tiles === WATERFALL_SOUTH ? 0 : 2));
    }
  }

  /** They die a few ticks after the palm is grown (235/03431 tick 145). */
  killCrocodiles() {
    const { Animation } = Shared.core();
    const dying = [...this.crocodiles];
    this.crocodiles.clear();
    for (const crocodile of dying) {
      crocodile.getCombat().reset();
      crocodile.setUntargetable(true);
    }
    this.later(CROCODILE_DEATH_TICKS, () => {
      for (const crocodile of dying) {
        crocodile.performAnimation(new Animation(ANIMATION.CROCODILE_DEATH));
        this.areaSound(SOUND.CROCODILE_DEATH, crocodile.getLocation(), 0, SOUND_RADIUS.CROCODILE_DEATH);
      }
    });
    this.later(CROCODILE_DEATH_TICKS * 2, () => dying.forEach((crocodile) => this.despawn(crocodile)));
  }

  /** A sound from a tile, for everyone in the room. */
  areaSound(id, tile, delay, radius) {
    const x = tile.getX ? tile.getX() : tile.x;
    const y = tile.getY ? tile.getY() : tile.y;
    for (const player of this.roomPlayers()) player.getPacketSender().sendAreaSound(id, x, y, 0, 1, delay, radius);
  }

  waterOf(player) {
    return this.water.get(player) ?? 0;
  }

  setWater(player, amount) {
    this.water.set(player, Math.max(0, Math.min(CONTAINER_FULL, amount)));
  }

  // -------------------------------------------------------------- water

  fillAt(player, object) {
    if (this.isCompleted()) {
      player.sendMessage("You don't need to do that right now.");
      return;
    }
    if (object.getId() !== WATERFALL_FULL) {
      player.sendMessage("It's empty.");
      Shared.sound(player, SOUND.EMPTY);
      return;
    }
    if (!player.getInventory().contains(CONTAINER)) {
      player.sendMessage("You don't have anything to fill.");
      return;
    }
    if (this.waterOf(player) >= CONTAINER_FULL) {
      player.sendMessage("Your container is full.");
      return;
    }
    const { Animation } = Shared.core();
    player.sendMessage("You fill your container.");
    Shared.sound(player, SOUND.FILL, SOUND_DELAY.FILL);
    player.performAnimation(new Animation(ANIMATION.FILL));
    if (player.getRunEnergy() < DRINK.BELOW) {
      player.setRunEnergy(Math.min(100, player.getRunEnergy() + DRINK.ENERGY));
      player.sendMessage(DRINK.MESSAGE);
    }
    this.setWater(player, CONTAINER_FULL);
    const location = object.getLocation();
    const tile = { x: location.getX(), y: location.getY(), z: 0 };
    const face = object.getFace();
    this.setObject(WATERFALL_EMPTY, tile, 10, face);
    this.later(WATERFALL_REFILL[Math.min(this.teamSize, WATERFALL_REFILL.length - 1)], () => this.setObject(WATERFALL_FULL, tile, 10, face));
  }

  waterPalm(player) {
    const amount = this.waterOf(player);
    if (!player.getInventory().contains(CONTAINER) || amount < 1) {
      player.sendMessage("You have nothing to water the palm with.");
      return;
    }
    if (!this.isStarted()) return;
    const { Animation } = Shared.core();
    player.sendMessage(WATER_MESSAGES.find(({ above }) => amount > above).text);
    player.performAnimation(new Animation(ANIMATION.FILL));
    Shared.sound(player, SOUND.WATER_PALM, SOUND_DELAY.PALM);
    this.setWater(player, 0);
    this.watered = Math.min(this.goal, this.watered + amount);
    this.palmSplat(amount, SPLAT.WATER);
    this.raid.addPoints(player, amount);
    this.updatePalm();
  }

  /** A splat on the palm that changes nothing: its water is `watered`, shown on its own bar. */
  palmSplat(amount, splat) {
    this.palm.showHitsplat(amount, splat, { current: this.watered, max: this.goal, bar: PALM_BAR });
  }

  /** The palm grows a stage at each quarter of its water; fully watered ends the room. */
  updatePalm() {
    const { NpcIdentifiers } = Shared.core();
    const stages = [
      NpcIdentifiers.COL_00FFFF_PALM_OF_RESOURCEFULNESS_COL, NpcIdentifiers.COL_00FFFF_PALM_OF_RESOURCEFULNESS_COL_2,
      NpcIdentifiers.COL_00FFFF_PALM_OF_RESOURCEFULNESS_COL_3, NpcIdentifiers.COL_00FFFF_PALM_OF_RESOURCEFULNESS_COL_4,
      NpcIdentifiers.COL_00FFFF_PALM_OF_RESOURCEFULNESS_COL_5,
    ];
    const stage = Math.min(4, Math.floor((this.watered / this.goal) * 4 + 1e-9));
    const id = stages[stage];
    const current = this.palm.getNpcTransformationId() === -1 ? stages[0] : this.palm.getNpcTransformationId();
    if (id !== current) {
      for (const player of this.roomPlayers()) Shared.sound(player, id > current ? SOUND.PALM_UP : SOUND.PALM_DOWN, SOUND_DELAY.PALM);
      this.palm.setNpcTransformationId(id === stages[0] ? -1 : id);
    }
    // The HUD fills as the palm is watered.
    this.palm.setHitpoints(Math.max(1, this.watered));
    if (stage === 4 && this.isStarted()) this.complete();
  }

  /** A hit on the way spills half of the water carried, and Perfect Crondis with it. */
  spill(player) {
    const amount = this.waterOf(player);
    if (amount <= 0) return;
    player.sendMessage("Water spills out of your container.");
    Shared.sound(player, SOUND.SPILL, SOUND_DELAY.SPILL);
    this.setWater(player, amount - Math.ceil(amount / 2));
    this.later(1, () => this.raid.failTask(PERFECT, `${Shared.displayName(player)} lost water from their container.`));
  }

  /** Acid and spears also sap Defence, Agility and Prayer (Wiki). */
  debuff(player) {
    const { Skill } = Shared.core();
    const skills = player.getSkillManager();
    skills.decreaseCurrentLevel(Skill.DEFENCE, TRAP_DRAIN.DEFENCE, 0);
    skills.decreaseCurrentLevel(Skill.AGILITY, TRAP_DRAIN.AGILITY, 0);
    skills.decreaseCurrentLevel(Skill.PRAYER, TRAP_DRAIN.PRAYER, 0);
  }

  /** A trap catches the player: damage, spilled water, sapped stats, and harder crocodiles for 30 seconds. */
  trapHit(player, kind) {
    const now = Shared.cycle();
    const hits = this.recentHits.get(player) ?? {};
    if ((hits[kind] ?? -1) > now) return;
    hits[kind] = now + TRAP_COOLDOWN[kind];
    hits.at = [...(hits.at ?? []), now];
    this.recentHits.set(player, hits);
    this.spill(player);
    Shared.damage(player, this.maxHit(Shared.random(TRAP_DAMAGE.MIN, TRAP_DAMAGE.MAX)));
    this.debuff(player);
  }

  // -------------------------------------------------------------- tick

  tick() {
    for (const items of this.floorContainers.values()) for (const item of items) item.setTick(0);
    if (!this.isStarted()) return;
    const now = Shared.cycle();
    this.acid = this.acid.filter((trail) => now - trail.born <= ACID_TIMING.HIT_BASE_TICKS + Math.floor(ACID_TIMING.TILES / ACID_TIMING.TILES_PER_TICK));
    for (const player of this.challengePlayers()) for (const trail of this.acid) this.checkAcid(player, trail, now);
    if (--this.acidTicks <= 0) {
      this.acidTicks = ACID_PERIOD;
      this.spawnAcid(ACID_NORTH, false);
      this.spawnAcid(ACID_SOUTH, true);
    }
    this.tickSpears((now - this.startCycle) % SPEAR_CYCLE);
    for (const corner of this.corners) {
      if (--corner.ticks > 0) continue;
      corner.ticks = this.nextCrocodileWave();
      if (this.crocodiles.size < CROCODILE_LIMIT) this.spawnCrocodile(corner.spawn);
    }
    this.tickCrocodiles();
  }

  spawnAcid(bases, north) {
    for (const base of bases) {
      const offsets = Shared.shuffle([0, 1, 2, 3, 4]).slice(0, Shared.random(2, 3));
      this.areaSound(SOUND.ACID, { x: base.x + ACID_ROW_SOUND_OFFSET, y: base.y }, 0, SOUND_RADIUS.ACID);
      for (const dx of offsets) {
        const tile = { x: base.x + dx, y: base.y, z: 0 };
        this.setObject(ACID, tile, 10, 0);
        this.acid.push({ x: tile.x, y: tile.y, north, born: Shared.cycle() });
        this.later(ACID_TIMING.ORB_TICKS, () => this.setObject(-1, tile, 10));
        this.later(ACID_TIMING.CLOUD_TICKS, () => {
          for (let step = 1; step <= ACID_TIMING.TILES; step++) {
            this.graphic(ACID_GRAPHIC, { x: tile.x, y: tile.y + (north ? step : -step) }, { delay: ACID_TIMING.CLOUD_CYCLES_PER_TILE * step });
          }
        });
      }
    }
  }

  /** The dark cloud passes each tile at its own tick (see the header). */
  checkAcid(player, trail, now) {
    const location = player.getLocation();
    if (location.getX() !== trail.x) return;
    const along = trail.north ? location.getY() - trail.y : trail.y - location.getY();
    if (along < 1 || along > ACID_TIMING.TILES) return;
    if (now - trail.born === ACID_TIMING.HIT_BASE_TICKS + Math.floor(along / ACID_TIMING.TILES_PER_TICK)) this.trapHit(player, "acid");
  }

  tickSpears(phase) {
    const active = [];
    SPEAR_ROWS.forEach((row, index) => {
      for (const east of [false, true]) {
        for (let y = 0; y < 5; y++) {
          const tileY = row.y + y * 2 + (east ? 1 : 0);
          const statue = { x: row.x + (east ? 7 : 0), y: tileY };
          const spear = { x: row.x + (east ? 4 : 2), y: tileY };
          const face = east ? 0 : 2;
          const since = (phase - SPEAR_PHASES[index][y + (east ? 5 : 0)] + SPEAR_CYCLE) % SPEAR_CYCLE;
          if (since === 0) this.animateLoc(SPEAR_STATUE, statue, face, ANIMATION.MOUTH);
          else if (since === 3) {
            this.animateLoc(SPEAR_STATUE + 1, spear, face, ANIMATION.SPEAR);
            this.areaSound(SOUND.SPEAR, spear, SOUND_DELAY.SPEAR, SOUND_RADIUS.SPEAR);
          } else if (since === 4 || since === 5) active.push({ row, y: tileY });
          else if (since === 6) {
            this.animateLoc(SPEAR_STATUE + 1, spear, face, ANIMATION.SPEAR_END);
            active.push({ row, y: tileY });
          } else if (since === 7) this.animateLoc(SPEAR_STATUE, statue, face, ANIMATION.SPEAR_END);
        }
      }
    });
    for (const player of this.challengePlayers()) {
      const location = player.getLocation();
      const caught = active.some(({ row, y }) => location.getY() === y
        && location.getX() >= row.x + SPEAR_REACH.FROM && location.getX() <= row.x + SPEAR_REACH.TO);
      if (caught) this.trapHit(player, "spear");
    }
  }

  animateLoc(id, tile, face, animation) {
    const { GameObject, Animation } = Shared.core();
    const object = new GameObject(id, Shared.loc({ ...tile, z: 0 }), 10, face, null);
    for (const player of this.roomPlayers()) player.getPacketSender().sendObjectAnimation(object, new Animation(animation));
  }

  // -------------------------------------------------------------- crocodiles

  spawnCrocodile(tile) {
    const { NpcIdentifiers } = Shared.core();
    const crocodile = this.spawn(NpcIdentifiers.CROCODILE_5, { ...tile, z: 0 }, { scale: false, points: 1 });
    if (!crocodile) return;
    crocodile.__toaCrocodile = { attackTicks: 0, wakeAt: Shared.cycle() + CROCODILE_WAKE_TICKS, attackers: new Set() };
    crocodile.setPositionToFace(this.palm.getLocation().transform(1, 1));
    this.crocodiles.add(crocodile);
  }

  /** Only someone without a container who hit it is worth chasing once nobody nearby carries water. */
  mayRetaliate(crocodile, player) {
    return crocodile.__toaCrocodile.attackers.has(player) && !player.getInventory().contains(CONTAINER)
      && this.challengePlayers().includes(player);
  }

  /** They go for anyone carrying water close by, otherwise drink from a watered palm. */
  tickCrocodiles() {
    const { Animation } = Shared.core();
    for (const crocodile of [...this.crocodiles]) {
      if (crocodile.getHitpoints() <= 0 || crocodile.isRegistered?.() === false) {
        this.crocodiles.delete(crocodile);
        continue;
      }
      const state = crocodile.__toaCrocodile;
      if (state.wakeAt > Shared.cycle()) {
        crocodile.getCombat().reset();
        continue;
      }
      const carrier = this.challengePlayers().find((player) =>
        this.waterOf(player) > 0 && player.getLocation().getDistance(crocodile.getLocation()) <= CROCODILE_SIGHT);
      if (carrier) {
        if (crocodile.getCombat().getTarget?.() !== carrier) crocodile.getCombat().attack(carrier);
        continue;
      }
      const target = crocodile.getCombat().getTarget?.();
      if (this.watered <= 0) {
        if (target && !this.mayRetaliate(crocodile, target)) crocodile.getCombat().reset();
        continue;
      }
      if (target) crocodile.getCombat().reset();
      if (!besidePalm(crocodile, this.palm)) {
        // A step every other tick (223/00014 ticks 192-206).
        if ((Shared.cycle() - state.wakeAt) % CROCODILE_STEP_TICKS === 0) this.stepToPalm(crocodile);
      } else if (--state.attackTicks <= 0) {
        crocodile.setPositionToFace(this.palm.getLocation().transform(2, 2));
        state.attackTicks = CROCODILE_ATTACK_TICKS;
        crocodile.performAnimation(new Animation(ANIMATION.CROCODILE_BITE));
        this.areaSound(SOUND.CROCODILE_BITE, crocodile.getLocation(), 0, SOUND_RADIUS.CROCODILE_BITE);
        this.biteFromPalm();
      }
    }
  }

  stepToPalm(crocodile) {
    const spot = palmApproach(crocodile, this.palm);
    const location = crocodile.getLocation();
    const dx = Math.sign(spot.x - location.getX());
    const dy = Math.sign(spot.y - location.getY());
    for (const [sx, sy] of [[dx, dy], [dx, 0], [0, dy]]) {
      if (sx === 0 && sy === 0) continue;
      const next = location.transform(sx, sy);
      if (!Shared.floorFree(this.area, next)) continue;
      const movement = crocodile.getMovementQueue();
      movement.reset();
      movement.addSteps(next);
      return;
    }
  }

  /** A bite on the palm; the first ends the chance of Perfect Crondis. */
  biteFromPalm() {
    const extra = this.teamSize - 1;
    const min = PALM_BITE.MIN + Math.floor(PALM_BITE.MIN_PER_PLAYER * extra);
    const amount = Shared.random(min, PALM_BITE.MAX + PALM_BITE.MAX_PER_PLAYER * extra);
    this.watered = Math.max(0, this.watered - amount);
    this.palmSplat(amount, SPLAT.BITE);
    this.updatePalm();
    this.raid.failTask(PERFECT, "A crocodile got to the tree.");
  }

  /** A crocodile's bite: harder if you were just hit by acid or a spear; prayer only takes a third off. */
  crocodileBite(npc, player, method) {
    const now = Shared.cycle();
    const hits = this.recentHits.get(player) ?? {};
    hits.at = (hits.at ?? []).filter((cycle) => now - cycle < HAZARD_WINDOW_TICKS);
    let damage = Math.min(CROCODILE_BITE_MAX, CROCODILE_BITE + CROCODILE_BITE_PER_HAZARD * hits.at.length);
    const hit = this.styledHit(npc, player, method, "melee", damage, 0, { prayable: false, scale: false });
    if (!hit.isAccurate()) return hit;
    if (Shared.isProtected(player, "melee")) {
      damage = Math.floor(damage / 3);
      const { Skill } = Shared.core();
      player.getSkillManager().decreaseCurrentLevel(Skill.PRAYER, 12, 0);
    }
    for (const part of hit.getHits()) part.setDamage(damage);
    hit.updateTotalDamage();
    if (damage > 0) this.spill(player);
    return hit;
  }

  graphic(id, tile, options = {}) {
    const viewer = this.roomPlayers()[0];
    if (viewer) Shared.graphicAt(viewer, id, Shared.loc({ x: tile.x, y: tile.y, z: 0 }), options);
  }
}

/** The crocodile's footprint touches the palm's along a side (223/00014 tick 207: at 3938,5276). */
function besidePalm(crocodile, palm) {
  const c = crocodile.getLocation();
  const p = palm.getLocation();
  const cs = crocodile.getSize();
  const ps = palm.getSize();
  const xOverlap = c.getX() < p.getX() + ps && c.getX() + cs > p.getX();
  const yOverlap = c.getY() < p.getY() + ps && c.getY() + cs > p.getY();
  const xTouch = c.getX() + cs === p.getX() || c.getX() === p.getX() + ps;
  const yTouch = c.getY() + cs === p.getY() || c.getY() === p.getY() + ps;
  return (xOverlap && yTouch) || (yOverlap && xTouch);
}

/** The nearest spot beside the palm, on the side the crocodile comes from (227/01844 tick 661: at 3939,5277). */
function palmApproach(crocodile, palm) {
  const c = crocodile.getLocation();
  const p = palm.getLocation();
  const cs = crocodile.getSize();
  const ps = palm.getSize();
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const gapX = Math.max(p.getX() - (c.getX() + cs - 1), c.getX() - (p.getX() + ps - 1));
  const gapY = Math.max(p.getY() - (c.getY() + cs - 1), c.getY() - (p.getY() + ps - 1));
  if (gapX >= gapY) {
    return { x: clamp(c.getX(), p.getX() - cs, p.getX() + ps), y: clamp(c.getY(), p.getY() - cs + 1, p.getY() + ps - 1) };
  }
  return { x: clamp(c.getX(), p.getX() - cs + 1, p.getX() + ps - 1), y: clamp(c.getY(), p.getY() - cs, p.getY() + ps) };
}

function crondisRoom(player) {
  const room = Raid.roomOf(player);
  return room instanceof CrondisPuzzleRoom && !room.destroyed ? room : null;
}

// ------------------------------------------------------------------ hooks

function useWaterfall(event) {
  const room = crondisRoom(event.player);
  if (!room || (event.objectId !== WATERFALL_FULL && event.objectId !== WATERFALL_EMPTY)) return false;
  room.fillAt(event.player, event.object);
  return true;
}

function waterPalm({ player }) {
  const room = crondisRoom(player);
  if (!room) return false;
  room.waterPalm(player);
  return true;
}

function containerOnPalm(event) {
  if (event.itemId !== CONTAINER || !event.target?.__toaPalm) return;
  const room = crondisRoom(event.player);
  if (!room) return;
  event.handled = true;
  room.waterPalm(event.player);
}

function containerOnWaterfall(event) {
  if (event.itemId !== CONTAINER) return;
  const room = crondisRoom(event.player);
  if (!room || (event.objectId !== WATERFALL_FULL && event.objectId !== WATERFALL_EMPTY)) return;
  event.handled = true;
  room.fillAt(event.player, event.object);
}

function checkContainer({ player }) {
  const room = crondisRoom(player);
  player.sendMessage(`Your water container is at ${room ? room.waterOf(player) : 0}% capacity.`);
}

function emptyContainer({ player }) {
  const room = crondisRoom(player);
  if (!room || room.waterOf(player) <= 0) {
    player.sendMessage("It's already empty.");
    return;
  }
  Shared.options(player, "Empty water container",
    "Yes, empty water container.", () => {
      room.setWater(player, 0);
      player.sendMessage("You empty your water container.");
    },
    "No.", () => {});
}

/** Taking a container leaves the floor one in place, for refills after a death. */
function takeContainer(event) {
  if (event.groundItem?.getItem?.()?.getId?.() !== CONTAINER) return;
  const room = crondisRoom(event.player);
  if (!room) return;
  event.handled = true;
  const { player } = event;
  if (room.isCompleted()) {
    player.sendMessage("You don't need a container right now.");
  } else if (player.getInventory().contains(CONTAINER)) {
    player.sendMessage("You already have a container.");
  } else if (player.getInventory().getFreeSlots() < 1) {
    player.sendMessage("You do not have enough space to pick this up.");
  } else {
    player.getInventory().adds(CONTAINER, 1);
    Shared.sound(player, SOUND.TAKE);
    player.performAnimation(new (Shared.core().Animation)(ANIMATION.FILL));
  }
}

/** Remembers who hit a crocodile, for when it may turn on them. */
function crocodileStruck(event) {
  const state = event.target?.__toaCrocodile;
  if (state && event.player) state.attackers.add(event.player);
}

module.exports = function registerCrondisPuzzle(api) {
  Shared.bind(api);
  Raid.registerRoom("CRONDIS_PUZZLE", CrondisPuzzleRoom);
  Raid.registerRaidItems(CONTAINER);
  Shared.onObject(api, "Waterfall", useWaterfall);
  api.onNpcInteraction("<col=00ffff>Palm of Resourcefulness</col>", { Water: waterPalm });
  api.onItemOnNpc(containerOnPalm);
  api.onItemOnObject(containerOnWaterfall);
  api.onItemAction("Water container", { Check: checkContainer, Empty: emptyContainer });
  api.onPlayerDealtDamage(crocodileStruck);
  api.onGroundItemPickup(takeContainer);
  registerCrocodileCombat(api);
};

function registerCrocodileCombat(api) {
  const { CombatMethod, CombatType, Animation, NpcIdentifiers } = api.core;

  class CrondisCrocodileCombatMethod extends CombatMethod {
    type() {
      return CombatType.MELEE;
    }

    attackSpeed() {
      return CROCODILE_ATTACK_TICKS;
    }

    start(npc) {
      const animation = npc.getAttackAnim?.();
      if (animation >= 0) npc.performAnimation(new Animation(animation));
    }

    hits(npc, target) {
      const room = npc.__toaRoom;
      if (!(room instanceof CrondisPuzzleRoom) || !target.isPlayer?.()) return [];
      return [room.crocodileBite(npc, target, this)];
    }
  }

  api.registerNpcCombatMethodProvider(NpcIdentifiers.CROCODILE_5, CrondisCrocodileCombatMethod);
}
