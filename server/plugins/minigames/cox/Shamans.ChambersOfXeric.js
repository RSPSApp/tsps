"use strict";

/**
 * The Lizardman Shamans' room: shamans with their surface cousins' attacks - ranged, a poison
 * blob, a crushing jump and exploding spawns - and two spawns blocking the way on until the
 * shamans are dead.
 *
 * Wiki (Lizardman shaman (Chambers of Xeric); Lizardman shaman):
 * - Their attacks are the surface shamans' (melee max 31, ranged max 21, jump 20-25 on a 3x3,
 *   three spawns exploding for 5-10 by proximity on a 5x5), the poison blob ~25% stronger: 25-30
 *   on the surface, up to 39 here without Shayzien armour, poison from 12 (Strategies).
 * - By raid scale: 2 shamans at 1-4, 3 at 5-9, 4 at 10-14, 5 at 15+ (Strategies).
 * rsprox captures (recordings 3282 and 3389):
 * - The spirit tendrils (29768) and the exit's two blocking spawns (7575) are there when the
 *   room is loaded. Passing the tendrils is a two-tile walk through them with sound 3728.
 * - None attacks until attacked or close: raiders 11 and 12 tiles away were left alone, those
 *   attacked answered within 5 ticks.
 * - Ranged: 7193, projectile 1291 (from 61 client cycles to 61 + 5 a tile, angle 5, heights 420
 *   to 146; sound 385, range 10, at its centre), landing 3 ticks later. The acid: 7193, projectile
 *   1293 (from 61 to 150 at 8 tiles and 180 at 9, angle 30, heights 420 to 5), landing as gfx 1294
 *   with sound 1070 (range 8).
 * - Dying: 7196; gone 3 ticks later, with "The Lizardman Shaman slain by <name> dropped seeds for
 *   all.". 5 ticks after the last one starts dying the blocking
 *   spawns raise their hands (7159, sound 665), the tendrils go a tick later, and the spawns
 *   burst 3 ticks after that (gfx 1295, sound 1021, range 5).
 * - Tendril and blocker tiles fitted in both recordings (variant 1 turned 1, variant 2 turned 3).
 *   First-seen shaman tiles differ from the list by a few tiles; they wander, so can't settle it.
 * Not on the Wiki and not in any capture: the blob's 2 tile reach, poison 1 in 4; melee 7158
 *   (crush); the jump's animations (7152, landing 6946 beside its target, from the Molch shamans,
 *   then a pause); the spawns' timing (1 in 61 a tick, at most every 20 seconds; explode 6 ticks
 *   after appearing); the aggression range (8). No raid capture has a spawn, jump or melee.
 */

const Shared = require("./Shared.ChambersOfXeric");
const Raid = require("./RaidState.ChambersOfXeric");
const Monsters = require("./Monsters.ChambersOfXeric");
const Achievements = require("./CombatAchievements.ChambersOfXeric");

const NPC = { SHAMANS: [7573, 7574], SPAWN: 7575 };
const OBJECT = { TENDRIL: 29768 };
const BASE = { RANGED: 21, MELEE: 31 };
const BLOB = { MIN: 31, MAX: 39, POISON: 12 };
const SPAWN_BLAST = { RADIUS: 2, MIN: 5, MAX: 10, PER_TILE: 2.5 };
const AGGRESSION_RANGE = 8;
const ANIM = { RANGED: 7193, MELEE: 7158, JUMP: 7152, LAND: 6946, SPAWN_EXPLODE: 7159 };
const JUMP_TICKS = 6;
/** Shayzien armour (5): gloves, boots, helm, greaves, body. */
const SHAYZIEN = [13377, 13378, 13379, 13380, 13381];

/** Cache tiles by version. */
const SHAMAN_TILES = [
  [{ x: 3273, y: 5270 }, { x: 3281, y: 5269 }, { x: 3278, y: 5262 }, { x: 3273, y: 5255 }],
  [{ x: 3306, y: 5260 }, { x: 3306, y: 5267 }, { x: 3315, y: 5267 }, { x: 3316, y: 5259 }],
  [{ x: 3340, y: 5258 }, { x: 3346, y: 5259 }, { x: 3341, y: 5268 }, { x: 3347, y: 5270 }],
];
const TENDRIL_TILES = [[{ x: 3279, y: 5249 }, { x: 3280, y: 5249 }, { x: 3289, y: 5262 }, { x: 3289, y: 5261 }], [{ x: 3311, y: 5251 }, { x: 3310, y: 5251 }], [{ x: 3342, y: 5251 }, { x: 3343, y: 5251 }]];
const BLOCKER_TILES = [
  [[{ x: 3268, y: 5263 }, { x: 3269, y: 5263 }], [{ x: 3268, y: 5264 }, { x: 3269, y: 5264 }]],
  [[{ x: 3311, y: 5275 }, { x: 3311, y: 5274 }], [{ x: 3312, y: 5275 }, { x: 3312, y: 5274 }]],
  [[{ x: 3353, y: 5265 }, { x: 3352, y: 5265 }], [{ x: 3353, y: 5264 }, { x: 3352, y: 5264 }]],
];

