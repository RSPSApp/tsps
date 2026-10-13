"use strict";

/**
 * The Guardians' room: two stone guardians either side of the way on, harmed only by pickaxes;
 * whoever tries to slip between them is knocked back.
 *
 * Wiki (Guardian (Chambers of Xeric); Chambers of Xeric, Gaining points):
 * - Only pickaxes hurt them, the damage times (50 + Mining + the pickaxe's level) / 150, the
 *   pickaxe's level counting no higher than a dragon pickaxe's.
 * - Hitpoints: 151 x (1 + team / 2) + average Mining x team.
 * - Melee (max 20, attack speed 4), and now and then a stomp hitting a 3x3 for moderate to
 *   heavy damage.
 * - Stepping between them gets you knocked back for moderate damage, and some points.
 * rsprox captures (recordings 820, 3282, 3389):
 * - Stepping into the gap: both guardians sweep (440) with sound 2524 (range 4) at the gap;
 *   the player is thrown a tile back (exact move over 10 client cycles, anim 1258), takes a
 *   hit from each, and gets 38 points from each.
 * - Melee: 1203 with sound 2533 (range 6), landing that tick. Stomp: 4278 and sound 3188
 *   (range 6); a rock falls (projectile 645 from 15 to 30 cycles, from height 900 to 25) as
 *   gfx 305 (30 cycles' delay) on the tile, landing the next tick with sound 360.
 * - Crumbling: 836, then 2 ticks later the guardian turns to its remains (id + 2); with both
 *   down, the gap opens 3 ticks after the second.
 * Not on the Wiki (to check against a capture): the tiles; the invisible blockers (26209);
 *   the knock-back reach (a tile from the gap) and damage (each guardian 0-15); the stomp's
 *   base (15) and 3x3; their never moving.
 * Not from a source: Challenge Mode hitpoints +50%, as the Wiki's scaling for other monsters.
 */

const Shared = require("./CoxShared");
const Raid = require("./CoxRaid");
const Monsters = require("./CoxMonsters");

const NPC = { GUARDIANS: [7569, 7570] };
const OBJECT = { BLOCKER: 26209 };
const BASE = { MELEE: 20, STOMP: 15 };
const ANIM = { ATTACK: 1203, STOMP: 4278, SWEEP: 440, KNOCKED: 1258, CRUMBLE: 836 };
const SOUND = { SWEEP: 2524, ATTACK: 2533, STOMP: 3188, STOMP_HIT: 360 };
const DRAGON_PICKAXE_LEVEL = 61;
const KNOCK_BACK = { POINTS: 38, MAX: 15 };

/** Cache tiles by version: the two guardians, then the tiles behind each gap side. */
const GUARDIAN_TILES = [
  [{ x: 3276, y: 5265 }, { x: 3276, y: 5269 }, { x: 3276, y: 5267 }, { x: 3276, y: 5268 }],
  [{ x: 3312, y: 5271 }, { x: 3308, y: 5271 }, { x: 3310, y: 5271 }, { x: 3311, y: 5271 }],
  [{ x: 3344, y: 5268 }, { x: 3344, y: 5272 }, { x: 3344, y: 5271 }, { x: 3344, y: 5270 }],
];
const BLOCKED_TILES = [[{ x: 3275, y: 5267 }, { x: 3275, y: 5268 }], [{ x: 3310, y: 5273 }, { x: 3311, y: 5273 }], [{ x: 3346, y: 5271 }, { x: 3346, y: 5270 }]];

/** Wiki: 151 x (1 + team / 2) + average Mining x team. */
function guardianHitpoints(team, averageMining, challenge) {
  const hitpoints = 151 * (1 + Math.floor(team / 2)) + Math.floor(averageMining) * team;
  return challenge ? Math.floor(hitpoints * 1.5) : hitpoints;
}

