"use strict";

/**
 * Path of Het, Test of Strength: a beam from the caster statue must be bounced off mirrors
 * onto the shield statue. That weakens Het's seal for a while; mine it with a pickaxe before
 * the walls rise again in a new layout. Orbs roll across the floor throughout.
 * Wiki: https://oldschool.runescape.wiki/w/Path_of_Het#Puzzle_room
 */

const Shared = require("./ToaShared");
const Raid = require("./ToaRaid");
const Mining = require("../../skills/Mining.plugin");

// Cache locs: walls rise as the id above their settled form, which is what they become.
const B1 = 45463; // breakable wall, rising
const B2 = 45465;
const R1 = 45459; // solid wall, rising
const R2 = 45461;
const MP = 45455; // mirror that can be picked up
const MS = 45456; // fixed mirror
const MIRROR_DIRTY = 45457;
const BROKEN_WALL = 45466;
const CASTER_STATUE = 45486;
const SHIELD_STATUE = 45485;
const BARRIER = 45135;
const PICKAXE_STAND = 45468;
const LOBBY_PICKAXE_CAVITY = 49566; // the same storage, by the lobby's scoreboard
const WALL_SHAPE = 10;
const MIRROR_SHAPE = 11;

const ORB_PAIRS = [
  [3671, 5285, "EAST"],
  [3670, 5282, "WEST"],
  [3672, 5287, "SOUTH"],
  [3670, 5282, "NORTH"],
  [3673, 5288, "SOUTH"],
  [3671, 5275, "WEST"],
  [3670, 5282, "EAST"],
  [3671, 5275, "NORTH"],
  [3678, 5290, "SOUTH"],
  [3670, 5278, "WEST"],
  [3673, 5288, "EAST"],
  [3670, 5278, "NORTH"],
  [3678, 5290, "EAST"],
  [3673, 5272, "WEST"],
  [3671, 5285, "SOUTH"],
  [3673, 5272, "NORTH"],
  [3672, 5287, "EAST"],
  [3675, 5271, "WEST"],
  [3683, 5290, "SOUTH"],
  [3675, 5271, "NORTH"],
  [3683, 5290, "WEST"],
  [3679, 5270, "WEST"],
  [3685, 5289, "SOUTH"],
  [3679, 5270, "NORTH"],
  [3685, 5289, "WEST"],
  [3682, 5270, "NORTH"],
  [3688, 5287, "SOUTH"],
  [3685, 5271, "NORTH"],
  [3688, 5287, "WEST"],
  [3685, 5271, "WEST"],
  [3687, 5288, "SOUTH"],
  [3687, 5272, "NORTH"],
  [3687, 5288, "WEST"],
  [3687, 5272, "WEST"],
  [3689, 5284, "SOUTH"],
  [3688, 5273, "NORTH"],
  [3689, 5284, "WEST"],
  [3688, 5273, "WEST"],
  [3690, 5282, "SOUTH"],
  [3688, 5275, "WEST"],
  [3690, 5282, "WEST"],
  [3688, 5275, "NORTH"],
];
// Each set: [object, shape, rotation, x, y].
const ROOM_SETS = [
  [
    [B2, 10, 2, 3671, 5277], [MP, 11, 1, 3675, 5271], [B1, 10, 0, 3672, 5277], [B1, 10, 2, 3673, 5277],
    [B1, 10, 0, 3674, 5277], [B2, 10, 0, 3675, 5277], [R2, 10, 1, 3678, 5274], [R1, 10, 1, 3678, 5275],
    [R1, 10, 3, 3678, 5276], [R1, 10, 1, 3678, 5277], [R2, 10, 3, 3678, 5278], [MS, 11, 0, 3674, 5273],
    [R2, 10, 2, 3674, 5282], [R1, 10, 2, 3675, 5282], [R1, 10, 2, 3676, 5282], [R1, 10, 2, 3677, 5282],
    [R2, 10, 0, 3678, 5282], [B2, 10, 2, 3676, 5285], [B1, 10, 0, 3677, 5285], [B1, 10, 0, 3678, 5285],
    [B1, 10, 0, 3679, 5285], [MS, 11, 1, 3673, 5286], [MP, 11, 3, 3675, 5289], [R2, 10, 2, 3680, 5275],
    [R1, 10, 2, 3681, 5275], [R1, 10, 2, 3682, 5275], [R1, 10, 2, 3683, 5275], [R2, 10, 0, 3684, 5275],
    [R2, 10, 2, 3682, 5278], [R1, 10, 2, 3683, 5278], [R1, 10, 2, 3684, 5278], [R1, 10, 2, 3685, 5278],
    [R2, 10, 0, 3686, 5278], [MS, 11, 3, 3684, 5273], [B2, 10, 2, 3685, 5284], [B1, 10, 2, 3686, 5284],
    [B1, 10, 2, 3687, 5284], [B2, 10, 0, 3680, 5285], [R2, 10, 1, 3682, 5282], [R1, 10, 3, 3682, 5283],
    [R1, 10, 3, 3682, 5284], [R1, 10, 3, 3682, 5285], [R2, 10, 3, 3682, 5286], [MS, 11, 2, 3685, 5285],
    [B1, 10, 0, 3688, 5284], [B2, 10, 0, 3689, 5284], [MP, 11, 2, 3689, 5285],
  ],
  [
    [R2, 10, 2, 3671, 5281], [MP, 11, 1, 3675, 5271], [B2, 10, 2, 3675, 5276], [B1, 10, 2, 3676, 5276],
    [B1, 10, 2, 3677, 5276], [B1, 10, 2, 3678, 5276], [B2, 10, 0, 3679, 5276], [MS, 11, 0, 3673, 5277],
    [R1, 10, 2, 3672, 5281], [R1, 10, 2, 3673, 5281], [R1, 10, 2, 3674, 5281], [R2, 10, 0, 3675, 5281],
    [R2, 10, 1, 3675, 5283], [R1, 10, 1, 3675, 5284], [R1, 10, 1, 3675, 5285], [R1, 10, 3, 3675, 5286],
    [R2, 10, 3, 3675, 5287], [B2, 10, 1, 3679, 5282], [B1, 10, 3, 3679, 5283], [B1, 10, 1, 3679, 5284],
    [B1, 10, 1, 3679, 5285], [B2, 10, 3, 3679, 5286], [MS, 11, 1, 3677, 5282], [MP, 11, 3, 3675, 5289],
    [B2, 10, 1, 3686, 5278], [B1, 10, 1, 3686, 5279], [R2, 10, 1, 3682, 5275], [R1, 10, 1, 3682, 5276],
    [R1, 10, 3, 3682, 5277], [R2, 10, 3, 3682, 5278], [B2, 10, 2, 3683, 5274], [B1, 10, 2, 3684, 5274],
    [B1, 10, 2, 3685, 5274], [B1, 10, 2, 3686, 5274], [B2, 10, 0, 3687, 5274], [MS, 11, 3, 3683, 5272],
    [R2, 10, 1, 3682, 5284], [R1, 10, 1, 3682, 5285], [R1, 10, 3, 3682, 5286], [R1, 10, 1, 3682, 5287],
    [R2, 10, 2, 3682, 5283], [R1, 10, 2, 3683, 5283], [R1, 10, 2, 3684, 5283], [R1, 10, 2, 3685, 5283],
    [R2, 10, 0, 3686, 5283], [B1, 10, 1, 3686, 5280], [B1, 10, 1, 3686, 5281], [B2, 10, 3, 3686, 5282],
    [R2, 10, 3, 3682, 5288], [MS, 11, 3, 3689, 5280], [MP, 11, 2, 3689, 5285],
  ],
  [
    [MP, 11, 1, 3675, 5271], [R2, 10, 2, 3678, 5278], [R1, 10, 2, 3679, 5278], [MS, 11, 0, 3673, 5277],
    [R2, 10, 1, 3674, 5281], [R1, 10, 3, 3674, 5282], [R1, 10, 1, 3674, 5283], [R1, 10, 3, 3674, 5284],
    [R2, 10, 3, 3674, 5285], [R2, 10, 2, 3676, 5285], [R1, 10, 0, 3677, 5285], [R1, 10, 0, 3678, 5285],
    [R1, 10, 0, 3679, 5285], [MP, 11, 3, 3675, 5289], [R1, 10, 0, 3680, 5278], [R1, 10, 2, 3681, 5278],
    [R1, 10, 0, 3682, 5278], [R1, 10, 2, 3683, 5278], [R1, 10, 2, 3684, 5278], [R1, 10, 0, 3685, 5278],
    [R1, 10, 2, 3686, 5278], [R2, 10, 0, 3687, 5278], [R2, 10, 1, 3687, 5279], [R2, 10, 1, 3682, 5272],
    [R1, 10, 3, 3682, 5273], [R1, 10, 3, 3682, 5274], [R2, 10, 3, 3682, 5275], [MS, 11, 3, 3686, 5279],
    [R2, 10, 0, 3680, 5285], [R1, 10, 3, 3687, 5280], [R1, 10, 1, 3687, 5281], [R1, 10, 1, 3687, 5282],
    [R2, 10, 3, 3687, 5283], [B2, 10, 1, 3681, 5284], [B1, 10, 1, 3681, 5285], [B1, 10, 1, 3681, 5286],
    [B2, 10, 3, 3681, 5287], [B2, 10, 1, 3683, 5284], [B1, 10, 1, 3683, 5285], [B1, 10, 1, 3683, 5286],
    [B2, 10, 3, 3683, 5287], [B2, 10, 2, 3680, 5282], [B1, 10, 0, 3681, 5282], [B1, 10, 0, 3682, 5282],
    [B1, 10, 2, 3683, 5282], [B1, 10, 0, 3684, 5282], [B2, 10, 0, 3685, 5282], [B2, 10, 2, 3685, 5286],
    [B1, 10, 0, 3686, 5286], [B1, 10, 2, 3687, 5286], [B2, 10, 0, 3688, 5286], [MS, 11, 2, 3689, 5284],
    [MS, 11, 1, 3688, 5282], [MP, 11, 2, 3689, 5285],
  ],
  [
    [B2, 10, 2, 3671, 5277], [MP, 11, 1, 3675, 5271], [B1, 10, 2, 3672, 5277], [B1, 10, 2, 3673, 5277],
    [B1, 10, 0, 3674, 5277], [B2, 10, 0, 3675, 5277], [B2, 10, 1, 3678, 5274], [B1, 10, 1, 3678, 5275],
    [B1, 10, 3, 3678, 5276], [B1, 10, 3, 3678, 5277], [B2, 10, 3, 3678, 5278], [MS, 11, 1, 3675, 5273],
    [R2, 10, 2, 3674, 5282], [R1, 10, 0, 3675, 5282], [R1, 10, 0, 3676, 5282], [R1, 10, 0, 3677, 5282],
    [R2, 10, 0, 3678, 5282], [R2, 10, 2, 3676, 5285], [R1, 10, 2, 3677, 5285], [R1, 10, 0, 3678, 5285],
    [R1, 10, 2, 3679, 5285], [MS, 11, 1, 3673, 5280], [MP, 11, 3, 3675, 5289], [R2, 10, 2, 3680, 5275],
    [R1, 10, 0, 3681, 5275], [R1, 10, 0, 3682, 5275], [R1, 10, 0, 3683, 5275], [R2, 10, 0, 3684, 5275],
    [R2, 10, 2, 3682, 5278], [R1, 10, 0, 3683, 5278], [R1, 10, 2, 3684, 5278], [R1, 10, 0, 3685, 5278],
    [R2, 10, 0, 3686, 5278], [MS, 11, 2, 3684, 5277], [B2, 10, 2, 3685, 5284], [B1, 10, 0, 3686, 5284],
    [B1, 10, 2, 3687, 5284], [R2, 10, 0, 3680, 5285], [R2, 10, 1, 3682, 5282], [R1, 10, 3, 3682, 5283],
    [R1, 10, 3, 3682, 5284], [R1, 10, 3, 3682, 5285], [R2, 10, 3, 3682, 5286], [MS, 11, 2, 3687, 5281],
    [B1, 10, 2, 3688, 5284], [B2, 10, 0, 3689, 5284], [MP, 11, 2, 3689, 5285],
  ],
  [
    [R2, 10, 2, 3671, 5281], [MP, 11, 1, 3675, 5271], [B2, 10, 2, 3675, 5276], [B1, 10, 0, 3676, 5276],
    [B1, 10, 0, 3677, 5276], [B1, 10, 0, 3678, 5276], [B2, 10, 0, 3679, 5276], [MS, 11, 0, 3675, 5273],
    [R1, 10, 0, 3672, 5281], [R1, 10, 0, 3673, 5281], [R1, 10, 0, 3674, 5281], [R2, 10, 0, 3675, 5281],
    [R2, 10, 1, 3675, 5283], [R1, 10, 1, 3675, 5284], [R1, 10, 1, 3675, 5285], [R1, 10, 1, 3675, 5286],
    [R2, 10, 3, 3675, 5287], [B2, 10, 1, 3679, 5282], [B1, 10, 1, 3679, 5283], [B1, 10, 1, 3679, 5284],
    [B1, 10, 1, 3679, 5285], [B2, 10, 3, 3679, 5286], [MP, 11, 3, 3675, 5289], [B2, 10, 1, 3686, 5278],
    [B1, 10, 1, 3686, 5279], [R2, 10, 1, 3682, 5275], [R1, 10, 3, 3682, 5276], [R1, 10, 3, 3682, 5277],
    [R2, 10, 3, 3682, 5278], [B2, 10, 2, 3683, 5274], [B1, 10, 0, 3684, 5274], [B1, 10, 2, 3685, 5274],
    [B1, 10, 2, 3686, 5274], [B2, 10, 0, 3687, 5274], [MS, 11, 1, 3684, 5276], [R2, 10, 1, 3682, 5284],
    [R1, 10, 1, 3682, 5285], [R1, 10, 3, 3682, 5286], [R1, 10, 3, 3682, 5287], [R2, 10, 2, 3682, 5283],
    [R1, 10, 2, 3683, 5283], [R1, 10, 2, 3684, 5283], [R1, 10, 2, 3685, 5283], [R2, 10, 0, 3686, 5283],
    [B1, 10, 1, 3686, 5280], [B1, 10, 3, 3686, 5281], [B2, 10, 3, 3686, 5282], [R2, 10, 3, 3682, 5288],
    [MS, 11, 3, 3688, 5276], [MS, 11, 2, 3688, 5286], [MP, 11, 2, 3689, 5285],
  ],
];

