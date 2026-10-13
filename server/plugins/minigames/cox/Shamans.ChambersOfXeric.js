"use strict";

/**
 * The Lizardman Shamans' room: shamans with their surface cousins' attacks - ranged, a poison
 * blob, a crushing jump and exploding spawns - and two spawns blocking the way on until the
 * shamans are dead.
 *
 * Wiki (Lizardman shaman (Chambers of Xeric); Lizardman shaman):
 * - Their attacks are the surface shamans', the poison blob ~25% stronger: up to 39 without
 *   Shayzien armour.
 * - Two shamans for solo and small teams, up to five in large ones.
 * rsprox captures (recordings 3282 and 3389):
 * - The spirit tendrils (29768) and the exit's two blocking spawns (7575) are there when the
 *   room is loaded. Passing the tendrils is a two-tile walk through them with sound 3728.
 * - Ranged: 7193, projectile 1291 (from 61 client cycles to 96-106, angle 5, heights 420 to
 *   146; sound 385, range 10), landing 3 ticks later. The acid: 7193, projectile 1293 (from 61
 *   to 150-180, angle 30, heights 420 to 5), landing as gfx 1294 with sound 1070 (range 8).
 * - Dying: 7196; gone 3 ticks later. 5 ticks after the last one starts dying the blocking
 *   spawns raise their hands (7159, sound 665), the tendrils go a tick later, and the spawns
 *   burst 3 ticks after that (gfx 1295, sound 1021, range 5).
 * Not on the Wiki (to check against a capture): the tiles; counts (2, 3 at 4+, 4 at 8+); bases
 *   (ranged and melee 24); the blob 20-35 within 2 tiles, poison 1 in 4; melee 7158 (crush);
 *   the jump (7152, landing 6946 4 ticks later beside its target, 20-25 within a tile, then a
 *   pause); the spawns (1 in 61 a tick, at most every 20 seconds, three by the target).
 * Not from a source: the spawns explode 6 ticks after appearing for up to 10 within a tile
 *   (the surface shaman's).
 */

const Shared = require("./CoxShared");
const Raid = require("./CoxRaid");
const Monsters = require("./CoxMonsters");

const NPC = { SHAMANS: [7573, 7574], SPAWN: 7575 };
const OBJECT = { TENDRIL: 29768 };
const BASE = { RANGED: 24, MELEE: 24 };
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

function shamanCount(raiders) {
  return raiders < 4 ? 2 : raiders < 8 ? 3 : 4;
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
  }

  load() {
    const variant = this.record.variant;
    for (const spot of Shared.shuffle(SHAMAN_TILES[variant]).slice(0, shamanCount(this.raid.scale))) {
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
      if (!shaman.__coxJumping) this.engage(shaman);
      const target = shaman.getCombat().getTarget();
      if (target?.isPlayer?.() && !shaman.__coxJumping && Shared.random(0, 60) === 0 && !(shaman.__coxSpawnsAt > this.raid.ticks)) {
        shaman.__coxSpawnsAt = this.raid.ticks + 33;
        this.spawns(target.getAsPlayer());
      }
    }
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
      Shared.later(this.raid, 6, () => this.explode(spawn, 10));
    }
  }

  explode(spawn, max, burstAfter = 2) {
    if (!spawn.isRegistered()) return;
    Shared.animate(spawn, ANIM.SPAWN_EXPLODE);
    Shared.areaSound(this.raiders(), 665, spawn.getLocation(), { range: 7 });
    Shared.later(this.raid, burstAfter, () => {
      if (!spawn.isRegistered()) return;
      Shared.graphicAt(this.raiders(), 1295, spawn.getLocation());
      Shared.areaSound(this.raiders(), 1021, spawn.getLocation(), { range: 5 });
      for (const player of this.raiders()) {
        if (player.getLocation().getDistance(spawn.getLocation()) <= 1) Shared.damage(player, Shared.random(0, max));
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
    else Shared.areaSound(this.raiders(), 385, npc.getLocation(), { range: 10 });
    if (style === 6) {
      Shared.animate(npc, ANIM.MELEE);
      Shared.strike(npc, player, "melee", Monsters.maxHitFor(npc, BASE.MELEE, Monsters.LEVELS.STRENGTH), 0);
      return;
    }
    Shared.animate(npc, ANIM.RANGED);
    if (style === 4) {
      const tile = player.getLocation().clone();
      const delay = spit(this.map, npc, tile, 1293, 30, 1, 90);
      Shared.later(this.raid, delay, () => {
        if (!npc.isRegistered()) return;
        Shared.graphicAt(this.raiders(), 1294, tile);
        Shared.areaSound(this.raiders(), 1070, tile, { range: 8 });
        const { CombatFactory } = Shared.core();
        for (const raider of this.raiders()) {
          if (raider.getLocation().getDistance(tile) > 2) continue;
          Shared.damage(raider, Math.floor(Shared.random(20, 39) * blobShare(raider)));
          if (Shared.random(0, 3) === 0) CombatFactory.poisonEntity(raider, 10);
        }
      });
      return;
    }
    const delay = spit(this.map, npc, player, 1291, 5, 36, 35);
    Shared.strike(npc, player, "ranged", Monsters.maxHitFor(npc, BASE.RANGED, Monsters.LEVELS.RANGED), delay);
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
        if (raider.getLocation().getDistance(at) <= 1) Shared.damage(raider, Shared.random(20, 25));
      }
    });
    Shared.later(this.raid, JUMP_TICKS + 2, () => {
      npc.__coxJumping = false;
      if (npc.isRegistered()) npc.getCombat().attack(player);
    });
    return true;
  }

  onNpcDeath(npc) {
    if (!this.shamans.includes(npc) || this.living().some((other) => other !== npc)) return;
    this.completed = true;
    Shared.later(this.raid, 5, () => {
      for (const blocker of this.blockers) this.explode(blocker, 1, 3);
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
 * to `endHeight`, ending `base` cycles plus 5 a tile on. Returns the ticks until it lands.
 */
function spit(area, npc, to, id, angle, endHeight, base) {
  const { Projectile } = Shared.core();
  const from = Projectile.centreOf(npc);
  const tile = to.getLocation ? to.getLocation() : to;
  const end = 61 + base + 5 * from.getDistance(tile);
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