/** Wiki: (50 + Mining + pickaxe level, at most a dragon pickaxe's) / 150; 0 without a pickaxe. */
function pickaxeFactor(player) {
  const { Equipment } = Shared.core();
  const weapon = player.getEquipment().getItems()[Equipment.WEAPON_SLOT]?.getId?.();
  const pickaxe = Shared.PICKAXES.find((entry) => entry.id === weapon);
  if (!pickaxe) return 0;
  return (50 + Shared.level(player, "MINING") + Math.min(pickaxe.level, DRAGON_PICKAXE_LEVEL)) / 150;
}

class GuardiansRoom extends Raid.Room {
  constructor(raid, record) {
    super(raid, record);
    this.guardians = [];
    this.blockers = [];
  }

  load() {
    const variant = this.record.variant;
    const tiles = GUARDIAN_TILES[variant];
    const scaling = this.raid.scaling ?? this.raid.scalingInputs();
    const hitpoints = guardianHitpoints(scaling.size, scaling.averageMining, scaling.challenge);
    this.behind = [this.tile(tiles[2].x, tiles[2].y), this.tile(tiles[3].x, tiles[3].y)];
    for (let i = 0; i < 2; i++) {
      const guardian = this.spawnNpc(NPC.GUARDIANS[i], this.tile(tiles[i].x, tiles[i].y, 2));
      if (!guardian) continue;
      guardian.setMaxHitpoints(hitpoints);
      guardian.setHitpoints(hitpoints);
      guardian.getMovementQueue().setBlockMovement?.(true);
      this.guardians.push(guardian);
    }
    const { GameObject, ObjectManager } = Shared.core();
    this.blocked = BLOCKED_TILES[variant].map((spot) => this.tile(spot.x, spot.y));
    this.blockers = this.blocked.map((tile) => {
      const blocker = new GameObject(OBJECT.BLOCKER, tile, 10, 0, this.map);
      ObjectManager.register(blocker, true);
      return blocker;
    });
  }

  combatPoints() {
    return Math.floor(5 * this.guardians.reduce((sum, npc) => sum + npc.getMaxHitpoints(), 0) * 1.05);
  }

  living() {
    return this.guardians.filter((npc) => npc.isRegistered() && npc.getHitpoints() > 0);
  }

  tick() {
    if (this.completed || this.raid.ticks % 3 !== 0) return;
    for (const player of this.raiders()) {
      const index = this.blocked.findIndex((tile) => player.getLocation().getDistance(tile) <= 1);
      if (index >= 0 && !player.__coxBalancing) this.knockBack(player, index);
    }
  }

  /** Both sweep; thrown a tile back, a hit and 38 points from each. */
  knockBack(player, index) {
    const living = this.living();
    if (living.length === 0) return;
    for (const guardian of living) {
      guardian.setPositionToFace(player.getLocation());
      Shared.animate(guardian, ANIM.SWEEP);
    }
    for (const tile of this.blocked) Shared.areaSound(this.raiders(), SOUND.SWEEP, tile, { range: 4 });
    const at = player.getLocation();
    const to = this.behind[index];
    const dx = Math.sign(to.getX() - at.getX());
    const dy = Math.sign(to.getY() - at.getY());
    const direction = dx < 0 ? 512 : dx > 0 ? 1536 : dy > 0 ? 1024 : 0;
    const { ForceMovement, ForceMovementTask, Location, TaskManager } = Shared.core();
    player.getMovementQueue().reset();
    if (dx !== 0 || dy !== 0) {
      TaskManager.submit(new ForceMovementTask(player, 1,
        new ForceMovement(at.clone(), new Location(dx, dy), 0, 10, direction, ANIM.KNOCKED)));
    }
    for (const guardian of living) {
      Shared.damage(player, Shared.random(0, KNOCK_BACK.MAX));
      this.raid.addPoints(player, KNOCK_BACK.POINTS);
    }
  }

