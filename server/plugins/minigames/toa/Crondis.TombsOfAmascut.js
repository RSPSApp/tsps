"use strict";

/**
 * Path of Crondis, Test of Resourcefulness: carry water from the waterfalls to the Palm of
 * Resourcefulness past acid trails, spear statues and crocodiles. Getting hit spills half
 * of what you carry; crocodiles also drink from the palm. The room ends once it is watered.
 * Wiki: https://oldschool.runescape.wiki/w/Path_of_Crondis#Puzzle_room
 */

const Shared = require("./ToaShared");
const Raid = require("./ToaRaid");

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
const SPEAR_DELAYS = [[0, 2, 4, 6, 8, 0, 2, 4, 6, 8], [0, 3, 6, 9, 2, 0, 3, 6, 9, 2], [2, 1, 1, 0, 0, 2, 2, 1, 1, 0], [0, 1, 2, 3, 4, 4, 3, 2, 1, 0]];
// The crocodiles come in from one of three sides, picked when the room is built; its wall
// openings (toa_wall02_crocodiles04) show which (OpenRune). Faces: 0 west, 1 north, 2 east, 3 south.
const CROCODILE_WALL = 45434;
const CROCODILE_SIDES = [
  {
    spawns: [{ x: 3946, y: 5274 }, { x: 3925, y: 5285 }, { x: 3946, y: 5285 }, { x: 3925, y: 5274 }],
    walls: [{ x: 3950, y: 5273, face: 0 }, { x: 3948, y: 5271, face: 1 }],
  },
  {
    spawns: [{ x: 3925, y: 5274 }, { x: 3946, y: 5285 }, { x: 3925, y: 5285 }, { x: 3946, y: 5274 }],
    walls: [{ x: 3922, y: 5273, face: 2 }, { x: 3924, y: 5271, face: 1 }],
  },
  {
    spawns: [{ x: 3925, y: 5285 }, { x: 3946, y: 5274 }, { x: 3925, y: 5274 }, { x: 3946, y: 5285 }],
    walls: [{ x: 3922, y: 5287, face: 2 }, { x: 3923, y: 5289, face: 3 }],
  },
];
const PALM_TILE = { x: 3934, y: 5278, z: 0 };
const END_BARRIER = { x: 3922, y: 5279 };

// Wiki (strategies): 175 water, and 125 more for each extra player.
const WATER_FIRST_PLAYER = 175;
const WATER_PER_EXTRA_PLAYER = 125;
const ACID_GRAPHIC = 2129;
const ANIMATION = { FILL: 827, SPEAR_END: 9562, MOUTH: 9563, SPEAR: 9565 };
const SOUND = { FILL: 6522, EMPTY: 6524, SPILL: 2401, WATER_PALM: 6534, PALM_UP: 6516, PALM_DOWN: 6529, TAKE: 2582 };
// A wave every 46-50 ticks (the first after a reset 10 sooner); they wake 4 ticks after
// coming in (OpenRune). Wiki: at most 8, they bite every 7 ticks, and go for anyone carrying
// water within reach, then a watered palm, then anyone without a container who hit them.
const CROCODILE_WAVE_TICKS = [46, 50];
const CROCODILE_RESET_SOONER = 10;
const CROCODILE_WAKE_TICKS = 4;
const CROCODILE_LIMIT = 8;
const CROCODILE_ATTACK_TICKS = 7;
const CROCODILE_SIGHT = 3;
// Wiki: 18, and 3 more for each acid or spear hit in the last 30 seconds, up to 36.
const CROCODILE_BITE = 18;
const CROCODILE_BITE_PER_HAZARD = 3;
const CROCODILE_BITE_MAX = 36;
const HAZARD_WINDOW_TICKS = 50;

class CrondisPuzzleRoom extends Raid.Room {
  build() {
    const { NpcIdentifiers } = Shared.core();
    this.water = new Map();
    this.watered = 0;
    this.goal = WATER_FIRST_PLAYER;
    this.acidTicks = 0;
    this.spearTick = 0;
    this.crocodileTicks = this.nextCrocodileWave();
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
    this.crocodileSide = CROCODILE_SIDES[Shared.random(0, CROCODILE_SIDES.length - 1)];
    for (const wall of this.crocodileSide.walls) this.setObject(CROCODILE_WALL, { x: wall.x, y: wall.y, z: 0 }, 10, wall.face);
  }

