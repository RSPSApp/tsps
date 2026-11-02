"use strict";

/**
 * The Guardians' room: two stone guardians either side of the way on, harmed only by pickaxes;
 * whoever tries to slip between them is knocked back.
 *
 * Wiki (Guardian (Chambers of Xeric); Chambers of Xeric, Gaining points):
 * - Only pickaxes hurt them, the damage times (50 + Mining + the pickaxe's level) / 150, the
 *   pickaxe's level counting no higher than a dragon pickaxe's.
 * - Hitpoints: 151 x (1 + team / 2) + average Mining x team.
 * - Melee (max 20, 33 in Challenge Mode; attack speed 4), and now and then a stomp hitting a 3x3
 *   for moderate to heavy damage.
 * - Stepping between them gets you knocked back for moderate damage, and some points.
 * - 3-5 each of buchu, noxifer and golpar seeds from each. Challenge Mode hitpoints 375 (+50%).
 * rsprox captures (recordings 820, 3282, 3389):
 * - The gap is two tiles deep. Stepping on its far row (variants 1 and 2 checked): both guardians
 *   sweep (440) with sound 2524 (range 4) at the gap; the player is thrown a tile back to the
 *   near row (exact move over 10 client cycles, anim 1258, still facing the gap), takes a hit
 *   from each living one on that tick (seen: 5, 7, 14, 15), and gets 38 points from each. The
 *   near row is safe to stand on.
 * - Melee: 1203 with sound 2533 (range 6), landing that tick. Stomp (about 1 in 4 up close, and
 *   always from further off): 4278 and sound 3188 (range 6); a rock falls (projectile 645 from a
 *   tile beside its target, 15 to 30 cycles, from height 900 to 25) as gfx 305 (30 cycles' delay),
 *   landing the next tick with sound 360 (range 6) on the 3x3 around the tile straight out from
 *   the guardian towards its target: the target's own tile if beside it, otherwise the nearest
 *   tile that is.
 * - Crumbling: 836 with sound 977 (range 6); 2 ticks later the guardian turns to its remains (id
 *   + 2) with "The Stone Guardian slain by <name> dropped seeds for all." and the seeds on the
 *   near row beside it; with both down, the gap opens 3 ticks after the second.
 * - The 7570 stands on the first of each room's guardian tiles. Tiles fitted in all three
 *   recordings (variant 1 turned 1 and 3, variant 2 unturned). No capture has variant 0.
 * - Solo totals of 220 at Mining 68 and 377 at 99 in Challenge Mode: a hitpoint over the Wiki's
 *   formula each time, which is kept here. Challenge Mode's +50% holds.
 * Not on the Wiki and not in any capture: the invisible blockers (26209) past the far row, only
 *   there to stop a run skipping it; knock-back damage (each guardian 0-15); the stomp's base (the
 *   Wiki's max hit, seen as high as 29 at solo Challenge Mode).
 */

const Shared = require("./Shared.ChambersOfXeric");
const Raid = require("./RaidState.ChambersOfXeric");
const Monsters = require("./Monsters.ChambersOfXeric");
const Achievements = require("./CombatAchievements.ChambersOfXeric");

const NPC = { GUARDIANS: [7570, 7569] };
const OBJECT = { BLOCKER: 26209 };
const BASE = { MELEE: 20, STOMP: 20 };
const ANIM = { ATTACK: 1203, STOMP: 4278, SWEEP: 440, KNOCKED: 1258, CRUMBLE: 836 };
const SOUND = { SWEEP: 2524, ATTACK: 2533, STOMP: 3188, STOMP_HIT: 360, CRUMBLE: 977 };
const DRAGON_PICKAXE_LEVEL = 61;
const KNOCK_BACK = { POINTS: 38, MAX: 15 };
/** Noxifer, golpar and buchu seeds. */
const SEEDS = [20903, 20906, 20909];
const SEEDS_EACH = { MIN: 3, MAX: 5 };