  stomp(npc, tile) {
    Shared.animate(npc, ANIM.STOMP);
    const at = tile.clone();
    const { Projectile } = Shared.core();
    new Projectile(at, at, null, 645, 15, 30, 225, 6, this.map).withAngle(0).withProgress(0).sendProjectile();
    Shared.areaSound(this.raiders(), SOUND.STOMP, npc.getLocation(), { range: 6 });
    Shared.graphicAt(this.raiders(), 305, at, { delay: 30 });
    const max = Monsters.maxHitFor(npc, BASE.STOMP, Monsters.LEVELS.STRENGTH);
    Shared.later(this.raid, 1, () => {
      Shared.areaSound(this.raiders(), SOUND.STOMP_HIT, at, { range: 6 });
      for (const player of this.raiders()) {
        if (player.getLocation().getDistance(at) <= 1) Shared.damage(player, Shared.random(0, max));
      }
    });
  }

  adjacent(npc, player) {
    const at = npc.getLocation();
    const x = player.getLocation().getX() - at.getX();
    const y = player.getLocation().getY() - at.getY();
    const inX = x >= 0 && x < 2;
    const inY = y >= 0 && y < 2;
    return (inX && (y === -1 || y === 2)) || (inY && (x === -1 || x === 2));
  }

  attack(npc, player) {
    if (this.adjacent(npc, player) && Shared.random(0, 1) === 0) {
      Shared.animate(npc, ANIM.ATTACK);
      Shared.areaSound(this.raiders(), SOUND.ATTACK, npc.getLocation(), { range: 6 });
      Shared.strike(npc, player, "melee", Monsters.maxHitFor(npc, BASE.MELEE, Monsters.LEVELS.STRENGTH), 0);
      return;
    }
    this.stomp(npc, player.getLocation());
  }

  /** Wiki: only pickaxes, scaled by Mining and the pickaxe; nothing once crumbled. */
  modifyHit(npc, hit) {
    if (!this.guardians.includes(npc)) return;
    const attacker = hit.getAttacker?.();
    const factor = attacker?.isPlayer?.() && !npc.__coxCrumbled ? pickaxeFactor(attacker.getAsPlayer()) : 0;
    for (const part of hit.getHits()) part.setDamage(Math.floor(part.getDamage() * factor));
    hit.updateTotalDamage();
  }

  /** They crumble (836) and 2 ticks later turn to their remains (id + 2); both down, the gap opens 3 ticks on. */
  beforeNpcDeath(npc) {
    if (!this.guardians.includes(npc) || npc.__coxCrumbled) return false;
    npc.__coxCrumbled = true;
    npc.setHitpoints(1);
    npc.getCombat().reset();
    Shared.animate(npc, ANIM.CRUMBLE);
    Shared.later(this.raid, 2, () => {
      if (!npc.isRegistered()) return;
      npc.setNpcTransformationId(npc.getId() + 2);
      if (this.guardians.some((guardian) => !guardian.__coxCrumbled) || this.completed) return;
      this.completed = true;
      Shared.later(this.raid, 3, () => {
        for (const blocker of this.blockers) Shared.core().ObjectManager.deregister(blocker, true);
        this.blockers = [];
      });
    });
    return true;
  }
}

Raid.registerRoom("GUARDIANS", GuardiansRoom);

function guardianCombat(api) {
  const { CombatMethod, CombatType } = api.core;
  return class GuardianCombat extends CombatMethod {
    type() {
      return CombatType.MELEE;
    }

    attackDistance() {
      return 8;
    }

    attackSpeed() {
      return 4;
    }

    canAttack(npc) {
      return !npc.__coxCrumbled;
    }

    canPursue() {
      return false;
    }

    start(npc, target) {
      const room = npc.__coxRoom;
      if (room instanceof GuardiansRoom && target?.isPlayer?.()) room.attack(npc, target.getAsPlayer());
    }

    hits() {
      return [];
    }
  };
}

module.exports = function registerCoxGuardians(api) {
  Shared.bind(api);
  api.registerNpcCombatMethodProvider(NPC.GUARDIANS, guardianCombat(api));
};

Object.assign(module.exports, { GuardiansRoom, guardianHitpoints, pickaxeFactor });