  nextCrocodileWave() {
    return Shared.random(CROCODILE_WAVE_TICKS[0], CROCODILE_WAVE_TICKS[1]) - 1;
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
    this.clear();
    for (let y = 0; y < 3; y++) this.setObject(-1, { x: END_BARRIER.x, y: END_BARRIER.y + y, z: 0 }, 10);
  }

  onReset() {
    this.clear();
    this.despawn(this.palm);
    for (const wall of this.crocodileSide.walls) this.setObject(-1, { x: wall.x, y: wall.y, z: 0 }, 10);
    this.build();
    this.crocodileTicks -= CROCODILE_RESET_SOONER;
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

  waterOf(player) {
    return this.water.get(player) ?? 0;
  }

  setWater(player, amount) {
    this.water.set(player, Math.max(0, Math.min(100, amount)));
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
    if (this.waterOf(player) >= 100) {
      player.sendMessage("Your container is full.");
      return;
    }
    const { Animation } = Shared.core();
    player.sendMessage("You fill your container.");
    Shared.sound(player, SOUND.FILL);
    player.performAnimation(new Animation(ANIMATION.FILL));
    player.setRunEnergy(Math.min(100, player.getRunEnergy() + 20));
    this.setWater(player, 100);
    const location = object.getLocation();
    const tile = { x: location.getX(), y: location.getY(), z: 0 };
    const face = object.getFace();
    this.setObject(WATERFALL_EMPTY, tile, 10, face);
    this.later(128 - (this.teamSize - 1) * 18, () => this.setObject(WATERFALL_FULL, tile, 10, face));
  }

  waterPalm(player) {
    const amount = this.waterOf(player);
    if (!player.getInventory().contains(CONTAINER) || amount < 1) {
      player.sendMessage("You have nothing to water the palm with.");
      return;
    }
    if (!this.isStarted()) return;
    const { Animation } = Shared.core();
    const size = amount > 50 ? "lot" : amount > 25 ? "reasonable amount" : "small amount";
    player.sendMessage(`You empty a ${size} of water onto the palm.`);
    player.performAnimation(new Animation(ANIMATION.FILL));
    Shared.sound(player, SOUND.WATER_PALM);
    this.setWater(player, 0);
    this.watered = Math.min(this.goal, this.watered + amount);
    this.raid.addPoints(player, amount);
    this.updatePalm();
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
      for (const player of this.roomPlayers()) Shared.sound(player, id > current ? SOUND.PALM_UP : SOUND.PALM_DOWN);
      this.palm.setNpcTransformationId(id === stages[0] ? -1 : id);
    }
    // The HUD fills as the palm is watered.
    this.palm.setHitpoints(Math.max(1, this.watered));
    if (stage === 4 && this.isStarted()) this.complete();
  }

  /** A hit on the way spills half of the water carried. */
  spill(player) {
    const amount = this.waterOf(player);
    if (amount <= 0) return;
    player.sendMessage("Water spills out of your container.");
    Shared.sound(player, SOUND.SPILL);
    this.setWater(player, amount - Math.ceil(amount / 2));
  }

  /** Acid and spears also sap Defence and Agility. */
  debuff(player) {
    const { Skill } = Shared.core();
    for (const skill of [Skill.DEFENCE, Skill.AGILITY]) player.getSkillManager().decreaseCurrentLevel(skill, 3, 0);
  }

  hurt(player, base, kind) {
    const now = Shared.cycle();
    const hits = this.recentHits.get(player) ?? {};
    if ((hits[kind] ?? -1) > now) return;
    hits[kind] = now + (kind === "acid" ? 2 : 3);
    hits.at = [...(hits.at ?? []), now];
    this.recentHits.set(player, hits);
    this.spill(player);
    const low = Math.floor(base * this.raid.damageFactor(0));
    Shared.damage(player, Shared.random(low, low + 8));
    this.debuff(player);
  }

  // -------------------------------------------------------------- tick