const SEAL_TILE = { x: 3679, y: 5279, z: 0 };
const CASTER_TILE = { x: 3676, y: 5279, z: 0 };
const SHIELD_TILE = { x: 3682, y: 5279, z: 0 };
const BEAM_START = { x: 3676, y: 5280, z: 0 };
const SHIELD_HIT_TILE = { x: 3683, y: 5280, z: 0 };
const ROOF_TILES = [{ x: 3678, y: 5275 }, { x: 3676, y: 5277 }, { x: 3674, y: 5275 }, { x: 3677, y: 5283 }, { x: 3674, y: 5283 }, { x: 3686, y: 5284 }];
const BARRIER_BASE = { x: 3669, y: 5279, z: 0 };

const SEAL_HEALTH_PER_PLAYER = 96;
const SEAL_POINTS = 2.5;
const WEAKENED_TICKS = 24;
const BEAM_INTERVAL = 9;
const ORB_INTERVAL = 7;
const BEAM_MAX_LENGTH = 200;

const DIRECTION = {
  NORTH: [0, 1], SOUTH: [0, -1], EAST: [1, 0], WEST: [-1, 0],
  NORTH_EAST: [1, 1], NORTH_WEST: [-1, 1], SOUTH_EAST: [1, -1], SOUTH_WEST: [-1, -1],
};
// A mirror's rotation is the diagonal it faces.
const MIRROR_FACING = ["NORTH_EAST", "SOUTH_EAST", "SOUTH_WEST", "NORTH_WEST"];
const BEAM_GRAPHIC = {
  horizontal: 2114, vertical: 2064, SOUTH_EAST: 2116, SOUTH_WEST: 2117, NORTH_WEST: 2118, NORTH_EAST: 2119, end: 2120,
};
const GRAPHIC = { ROOF: 60, SHIELD_HIT: 732, ORB_WARNING: 382, ORB_BURST: 379, SEAL_PROTECTED: 2122 };
const ANIMATION = { SLIDE: 1114, PICK_UP: 827, PUSH: 810, TAKE: 832 };
const SOUND = { BEAM: 6540, BEAM_HIT: 6546, ROOF: 6542, STATUE: 2655, WALLS: 6535, END: 6539, MIRROR: 6543, PICK: 2581, PUSH: 86, PLACE: 2739, WALL_MINED: 6547, SEAL_HIT: 3600 };
const ATTR_STORED_PICKAXE = "toa:stored-pickaxe";
const VARBIT_PICKAXE_STORED = 14440; // TOA_PICKAXE_STORED
const BRONZE_PICKAXE = 1265;
/** In the cavity multiloc's order (varbit value - 1), as OpenRune lists them. */
const STORABLE_PICKAXES = [
  1267, 1269, 12297, 1273, 1271, 1275, 23276, // iron, steel, black, mithril, adamant, rune, gilded
  11920, 12797, 23677, 13243, 13244, 20014, // dragon, dragon (or), zalcano's, infernal (and empty), 3rd age
  23680, 23682, 25112, 25063, 25369, 25376, // crystal (and inactive), the trailblazers
  30345, 30346, 30351, // the trailblazer reloaded pickaxes
];