/** Wiki: 2 at scale 1-4, 3 at 5-9, 4 at 10-14, 5 at 15+. */
function shamanCount(scale) {
  return scale < 5 ? 2 : scale < 10 ? 3 : scale < 15 ? 4 : 5;
}

/** The share of the blob a player takes: less for each Shayzien piece of the top tier worn. */
function blobShare(player) {
  const worn = player.getEquipment().getItems().filter((item) => SHAYZIEN.includes(item?.getId?.())).length;
  return worn >= 5 ? 0 : 1 - worn * 0.2;
}

class ShamansRoom extends Raid.Room {
  constructor(raid, record) {
    super(raid, record);
    this.shamans = [];
    this.blockers = [];
    this.tendrils = [];
    this.woken = false;
    this.hurt = new Set();
  }

  load() {
    const variant = this.record.variant;
    const spots = Shared.shuffle(SHAMAN_TILES[variant]);
    for (let i = 0; i < shamanCount(this.raid.scale); i++) {
      const spot = spots[i % spots.length];
      const shaman = this.spawnNpc(Shared.randomOf(NPC.SHAMANS), this.tile(spot.x, spot.y, 3), { wanderRadius: 3 });
      if (shaman) this.shamans.push(shaman);
    }
    this.tendrilTiles = TENDRIL_TILES[variant].map((spot) => this.tile(spot.x, spot.y));
    this.wake();
  }

  combatPoints() {
    return Math.floor(5 * this.shamans.reduce((sum, npc) => sum + npc.getMaxHitpoints(), 0) * 1.05);
  }

  living() {
    return this.shamans.filter((npc) => npc.isRegistered() && npc.getHitpoints() > 0);
  }

  tick() {
    for (const shaman of this.living()) {
      if (!shaman.__coxJumping) this.engageNearby(shaman);
      const target = shaman.getCombat().getTarget();
      if (target?.isPlayer?.() && !shaman.__coxJumping && Shared.random(0, 60) === 0 && !(shaman.__coxSpawnsAt > this.raid.ticks)) {
        shaman.__coxSpawnsAt = this.raid.ticks + 33;
        this.spawns(target.getAsPlayer());
      }
    }
  }

  /** rsprox captures: they leave raiders further off alone until attacked. */
  engageNearby(npc) {
    if (npc.getCombat().getTarget()) return;
    const near = this.raiders().filter((player) => player.getHitpoints() > 0 && player.getLocation().getDistance(npc.getLocation()) <= AGGRESSION_RANGE);
    if (near.length) this.engage(npc);
  }

  /** A strike that counts against Shayzien Specialist if it does any damage when it lands. */
  strike(npc, player, style, max, delay) {
    const hit = Shared.strike(npc, player, style, max, delay);
    Shared.later(this.raid, delay, () => {
      if (hit.getTotalDamage() > 0) this.hurt.add(player);
    });
  }

  /** Damage that isn't a strike: the blob, the jump, a spawn. */
  hurtBy(player, amount) {
    if (amount > 0) this.hurt.add(player);
    Shared.damage(player, amount);
  }

  wake() {
    this.woken = true;
    const { GameObject, ObjectManager } = Shared.core();
    this.tendrils = this.tendrilTiles.map((tile) => {
      const tendril = new GameObject(OBJECT.TENDRIL, tile, 10, 0, this.map);
      ObjectManager.register(tendril, true);
      return tendril;
    });
    for (const [at, face] of BLOCKER_TILES[this.record.variant]) {
      const blocker = this.spawnNpc(NPC.SPAWN, this.tile(at.x, at.y), { scale: false });
      if (!blocker) continue;
      blocker.getMovementQueue().setBlockMovement?.(true);
      blocker.setPositionToFace(this.tile(face.x, face.y));
      this.blockers.push(blocker);
    }
    this.blockerClip(true);
  }

  blockerClip(on) {
    const { RegionManager } = Shared.core();
    for (const blocker of this.blockers) {
      const at = blocker.getLocation();
      const args = [at.getX(), at.getY(), at.getZ(), RegionManager.BLOCKED_TILE, this.map];
      if (on) RegionManager.addClipping(...args);
      else RegionManager.removeClipping(...args);
    }
  }