/** Cache tiles by version: the two guardians, then the gap's far row. */
const GUARDIAN_TILES = [
  [{ x: 3276, y: 5265 }, { x: 3276, y: 5269 }, { x: 3276, y: 5267 }, { x: 3276, y: 5268 }],
  [{ x: 3312, y: 5271 }, { x: 3308, y: 5271 }, { x: 3310, y: 5271 }, { x: 3311, y: 5271 }],
  [{ x: 3344, y: 5268 }, { x: 3344, y: 5272 }, { x: 3344, y: 5271 }, { x: 3344, y: 5270 }],
];
/** Past the far row, the same order. */
const BLOCKED_TILES = [[{ x: 3275, y: 5267 }, { x: 3275, y: 5268 }], [{ x: 3310, y: 5270 }, { x: 3311, y: 5270 }], [{ x: 3343, y: 5271 }, { x: 3343, y: 5270 }]];

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
    this.hitByRocks = new Set();
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
    if (this.completed) return;
    for (const player of this.raiders()) {
      const index = this.behind.findIndex((tile) => tile.equals(player.getLocation()));
      if (index >= 0 && !player.__coxBalancing && !(player.__coxKnockedAt >= this.raid.ticks - 1)) this.knockBack(player, index);
    }
  }

  /** On the far row: both sweep; thrown a tile back to the near row, a hit and 38 points from each. */
  knockBack(player, index) {
    const living = this.living();
    if (living.length === 0) return;
    player.__coxKnockedAt = this.raid.ticks;
    for (const guardian of living) {
      guardian.setPositionToFace(player.getLocation());
      Shared.animate(guardian, ANIM.SWEEP);
    }
    for (const tile of this.blocked) Shared.areaSound(this.raiders(), SOUND.SWEEP, tile, { range: 4 });
    const at = player.getLocation();
    const past = this.blocked[index];
    const dx = Math.sign(at.getX() - past.getX());
    const dy = Math.sign(at.getY() - past.getY());
    // Facing the gap as they go: thrown east they face west (512).
    const direction = dx > 0 ? 512 : dx < 0 ? 1536 : dy > 0 ? 0 : 1024;
    const { ForceMovement, ForceMovementTask, Location, TaskManager } = Shared.core();
    player.getMovementQueue().reset();
    TaskManager.submit(new ForceMovementTask(player, 1,
      new ForceMovement(at.clone(), new Location(dx, dy), 0, 10, direction, ANIM.KNOCKED)));
    for (const guardian of living) {
      Shared.damage(player, Shared.random(0, KNOCK_BACK.MAX));
      this.raid.addPoints(player, KNOCK_BACK.POINTS);
    }
  }

  /** Where a stomp's rock falls: the target's tile if beside the guardian, else the nearest tile that is. */
  stompTile(npc, player) {
    const { Location } = Shared.core();
    const at = npc.getLocation();
    const px = player.getLocation().getX();
    const py = player.getLocation().getY();
    const inX = Math.min(Math.max(px, at.getX()), at.getX() + 1);
    const inY = Math.min(Math.max(py, at.getY()), at.getY() + 1);
    if (py < at.getY()) return new Location(inX, at.getY() - 1, at.getZ());
    if (py > at.getY() + 1) return new Location(inX, at.getY() + 2, at.getZ());
    return new Location(px < at.getX() ? at.getX() - 1 : at.getX() + 2, inY, at.getZ());
  }

  stomp(npc, player) {
    Shared.animate(npc, ANIM.STOMP);
    const at = this.stompTile(npc, player);
    const { Location, Projectile } = Shared.core();
    const from = new Location(at.getX() + Shared.random(-1, 1), at.getY() + Shared.random(-1, 1), at.getZ());
    new Projectile(from, at, null, 645, 15, 30, 225, 6, this.map).withAngle(0).withProgress(0).sendProjectile();
    Shared.areaSound(this.raiders(), SOUND.STOMP, npc.getLocation(), { range: 6 });
    Shared.graphicAt(this.raiders(), 305, at, { delay: 30 });
    const max = Monsters.maxHitFor(npc, BASE.STOMP, Monsters.LEVELS.STRENGTH);
    Shared.later(this.raid, 1, () => {
      Shared.areaSound(this.raiders(), SOUND.STOMP_HIT, at, { range: 6 });
      for (const player of this.raiders()) {
        if (player.getLocation().getDistance(at) > 1) continue;
        const amount = Shared.random(0, max);
        if (amount > 0) this.hitByRocks.add(player);
        Shared.damage(player, amount);
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
    if (this.adjacent(npc, player) && Shared.random(0, 3) !== 0) {
      Shared.animate(npc, ANIM.ATTACK);
      Shared.areaSound(this.raiders(), SOUND.ATTACK, npc.getLocation(), { range: 6 });
      Shared.strike(npc, player, "melee", Monsters.maxHitFor(npc, BASE.MELEE, Monsters.LEVELS.STRENGTH), 0);
      return;
    }
    this.stomp(npc, player);
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
    const killer = npc.getCombat().getKiller(false);
    npc.getCombat().reset();
    Shared.animate(npc, ANIM.CRUMBLE);
    Shared.areaSound(this.raiders(), SOUND.CRUMBLE, npc.getLocation(), { range: 6 });
    if (killer && !this.hitByRocks.has(killer)) Achievements.complete(killer, "Dancing with Statues");
    Shared.later(this.raid, 2, () => {
      if (!npc.isRegistered()) return;
      npc.setNpcTransformationId(npc.getId() + 2);
      this.dropSeeds(npc, killer);
      if (this.guardians.some((guardian) => !guardian.__coxCrumbled) || this.completed) return;
      this.completed = true;
      Shared.later(this.raid, 3, () => {
        for (const blocker of this.blockers) Shared.core().ObjectManager.deregister(blocker, true);
        this.blockers = [];
      });
    });
    return true;
  }

  /** Kept alive as its remains, a guardian's drop is the room's to make: on the near row beside it. */
  dropSeeds(npc, killer) {
    const owner = killer?.isRegistered?.() ? killer : this.raiders()[0];
    if (!owner) return;
    for (const player of this.raid.players) {
      Shared.raidMessage(player, `The Stone Guardian slain by ${Shared.displayName(owner)} dropped seeds for all.`);
    }
    const { Item, ItemOnGroundManager, Location } = Shared.core();
    const at = npc.getLocation();
    const nearest = this.behind.map((tile, index) => ({ tile, index }))
      .sort((a, b) => a.tile.getDistance(at) - b.tile.getDistance(at))[0];
    const far = nearest.tile;
    const past = this.blocked[nearest.index];
    const near = new Location(far.getX() * 2 - past.getX(), far.getY() * 2 - past.getY(), far.getZ());
    for (const id of SEEDS) ItemOnGroundManager.registerLocation(owner, new Item(id, Shared.random(SEEDS_EACH.MIN, SEEDS_EACH.MAX)), near, undefined, { public: true });
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