class HetPuzzleRoom extends Raid.Room {
  build() {
    const { NpcIdentifiers } = Shared.core();
    this.layout = new Map();
    this.orbs = new Set();
    this.weakenedTicks = 0;
    this.risingTicks = 0;
    this.beamTicks = BEAM_INTERVAL;
    this.orbTicks = ORB_INTERVAL;
    this.rotation = Shared.random(0, ROOM_SETS.length - 1);
    this.orbIndex = Shared.random(0, ORB_PAIRS.length - 1);
    this.weakenPending = false;
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
    const base = this.seal.getDefinition().getHitpoints();
    const hitpoints = base + SEAL_HEALTH_PER_PLAYER * (this.teamSize - 1);
    this.seal.setMaxHitpoints(hitpoints);
    this.seal.setHitpoints(hitpoints);
    this.raiseWalls();
    this.openBossHud(this.seal);
  }

  onComplete() {
    this.clearLayout();
    this.takeMirrors();
    for (const player of this.challengePlayers()) Shared.sound(player, SOUND.END);
    for (let i = 0; i < 3; i++) this.setObject(-1, { x: BARRIER_BASE.x, y: BARRIER_BASE.y + i, z: 0 }, WALL_SHAPE);
    for (const orb of this.orbs) this.despawn(orb);
    this.orbs.clear();
  }