  /** Three spawns by the target that explode. */
  spawns(player) {
    const { Location, RegionManager } = Shared.core();
    const at = player.getLocation();
    for (let i = 0; i < 3; i++) {
      let tile = at.clone();
      for (let tries = 0; tries < 20; tries++) {
        const candidate = new Location(at.getX() + Shared.random(-2, 2), at.getY() + Shared.random(-2, 2), at.getZ());
        if (!RegionManager.blocked(candidate, this.map)) {
          tile = candidate;
          break;
        }
      }
      const spawn = this.spawnNpc(NPC.SPAWN, tile, { scale: false });
      if (!spawn) continue;
      spawn.setPositionToFace(at);
      Shared.later(this.raid, 6, () => this.explode(spawn));
    }
  }

  /** Wiki (surface shamans): 5-10 by proximity, 2 tiles round. The exit's blockers do no harm. */
  explode(spawn, harmful = true, burstAfter = 2) {
    if (!spawn.isRegistered()) return;
    Shared.animate(spawn, ANIM.SPAWN_EXPLODE);
    Shared.areaSound(this.raiders(), 665, spawn.getLocation(), { range: 7 });
    Shared.later(this.raid, burstAfter, () => {
      if (!spawn.isRegistered()) return;
      Shared.graphicAt(this.raiders(), 1295, spawn.getLocation());
      Shared.areaSound(this.raiders(), 1021, spawn.getLocation(), { range: 5 });
      for (const player of harmful ? this.raiders() : []) {
        const tiles = player.getLocation().getDistance(spawn.getLocation());
        if (tiles <= SPAWN_BLAST.RADIUS) this.hurtBy(player, Math.max(SPAWN_BLAST.MIN, Math.floor(SPAWN_BLAST.MAX - tiles * SPAWN_BLAST.PER_TILE)));
      }
      this.removeNpc(spawn);
    });
  }

  adjacent(npc, player) {
    const at = npc.getLocation();
    const x = player.getLocation().getX() - at.getX();
    const y = player.getLocation().getY() - at.getY();
    const inX = x >= 0 && x < 3;
    const inY = y >= 0 && y < 3;
    return (inX && (y === -1 || y === 3)) || (inY && (x === -1 || x === 3));
  }

  attack(npc, player) {
    let style = Shared.random(0, this.adjacent(npc, player) ? 6 : 5);
    if (style === 5 && !this.jump(npc, player)) style = this.adjacent(npc, player) ? 6 : 4;
    if (style === 5) return;
    if (style === 6) Shared.sound(player, 1695);
    else Shared.areaSound(this.raiders(), 385, Shared.core().Projectile.centreOf(npc), { range: 10 });
    if (style === 6) {
      Shared.animate(npc, ANIM.MELEE);
      this.strike(npc, player, "melee", Monsters.maxHitFor(npc, BASE.MELEE, Monsters.LEVELS.STRENGTH), 0);
      return;
    }
    Shared.animate(npc, ANIM.RANGED);
    if (style === 4) {
      const tile = player.getLocation().clone();
      const delay = spit(this.map, npc, tile, 1293, 30, 1, (tiles) => (tiles <= 8 ? 150 : 180));
      Shared.later(this.raid, delay, () => {
        if (!npc.isRegistered()) return;
        Shared.graphicAt(this.raiders(), 1294, tile);
        Shared.areaSound(this.raiders(), 1070, tile, { range: 8 });
        const { CombatFactory } = Shared.core();
        for (const raider of this.raiders()) {
          if (raider.getLocation().getDistance(tile) > 2) continue;
          this.hurtBy(raider, Math.floor(Shared.random(BLOB.MIN, BLOB.MAX) * blobShare(raider)));
          if (Shared.random(0, 3) === 0) CombatFactory.poisonEntity(raider, BLOB.POISON);
        }
      });
      return;
    }
    const delay = spit(this.map, npc, player, 1291, 5, 36, (tiles) => 61 + 5 * tiles);
    this.strike(npc, player, "ranged", Monsters.maxHitFor(npc, BASE.RANGED, Monsters.LEVELS.RANGED), delay);
  }