  tick() {
    for (const items of this.floorContainers.values()) for (const item of items) item.setTick(0);
    if (!this.isStarted()) return;
    this.acid = this.acid.filter((trail) => --trail.ticks > 0);
    for (const player of this.challengePlayers()) for (const trail of this.acid) this.checkAcid(player, trail);
    if (--this.acidTicks <= 0) {
      this.acidTicks = 5;
      this.spawnAcid(ACID_NORTH, false);
      this.spawnAcid(ACID_SOUTH, true);
    }
    this.tickSpears();
    this.spearTick = (this.spearTick + 1) % 10;
    if (this.crocodileTicks-- <= 0) {
      this.crocodileTicks = this.nextCrocodileWave();
      if (this.crocodiles.size < CROCODILE_LIMIT) {
        const spawns = this.crocodileSide.spawns;
        const count = Math.min(Math.ceil(this.teamSize / 2), spawns.length);
        for (let i = 0; i < count; i++) this.spawnCrocodile(spawns[i]);
      }
    }
    this.tickCrocodiles();
  }

  spawnAcid(bases, north) {
    for (const base of bases) {
      const offsets = Shared.shuffle([0, 1, 2, 3, 4]).slice(0, Shared.random(2, 3));
      for (const dx of offsets) {
        const tile = { x: base.x + dx, y: base.y, z: 0 };
        this.setObject(ACID, tile, 10, 0);
        this.later(3, () => this.setObject(-1, tile, 10));
        this.later(2, () => {
          const trail = { x: tile.x, y: tile.y, north, ticks: 6 };
          this.acid.push(trail);
          for (let step = 1; step <= 10; step++) {
            this.graphic(ACID_GRAPHIC, { x: tile.x, y: tile.y + (north ? step : -step) }, { delay: 10 * step });
          }
        });
      }
    }
  }

  /** The acid travels a tile every three client-ticks' worth; you're hit as it passes you. */
  checkAcid(player, trail) {
    const location = player.getLocation();
    if (location.getX() !== trail.x) return;
    const along = trail.north ? location.getY() - trail.y : trail.y - location.getY();
    if (along < 1 || along > 10) return;
    const reach = 1 + Math.floor((along - 1) / 3);
    if (trail.ticks < 6 - reach && trail.ticks >= 6 - reach - 2) this.hurt(player, 5, "acid");
  }

  tickSpears() {
    const active = [];
    SPEAR_ROWS.forEach((row, index) => {
      for (const east of [false, true]) {
        for (let y = 0; y < 5; y++) {
          const delay = SPEAR_DELAYS[index][y + (east ? 5 : 0)];
          const tileY = row.y + y * 2 + (east ? 1 : 0);
          const statue = { x: row.x + (east ? 7 : 0), y: tileY };
          const spear = { x: row.x + (east ? 4 : 2), y: tileY };
          const face = east ? 0 : 2;
          if (delay === this.spearTick) this.animateLoc(SPEAR_STATUE, statue, face, ANIMATION.MOUTH);
          else if ((delay + 3) % 10 === this.spearTick) this.animateLoc(SPEAR_STATUE + 1, spear, face, ANIMATION.SPEAR);
          else if ((delay + 4) % 10 === this.spearTick || (delay + 5) % 10 === this.spearTick) active.push(spear);
          else if ((delay + 6) % 10 === this.spearTick) {
            this.animateLoc(SPEAR_STATUE + 1, spear, face, ANIMATION.SPEAR_END);
            active.push(spear);
          } else if ((delay + 7) % 10 === this.spearTick) this.animateLoc(SPEAR_STATUE, statue, face, ANIMATION.SPEAR_END);
        }
      }
    });
    for (const player of this.challengePlayers()) {
      const location = player.getLocation();
      if (active.some((spear) => location.getY() === spear.y && location.getX() >= spear.x && location.getX() <= spear.x + 2)) {
        this.hurt(player, 6, "spear");
      }
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
    const { PathFinder } = Shared.core();
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
        if (crocodile.getMovementQueue().size() === 0) {
          const spot = palmApproach(crocodile, this.palm);
          PathFinder.calculateWalkRoute(crocodile, spot.x, spot.y);
        }
      } else if (--state.attackTicks <= 0) {
        crocodile.setPositionToFace(this.palm.getLocation().transform(2, 2));
        state.attackTicks = CROCODILE_ATTACK_TICKS;
        crocodile.performAnimation(new (Shared.core().Animation)(crocodile.getAttackAnim()));
        this.watered = Math.max(0, this.watered - Shared.random(2, 5));
        this.updatePalm();
      }
    }
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

/** The crocodile's footprint touches the palm's along a side (OpenRune #271). */
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

/** The nearest spot beside the palm, on the side the crocodile comes from (OpenRune #271). */
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