  onReset() {
    this.clearLayout();
    this.takeMirrors();
    for (const orb of this.orbs) this.despawn(orb);
    this.despawn(this.seal);
    this.build();
  }

  takeMirrors() {
    for (const player of this.roomPlayers()) player.getInventory().delete(MIRROR_ITEM, 28);
  }

  // -------------------------------------------------------------- layout

  /** Walls and mirrors rise from the floor in the next layout; anyone in the way slides off. */
  raiseWalls() {
    this.risingTicks = 2;
    for (const player of this.roomPlayers()) Shared.sound(player, SOUND.WALLS);
    for (const [id, shape, rotation, x, y] of ROOM_SETS[this.rotation]) {
      const placed = this.teamSize > 1 && id === MS && Shared.random(0, 1) === 0 ? MIRROR_DIRTY : id;
      this.placeLayout({ x, y, z: 0 }, placed, shape, rotation);
    }
    for (const player of this.challengePlayers()) {
      const location = player.getLocation();
      if (this.layout.has(key(location.getX(), location.getY()))) this.slideOff(player);
    }
    this.rotation = (this.rotation + 1) % ROOM_SETS.length;
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
          const { Animation } = Shared.core();
          player.performAnimation(new Animation(ANIMATION.SLIDE));
          Shared.knockback(player, x, y, { ticks: 1, speed: 29 });
          return;
        }
      }
    }
  }

  // -------------------------------------------------------------- tick

  tick() {
    if (!this.isStarted()) return;
    if (--this.orbTicks <= 0) {
      this.orbTicks = ORB_INTERVAL;
      this.spawnOrb();
      this.spawnOrb();
    }
    this.moveOrbs();
    if (this.weakenedTicks > 0 && --this.weakenedTicks <= 0) {
      this.seal.setNpcTransformationId(-1);
      this.raiseWalls();
    }
    if (this.weakenPending) {
      this.weakenPending = false;
      this.weaken();
    }
    if (this.weakenedTicks <= 0 && this.risingTicks <= 0 && --this.beamTicks <= 0) {
      this.beamTicks = BEAM_INTERVAL;
      this.fireBeam();
    }
    if (this.risingTicks > 0 && --this.risingTicks <= 0) {
      // Walls finish rising into their settled ids.
      for (const entry of this.layout.values()) {
        if (entry.id === MP || entry.id === MS || entry.id === MIRROR_DIRTY) continue;
        entry.id -= 1;
        this.setObject(entry.id, { x: entry.x, y: entry.y, z: 0 }, entry.shape, entry.rotation);
      }
    }
  }

  /** The beam hit the shield statue: the seal can be mined until the walls come back. */
  weaken() {
    const { NpcIdentifiers } = Shared.core();
    this.weakenedTicks = WEAKENED_TICKS;
    for (const player of this.challengePlayers()) {
      player.sendMessage("<col=185820>The statue has been struck! The seal weakens!</col>");
      player.sendMessage("The room begins to shake violently!");
      Shared.sound(player, SOUND.STATUE);
    }
    this.graphic(GRAPHIC.SHIELD_HIT, SHIELD_HIT_TILE, { height: 254 });
    this.seal.setNpcTransformationId(NpcIdentifiers.COL_00FFFF_HETS_SEAL_WEAKENED_COL);
    this.takeMirrors();
    this.clearLayout();
    for (const player of this.roomPlayers()) Shared.sound(player, SOUND.ROOF);
    for (const tile of ROOF_TILES) this.graphic(GRAPHIC.ROOF, tile, { delay: 15 });
  }

  canDestroySeal() {
    return this.weakenedTicks > 0;
  }

  /** Traces the beam west from the caster statue, turning at mirrors. */
  fireBeam() {
    for (const player of this.roomPlayers()) Shared.sound(player, SOUND.BEAM);
    let x = BEAM_START.x;
    let y = BEAM_START.y;
    let direction = "WEST";
    for (let i = 0; i < BEAM_MAX_LENGTH; i++) {
      x += DIRECTION[direction][0];
      y += DIRECTION[direction][1];
      const delay = 1 + i;
      for (const player of this.challengePlayers()) {
        const location = player.getLocation();
        if (location.getX() === x && location.getY() === y) {
          Shared.later(this.taskKey, 1, () => Shared.damage(player, Math.floor(this.raid.damageFactor(0) * 5) + Shared.random(0, 3)));
        }
      }
      const blocker = this.blockerAt(x, y);
      const hitsShield = inside3x3(SHIELD_TILE, x, y);
      if (!blocker && !inside3x3(CASTER_TILE, x, y) && !inside3x3(SEAL_TILE, x, y) && !hitsShield) {
        this.beamGraphic(x, y, direction, delay);
        continue;
      }
      if (blocker && (blocker.id === MP || blocker.id === MS)) {
        const turned = this.turn(MIRROR_FACING[blocker.rotation & 3], direction);
        if (turned) {
          this.beamGraphic(x, y, MIRROR_FACING[blocker.rotation & 3], delay);
          direction = turned;
          continue;
        }
      }
      if (hitsShield) this.weakenPending = true;
      this.beamGraphic(x, y, null, delay - 1);
      break;
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
    this.graphic(id, { x, y }, { delay, height: 255 });
  }

  graphic(id, tile, options = {}) {
    const viewer = this.roomPlayers()[0];
    if (viewer) Shared.graphicAt(viewer, id, Shared.loc({ x: tile.x, y: tile.y, z: 0 }), options);
  }

  // -------------------------------------------------------------- orbs

  spawnOrb() {
    const [x, y, direction] = ORB_PAIRS[this.orbIndex];
    this.orbIndex = (this.orbIndex + 1 + Shared.random(0, ORB_PAIRS.length - 2)) % ORB_PAIRS.length;
    this.graphic(GRAPHIC.ORB_WARNING, { x, y });
    this.later(3, () => {
      const { NpcIdentifiers } = Shared.core();
      const orb = this.spawn(NpcIdentifiers.COL_00FFFF_ORB_OF_DARKNESS_COL, { x, y, z: 0 }, { scale: false, points: 0 });
      if (!orb) return;
      orb.__toaScripted = true;
      orb.__toaOrb = direction;
      orb.setUntargetable(true);
      this.graphic(GRAPHIC.ORB_BURST, { x, y });
      this.orbs.add(orb);
    });
  }

  /** Orbs roll one tile a tick until they hit something or someone. */
  moveOrbs() {
    for (const orb of [...this.orbs]) {
      const location = orb.getLocation();
      const victim = this.challengePlayers().find((player) => player.getLocation().equals(location));
      if (victim) {
        Shared.damage(victim, Math.floor(this.raid.damageFactor(0) * 5) + Shared.random(0, 3));
        this.burstOrb(orb);
        continue;
      }
      const [dx, dy] = DIRECTION[orb.__toaOrb];
      const next = location.transform(dx, dy);
      if (!Shared.floorFree(this.area, next) || this.layout.has(key(next.getX(), next.getY()))) {
        this.burstOrb(orb);
        continue;
      }
      orb.getMovementQueue().reset();
      Shared.core().PathFinder.calculateWalkRoute(orb, next.getX(), next.getY());
    }
  }

  burstOrb(orb) {
    this.graphic(GRAPHIC.ORB_BURST, { x: orb.getLocation().getX(), y: orb.getLocation().getY() });
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
      player.sendMessage("You clean the mirror.");
      entry.id = MS;
      this.setObject(MS, { x: entry.x, y: entry.y, z: 0 }, entry.shape, entry.rotation);
      Shared.sound(player, SOUND.PICK);
      player.performAnimation(new Animation(ANIMATION.PICK_UP));
      return;
    }
    if (entry.id !== MP) return;
    if (option === "Pick-up") {
      if (player.getInventory().getFreeSlots() < 1) {
        player.sendMessage("You don't have enough space in your inventory.");
        return;
      }
      this.removeLayout(entry.x, entry.y);
      Shared.sound(player, SOUND.PICK);
      player.performAnimation(new Animation(ANIMATION.PICK_UP));
      player.getInventory().adds(MIRROR_ITEM, 1);
    } else if (option === "Rotate-clockwise" || option === "Rotate-anticlockwise") {
      entry.rotation = (entry.rotation + (option === "Rotate-clockwise" ? 1 : 3)) % 4;
      this.setObject(MP, { x: entry.x, y: entry.y, z: 0 }, entry.shape, entry.rotation);
      Shared.sound(player, SOUND.MIRROR);
    } else if (option === "Push") {
      const dx = Math.sign(entry.x - player.getLocation().getX());
      const dy = Math.sign(entry.y - player.getLocation().getY());
      Shared.sound(player, SOUND.PUSH);
      player.performAnimation(new Animation(ANIMATION.PUSH));
      const target = { x: entry.x + dx, y: entry.y + dy, z: 0 };
      if (!this.layout.has(key(target.x, target.y)) && !this.objectAt(target, WALL_SHAPE) && Shared.floorFree(this.area, Shared.loc(target))) {
        this.removeLayout(entry.x, entry.y);
        this.placeLayout(target, MP, entry.shape, entry.rotation);
      }
    }
  }

  placeMirror(player, slot) {
    const location = player.getLocation();
    if (this.layout.has(key(location.getX(), location.getY())) || this.objectAt({ x: location.getX(), y: location.getY(), z: 0 }, WALL_SHAPE)) {
      player.sendMessage("You can't place that here.");
      return;
    }
    const { Animation } = Shared.core();
    player.getInventory().deleteAtSlot(slot, 1);
    Shared.sound(player, SOUND.PLACE);
    player.performAnimation(new Animation(ANIMATION.PICK_UP));
    this.placeLayout({ x: location.getX(), y: location.getY(), z: 0 }, MP, MIRROR_SHAPE, 0);
  }

  mineWall(player, object) {
    const pickaxe = Mining.findBestPickaxe(player);
    if (!pickaxe) {
      Shared.statement(player, "You need a pickaxe to do that. You do not have a pickaxe which you have the Mining level to use.");
      return;
    }
    const location = object.getLocation();
    player.performAnimation(pickaxe.animation);
    player.sendMessage("You swing your pick at the barrier.");
    this.later(2, () => {
      const entry = this.layout.get(key(location.getX(), location.getY()));
      if (!entry || (entry.id !== B1 - 1 && entry.id !== B2 - 1)) return;
      player.performAnimation(new (Shared.core().Animation)(-1));
      player.sendMessage("The barrier crumbles apart.");
      entry.id = BROKEN_WALL;
      this.setObject(BROKEN_WALL, { x: entry.x, y: entry.y, z: 0 }, entry.shape, entry.rotation);
      Shared.sound(player, SOUND.WALL_MINED);
      addMiningXp(player, 25);
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
    player.performAnimation(pickaxe.animation);
    const swing = () => {
      if (!this.isStarted() || !this.canDestroySeal() || this.seal.getHitpoints() <= 0) return false;
      if (player.getLocation().getDistance(this.seal.getLocation()) > 4 || player.getMovementQueue().size() > 0) return false;
      player.performAnimation(pickaxe.animation);
      Shared.sound(player, SOUND.SEAL_HIT);
      addMiningXp(player, 35);
      const damage = sealDamage(player, pickaxe) + Shared.random(0, 2);
      const dealt = Math.min(damage, this.seal.getHitpoints());
      this.raid.addPoints(player, dealt * SEAL_POINTS);
      this.seal.setHitpoints(this.seal.getHitpoints() - dealt);
      if (this.seal.getHitpoints() <= 0) this.sealBroken();
      return true;
    };
    if (swing()) Shared.repeat(player, 2, swing);
  }

  sealBroken() {
    const { NpcIdentifiers } = Shared.core();
    this.seal.setNpcTransformationId(NpcIdentifiers.COL_00FFFF_HETS_SEAL_WEAKENED_COL);
    this.seal.setHitpoints(1);
    this.seal.setUntargetable(true);
    this.complete();
  }
}

const MIRROR_ITEM = 27296;

function key(x, y) {
  return `${x},${y}`;
}

function inside3x3(corner, x, y) {
  return x >= corner.x && x <= corner.x + 2 && y >= corner.y && y <= corner.y + 2;
}

/** NR's table: better pickaxes and 85/100 Mining hit the seal harder. */
function sealDamage(player, pickaxe) {
  const { Skill, ItemIdentifiers } = Shared.core();
  const level = player.getSkillManager().getCurrentLevel(Skill.MINING);
  const tier = pickaxe.id === ItemIdentifiers.DRAGON_PICKAXE ? 2 : pickaxe.id === ItemIdentifiers.RUNE_PICKAXE ? 1 : 0;
  const table = [[5, 13, 14], [8, 15, 17], [10, 17, 19]][tier];
  return level >= 100 ? table[2] : level >= 85 ? table[1] : table[0];
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
  if (!room || (event.objectId !== B1 - 1 && event.objectId !== B2 - 1)) return false;
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

/**
 * The wall cavities (TOA_PICKAXE_STORED's multilocs, in Het's room and the lobby) keep one pickaxe per player, shown in the
 * wall by varbit 14440 (OpenRune #271): its value is the pickaxe's place in STORABLE_PICKAXES
 * plus one, 0 when empty. A bronze pickaxe isn't stored: Het provides one.
 */
function usePickaxeStand(event) {
  const { player, option } = event;
  if (!canReachCavity(player)) return false;
  if (option === "Take-pickaxe") takeStoredPickaxe(player);
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

function takeStoredPickaxe(player) {
  const stored = player.getAttribute(ATTR_STORED_PICKAXE);
  const { Animation, ItemDefinition } = Shared.core();
  if (!stored) return;
  if (heldPickaxes(player).length > 0) player.sendMessage("You already have a pickaxe.");
  else if (player.getInventory().getFreeSlots() < 1) player.sendMessage("You don't have any space in your inventory.");
  else {
    player.performAnimation(new Animation(ANIMATION.TAKE));
    player.getInventory().adds(stored, 1);
    setStoredPickaxe(player, null);
    player.sendMessage(`You take the ${ItemDefinition.forId(stored).getName()}.`);
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
  for (const clickType of [1, 2, 3, 4]) api.onObjectClick([MP, MIRROR_DIRTY], clickType, useMirrorObject);
  api.onObjectClick([B1 - 1, B2 - 1], 1, mineBarrier);
  for (const clickType of [1, 2]) api.onObjectClick([PICKAXE_STAND, LOBBY_PICKAXE_CAVITY], clickType, usePickaxeStandObject);
  api.onItemAction("Mirror", { Place: placeMirror });
  api.onNpcInteraction("<col=00ffff>Het's Seal (weakened)</col>", { Destroy: destroySeal });
  api.onNpcInteraction("<col=00ffff>Het's Seal (protected)</col>", { Destroy: destroySeal });
  api.onCanAttack(sealUnattackable);
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