  /** The jump: up, then down beside the target 4 ticks later, crushing those around. */
  jump(npc, player) {
    const { Location, RegionManager } = Shared.core();
    const at = player.getLocation();
    const landing = new Location(at.getX() - 1, at.getY() - 1, at.getZ());
    for (let dx = 0; dx < 3; dx++) {
      for (let dy = 0; dy < 3; dy++) {
        if (RegionManager.blocked(new Location(landing.getX() + dx, landing.getY() + dy, landing.getZ()), this.map)) return false;
      }
    }
    npc.__coxJumping = true;
    npc.getCombat().reset();
    // rsprox captures (the Molch shamans): up with 7152 and sound 2467; 6 ticks later down beside
    // the target with 6946 and sound 1695, the move and the landing on one tick.
    Shared.animate(npc, ANIM.JUMP);
    Shared.areaSound(this.raiders(), 2467, npc.getLocation(), { range: 8 });
    Shared.later(this.raid, JUMP_TICKS, () => {
      if (!npc.isRegistered()) return;
      npc.moveTo(landing);
      Shared.animate(npc, ANIM.LAND);
      Shared.areaSound(this.raiders(), 1695, at, { range: 8 });
      for (const raider of this.raiders()) {
        if (raider.getLocation().getDistance(at) <= 1) this.hurtBy(raider, Shared.random(20, 25));
      }
    });
    Shared.later(this.raid, JUMP_TICKS + 2, () => {
      npc.__coxJumping = false;
      if (npc.isRegistered()) npc.getCombat().attack(player);
    });
    return true;
  }

  onNpcDeath(npc, killer) {
    if (!this.shamans.includes(npc)) return;
    if (killer) {
      for (const player of this.raid.players) {
        Shared.raidMessage(player, `The Lizardman Shaman slain by ${Shared.displayName(killer)} dropped seeds for all.`);
      }
      if (!this.hurt.has(killer)) Achievements.complete(killer, "Shayzien Specialist");
    }
    if (this.living().some((other) => other !== npc)) return;
    this.completed = true;
    Shared.later(this.raid, 5, () => {
      for (const blocker of this.blockers) this.explode(blocker, false, 3);
    });
    Shared.later(this.raid, 6, () => this.tendrils.forEach((tendril) => Shared.core().ObjectManager.deregister(tendril, true)));
    Shared.later(this.raid, 8, () => this.blockerClip(false));
  }
}

Raid.registerRoom("LIZARDMEN_SHAMAN", ShamansRoom);

/** rsprox captures: passing the spirit tendrils is a two-tile walk through them with sound 3728. */
function passTendrils(event) {
  const { player, object } = event;
  const room = Raid.raidOf(player)?.roomAt(player.getLocation());
  if (!(room instanceof ShamansRoom)) return false;
  if (player.__coxBalancing) return true;
  Shared.sound(player, 3728);
  const at = object.getLocation();
  const here = player.getLocation();
  const { Location } = Shared.core();
  const dx = Math.sign(at.getX() - here.getX());
  const dy = dx === 0 ? Math.sign(at.getY() - here.getY()) : 0;
  Shared.balanceWalk(player, new Location(here.getX() + dx * 2, here.getY() + dy * 2, here.getZ()), -1, null);
  return true;
}

/**
 * The shamans' spit and acid: from 61 client cycles, angle `angle`, from height 420 (105 here)
 * to `endHeight`, ending at `endAt(tiles)` from its centre. Returns the ticks until it lands.
 */
function spit(area, npc, to, id, angle, endHeight, endAt) {
  const { Projectile } = Shared.core();
  const from = Projectile.centreOf(npc);
  const tile = to.getLocation ? to.getLocation() : to;
  const end = endAt(from.getDistance(tile));
  new Projectile(from, tile, to.getLocation ? to : null, id, 61, end, 105, endHeight, area)
    .withAngle(angle)
    .withProgress(128)
    .sendProjectile();
  return Math.max(1, Math.floor(end / 30));
}

function shamanCombat(api) {
  const { CombatMethod, CombatType } = api.core;
  return class LizardmanShamanCombat extends CombatMethod {
    type() {
      return CombatType.RANGED;
    }

    attackDistance() {
      return 8;
    }

    attackSpeed() {
      return 4;
    }

    canAttack(npc) {
      return !npc.__coxJumping;
    }

    start(npc, target) {
      const room = npc.__coxRoom;
      if (room instanceof ShamansRoom && target?.isPlayer?.()) room.attack(npc, target.getAsPlayer());
    }

    hits() {
      return [];
    }
  };
}

module.exports = function registerCoxShamans(api) {
  Shared.bind(api);
  Shared.onObjectIds(api, [OBJECT.TENDRIL], passTendrils);
  api.registerNpcCombatMethodProvider(NPC.SHAMANS, shamanCombat(api));
};

Object.assign(module.exports, { ShamansRoom, shamanCount });
