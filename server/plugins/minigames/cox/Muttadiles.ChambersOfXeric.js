"use strict";

/**
 * The Muttadiles' room: past the noxious tendrils a small muttadile fights while the large one
 * lurks in the water; once the small one dies the large one comes out. Both eat from the meat
 * tree to heal unless it's chopped down.
 *
 * Wiki (Muttadile; Meat tree):
 * - The submerged large muttadile is unattackable and fires erratic Magic: each player it sees
 *   has a 1 in 3 chance of being targeted.
 * - The small one uses Ranged at a distance and Melee up close. The large one uses all three;
 *   up close it stomps everyone in melee range for up to 50% more than its melee max (crush);
 *   at a distance it keeps one style for at least three attacks.
 * - Max hits at the Wiki's scale: small 28 melee, 30 Ranged; large 72 stomp, 48 melee, 45
 *   Ranged, 23 Magic. Their stats recover 1 per 15 ticks (Mod Ash).
 * - At about half health they go to the meat tree and eat up to half their health, at most
 *   three times, giving up after about 15 seconds if they can't reach it.
 * - The meat tree has 5 x the party's total Woodcutting (at least 100). A chop succeeds 20% at
 *   Woodcutting 1 to 78% at 99 and takes off (level / 2) -7 to +3; the axe doesn't matter.
 *   Cutting it gives points.
 * rsprox captures (recordings 820, 843, 3282, 3285, 3389):
 * - The tendrils, the meat tree and both muttadiles are there when the room is loaded.
 *   Passing the tendrils is a two-tile walk with sound 3728.
 * - Submerged, the large one fires every 6 ticks at raiders it picks: projectile 393 (from 61
 *   client cycles to 56 + 5 a tile, angle 5, progress 128, heights 250 to 146; sound 162, range
 *   15).
 * - The small one bites (7420) up close and spits (7421) at range: projectile 1291 (from 5
 *   cycles to 61 + 5 a tile, angle 5, progress 115, heights 100 to 146; sound 385, range 10),
 *   every 4 ticks.
 * - The small one dies (7426) and goes 3 ticks later; that tick the large one emerges (7423),
 *   crawling out a tile a tick for 5 ticks (west on the map in the west and north versions,
 *   south in the east one), turns to 7563 on the 5th and attacks 2 later:
 *   the same spit (to 56 + 5 a tile, progress 250, from height 185), its magic 7422 with
 *   projectile 393 (sound 162, range 10), a slam 7424 up close (sound 163, range 6, 30 cycles'
 *   delay) and bites.
 * - Below half health they go to the meat tree and eat: 3 bites on 3 ticks running (7420),
 *   each healing 15% of their hitpoints; at most three meals.
 * - Chopping the tree: "You swing your axe...", a roll every 5 ticks, "You hack away some of
 *   the meat." and a hitsplat on the tree when it takes. The felled tree is 30013 on the same
 *   tile (3282).
 * - The large one gone ("As the Muttadile is slain by <name>, supplies are dropped for all.",
 *   as for the small one), the exit crystal shatters the tick after and is gone 4 ticks later
 *   with the tendrils (843, 3282).
 * Tiles: the tree, tendrils (rotations 0 and 1 in that order, whatever the room's turn), large
 *   and small ones and exit crystal are checked for the north version (3389) and the east one
 *   (820, 843, 3282, 3285). No capture has the west version: its tiles are unverified.
 * Not on the Wiki (to check against a capture): the room waking when someone comes within 6
 *   tiles of the tendrils; passing them again costing 22.5% of your hitpoints; the submerged
 *   one's base (23, as the large one's magic); Ranged and Magic prayers letting a third
 *   through; the large one's magic splashing those beside its path; 45 XP and 2 points a chop.
 */

const Shared = require("./Shared.ChambersOfXeric");
const Raid = require("./RaidState.ChambersOfXeric");
const Monsters = require("./Monsters.ChambersOfXeric");
const Achievements = require("./CombatAchievements.ChambersOfXeric");

const NPC = { SUBMERGED: 7561, SMALL: 7562, LARGE: 7563, TREE: 7564 };
const OBJECT = { TENDRILS: 29767, ROCKS: 30012, FELLED_TREE: 30013 };
const BASE = { SUBMERGED_MAGIC: 23, SMALL_RANGED: 30, LARGE_RANGED: 45, MAGIC: 23 };
const ANIM = { EMERGE: 7423, BITE: 7420, RANGED: 7421, MAGIC: 7422, STOMP: 7424 };
const SOUND = { SPIT: 385, MAGIC: 162, SLAM: 163, TENDRILS: 3728 };
/** Captured flights: start and the arc; the end is `end` + 5 client cycles a tile. */
const FLIGHT = {
  SPIT: { id: 1291, start: 5, end: 61, angle: 5, progress: 115, startHeight: 25, endHeight: 36 },
  LARGE_SPIT: { id: 1291, start: 5, end: 56, angle: 5, progress: 250, startHeight: 46, endHeight: 36 },
  MAGIC: { id: 393, start: 61, end: 56, angle: 5, progress: 128, startHeight: 62, endHeight: 36 },
};
const EAT = { TIMES: 3, GIVE_UP: 25, BITES: 3, SHARE: 0.15 };
const SUBMERGED_EVERY = 6;
const EMERGE = { STEPS: 5, ATTACK_AFTER: 2 };
const CHOP_EVERY = 5;
/** Their sizes on the map's grid, and the Wiki's rate their stats recover at (1 per 15 ticks). */
const SIZE = { SMALL: 3, LARGE: 5 };
const STAT_RESTORE_TICKS = 15;
/** After the large one goes: the crystal shatters, then it and the tendrils are gone. */
const AFTER_LARGE = { SHATTER: 1, TENDRILS: 5 };

/** Cache tiles by version. */
const TREE_TILES = [{ x: 3269, y: 5320 }, { x: 3301, y: 5320 }, { x: 3350, y: 5317 }];
const TENDRIL_TILES = [[{ x: 3279, y: 5313 }, { x: 3280, y: 5313 }], [{ x: 3311, y: 5313 }, { x: 3312, y: 5313 }], [{ x: 3343, y: 5313 }, { x: 3344, y: 5313 }]];
const CRYSTAL_TILES = [{ x: 3270, y: 5328 }, { x: 3308, y: 5335 }, { x: 3352, y: 5327 }];
const LARGE_TILES = [{ x: 3282, y: 5332 }, { x: 3314, y: 5330 }, { x: 3337, y: 5330 }];
const SMALL_TILES = [{ x: 3279, y: 5317 }, { x: 3311, y: 5317 }, { x: 3343, y: 5318 }];
/** The way the large one crawls out, on the cache's map, by version. */
const EMERGE_STEP = [[-1, 0], [-1, 0], [0, -1]];

/** Wiki (Mod Ash): 20% at Woodcutting 1 to 78% at 99. */
function chopChance(level) {
  return 0.2 + ((Math.min(99, Math.max(1, level)) - 1) * 0.58) / 98;
}

/** Wiki (Mod Ash): level / 2, -7 to +3. */
function chopDamage(level) {
  return Math.max(1, Math.floor(level / 2) + Shared.random(-7, 3));
}

class MuttadileRoom extends Raid.Room {
  constructor(raid, record) {
    super(raid, record);
    this.woken = false;
    this.tendrilCrossers = new Set();
  }

  load() {
    const variant = this.record.variant;
    const tree = TREE_TILES[variant];
    const { GameObject, ObjectManager } = Shared.core();
    this.treeTile = this.tile(tree.x, tree.y, 2);
    this.treeBase = new GameObject(OBJECT.ROCKS, this.treeTile.clone(), 10, 0, this.map);
    ObjectManager.register(this.treeBase, true);
    this.tree = this.spawnNpc(NPC.TREE, this.treeTile.clone(), { scale: false });
    if (this.tree) {
      const woodcutting = [...this.raid.players].reduce((sum, player) => sum + Shared.baseLevel(player, "WOODCUTTING"), 0);
      const health = Math.max(100, 5 * woodcutting);
      this.tree.setMaxHitpoints(health);
      this.tree.setHitpoints(health);
    }
    this.blockExit(CRYSTAL_TILES);
    this.tendrilTiles = TENDRIL_TILES[variant].map((spot) => this.tile(spot.x, spot.y));
    this.tendrils = this.tendrilTiles.map((tile, index) => {
      const tendril = new GameObject(OBJECT.TENDRILS, tile, 10, index, this.map);
      ObjectManager.register(tendril, true);
      return tendril;
    });
    this.small = this.spawnNpc(NPC.SMALL, this.tile(SMALL_TILES[variant].x, SMALL_TILES[variant].y, SIZE.SMALL));
    this.large = this.spawnNpc(NPC.SUBMERGED, this.tile(LARGE_TILES[variant].x, LARGE_TILES[variant].y, SIZE.LARGE));
    this.largeState = "submerged";
    for (const npc of [this.small, this.large]) {
      if (!npc) continue;
      npc.__coxMeals = 0;
      npc.setStatRestoreTicks(STAT_RESTORE_TICKS);
    }
  }

  combatPoints() {
    return Number.MAX_SAFE_INTEGER;
  }

  tick() {
    if (!this.woken) return this.watch();
    if (this.completed) return undefined;
    if (this.large && this.largeState === "submerged" && this.small?.isRegistered() && this.raid.ticks % SUBMERGED_EVERY === 0) this.erratic();
    for (const npc of [this.small, this.large]) {
      if (!npc?.isRegistered() || npc.getHitpoints() <= 0) continue;
      if (npc.__coxEating) this.eat(npc);
      else if (npc === this.small || this.largeState === "out") {
        this.considerEating(npc);
        if (!npc.__coxEating) this.engage(npc);
      }
    }
    return undefined;
  }

  /** Someone within 6 tiles of the tendrils wakes the room. */
  watch() {
    const near = this.raiders().some((player) => player.getLocation().getDistance(this.tendrilTiles[0]) <= 6);
    if (near) this.woken = true;
  }

  /** Wiki (Mod Ash): each raider it can see has a 1 in 3 chance of being hit. */
  erratic() {
    const large = this.large;
    for (const player of this.raiders()) {
      if (player.getHitpoints() <= 0 || Shared.random(1, 3) !== 1) continue;
      const delay = fly(this.map, large, player, FLIGHT.MAGIC);
      Shared.areaSound(this.raiders(), SOUND.MAGIC, large.getLocation(), { delay: 10, range: 15 });
      Shared.strike(large, player, "magic", Monsters.maxHitFor(large, BASE.SUBMERGED_MAGIC, Monsters.LEVELS.MAGIC), delay, { prayerMultiplier: 1 / 3 });
    }
  }

  /** Wiki: below half health, up to three meals from the meat tree while it stands. */
  considerEating(npc) {
    if (!this.tree?.isRegistered() || this.tree.getHitpoints() <= 0) return;
    if (npc.__coxMeals >= EAT.TIMES || npc.getHitpoints() >= npc.getMaxHitpoints() / 2 || Shared.random(0, 2) !== 0) return;
    npc.__coxEating = { since: this.raid.ticks, bites: EAT.BITES };
    npc.__coxMeals++;
    npc.getCombat().reset();
    npc.setPositionToFace(this.treeTile);
    Shared.core().PathFinder.calculateEntityRoute(npc, this.tree);
  }

  eat(npc) {
    const meal = npc.__coxEating;
    if (!this.tree?.isRegistered() || this.tree.getHitpoints() <= 0 || this.raid.ticks - meal.since > EAT.GIVE_UP && meal.bitten !== true) {
      npc.__coxEating = null;
      return;
    }
    const reach = npc.getLocation().getDistance(this.treeTile) <= npc.getSize() + 1;
    if (!reach) {
      if (!npc.getMovementQueue().isMovings()) Shared.core().PathFinder.calculateEntityRoute(npc, this.tree);
      return;
    }
    meal.bitten = true;
    Shared.animate(npc, ANIM.BITE);
    const healed = Math.min(Math.floor(npc.getMaxHitpoints() * EAT.SHARE), npc.getMaxHitpoints() - npc.getHitpoints());
    if (healed > 0) this.fed = true;
    Shared.healSplat(npc, healed);
    if (--meal.bites <= 0) npc.__coxEating = null;
  }

  /** The small one is gone: the large one crawls out a tile a tick, then turns and fights. */
  emerge() {
    const large = this.large;
    if (!large?.isRegistered()) return;
    this.largeState = "emerging";
    Shared.animate(large, ANIM.EMERGE);
    const variant = this.record.variant;
    const [stepX, stepY] = EMERGE_STEP[variant];
    Shared.walkStraight(large, this.tile(LARGE_TILES[variant].x + stepX * EMERGE.STEPS, LARGE_TILES[variant].y + stepY * EMERGE.STEPS, SIZE.LARGE));
    Shared.later(this.raid, EMERGE.STEPS, () => large.isRegistered() && large.setNpcTransformationId(NPC.LARGE));
    Shared.later(this.raid, EMERGE.STEPS + EMERGE.ATTACK_AFTER, () => {
      this.largeState = "out";
    });
  }

  modifyHit(npc, hit) {
    if (npc !== this.large || this.largeState === "out") return;
    for (const part of hit.getHits()) part.setDamage(0);
    hit.updateTotalDamage();
  }

  /** The death hook fires as the NPC goes, 3 ticks after its death animation. */
  onNpcDeath(npc, killer) {
    if (killer && (npc === this.small || npc === this.large)) {
      for (const player of this.raid.players) Shared.raidMessage(player, `As the Muttadile is slain by ${Shared.displayName(killer)}, supplies are dropped for all.`);
    }
    if (npc === this.small) {
      this.emerge();
      return;
    }
    if (npc === this.tree) {
      Shared.replaceObject(this.map, this.treeBase, OBJECT.FELLED_TREE);
      return;
    }
    if (npc !== this.large) return;
    if (!this.fed) Achievements.complete(this.raiders(), "Mutta-diet");
    Shared.later(this.raid, AFTER_LARGE.SHATTER, () => this.clearExit());
    const tendrils = this.tendrils ?? [];
    Shared.later(this.raid, AFTER_LARGE.TENDRILS, () => tendrils.forEach((tendril) => Shared.core().ObjectManager.deregister(tendril, true)));
  }

  /** Passing the tendrils (not on the Wiki): two tiles on, 22.5% of your hitpoints after the first time. */
  passTendrils(player, tendril) {
    if (this.completed) {
      player.sendMessage("The tendril is about to collapse!");
      return;
    }
    if (player.__coxBalancing) return;
    const name = player.getUsername();
    if (this.tendrilCrossers.has(name)) Shared.damage(player, Math.floor(player.getHitpoints() * 0.225));
    this.tendrilCrossers.add(name);
    Shared.sound(player, SOUND.TENDRILS);
    const at = tendril.getLocation();
    const here = player.getLocation();
    const { Location } = Shared.core();
    const dx = Math.sign(at.getX() - here.getX());
    const dy = dx === 0 ? Math.sign(at.getY() - here.getY()) : 0;
    Shared.balanceWalk(player, new Location(here.getX() + dx * 2, here.getY() + dy * 2, here.getZ()), -1, null);
  }

  chop(player) {
    const axe = Shared.axeOf(player);
    if (!axe) {
      player.sendMessage("You do not have an axe which you have the woodcutting level to use.");
      return;
    }
    if (!this.tree?.isRegistered() || this.tree.getHitpoints() <= 0) {
      player.sendMessage("The tree has died.");
      return;
    }
    player.sendMessage("You swing your axe...");
    let ticks = 0;
    Shared.action(player, {
      first: 1,
      interval: 1,
      step: () => {
        if (!this.tree?.isRegistered() || this.tree.getHitpoints() <= 0) return false;
        if (ticks++ % 4 === 0) Shared.animate(player, axe.animation);
        // 3285: the rolls keep one 5-tick grid however often the axe is swung anew.
        if (this.raid.ticks % CHOP_EVERY !== 0) return true;
        const level = Shared.level(player, "WOODCUTTING");
        if (Math.random() >= chopChance(level)) return true;
        Shared.addXp(player, "WOODCUTTING", 45);
        this.raid.addPoints(player, 2);
        const left = this.tree.getHitpoints() - chopDamage(level);
        if (left <= 0) {
          for (const viewer of this.raiders()) Shared.sound(viewer, 2734);
          player.sendMessage("You hack away the final pieces of meat.");
          this.tree.setHitpoints(0);
          this.removeNpc(this.tree);
          this.onNpcDeath(this.tree);
          return false;
        }
        Shared.damage(this.tree, this.tree.getHitpoints() - left);
        Shared.sound(player, 2070);
        player.sendMessage("You hack away some of the meat.");
        return true;
      },
      stop: () => Shared.animate(player, -1),
    });
  }
}

Raid.registerRoom("MUTTADILES", MuttadileRoom);

/**
 * A captured flight from an NPC to a player: it ends 5 client cycles a tile further out.
 * Returns the ticks until it lands.
 */
function fly(area, npc, player, flight) {
  const { Projectile } = Shared.core();
  const from = Projectile.centreOf(npc);
  const end = flight.end + 5 * from.getDistance(player.getLocation());
  new Projectile(from, player.getLocation(), player, flight.id, flight.start, end, flight.startHeight, flight.endHeight, area)
    .withAngle(flight.angle)
    .withProgress(flight.progress)
    .sendProjectile();
  return Math.max(1, Math.floor(end / 30));
}

function roomOf(player) {
  const room = Raid.raidOf(player)?.roomAt(player.getLocation());
  return room instanceof MuttadileRoom ? room : null;
}

/** Their attacks: the small one's melee and ranged, the large one's stomp, ranged and magic. */
function muttadileCombat(api) {
  const { CombatMethod, CombatType } = api.core;
  return class MuttadileCombat extends CombatMethod {
    type() {
      return CombatType.RANGED;
    }

    attackDistance() {
      return 6;
    }

    attackSpeed() {
      return 4;
    }

    canAttack(npc) {
      return !npc.__coxEating && !(npc.getId() === NPC.SUBMERGED && npc.getNpcTransformationId() !== NPC.LARGE);
    }

    start(npc, target) {
      const room = npc.__coxRoom;
      if (!(room instanceof MuttadileRoom) || !target?.isPlayer?.()) return;
      const player = target.getAsPlayer();
      const large = npc === room.large;
      if (room.reachableBy(npc, player)) {
        if (large && Shared.random(0, 1) === 0) {
          // Its definition's max hit is the slam's (Wiki: 72, half again its melee).
          Shared.animate(npc, ANIM.STOMP);
          Shared.areaSound(room.raiders(), SOUND.SLAM, player.getLocation(), { delay: 30, range: 6 });
          const max = npc.getDefinition().getMaxHit();
          for (const raider of room.raiders()) {
            if (room.reachableBy(npc, raider)) Shared.strike(npc, raider, "melee", max, 1);
          }
        } else {
          Shared.animate(npc, ANIM.BITE);
          const max = large ? Math.floor((npc.getDefinition().getMaxHit() * 2) / 3) : npc.getDefinition().getMaxHit();
          Shared.strike(npc, player, "melee", max, 1);
        }
        return;
      }
      let style = "ranged";
      if (large) {
        if (!npc.__coxStyle || npc.__coxStyleLeft <= 0) {
          npc.__coxStyle = Shared.random(1, 5) <= 4 ? "ranged" : "magic";
          npc.__coxStyleLeft = 3;
        }
        npc.__coxStyleLeft--;
        style = npc.__coxStyle;
      }
      if (style === "ranged") {
        Shared.animate(npc, ANIM.RANGED);
        const delay = fly(room.map, npc, player, large ? FLIGHT.LARGE_SPIT : FLIGHT.SPIT);
        Shared.areaSound(room.raiders(), SOUND.SPIT, npc.getLocation(), { range: 10 });
        Shared.strike(npc, player, "ranged", Monsters.maxHitFor(npc, large ? BASE.LARGE_RANGED : BASE.SMALL_RANGED, Monsters.LEVELS.RANGED), delay, { prayerMultiplier: 1 / 3 });
        return;
      }
      Shared.animate(npc, ANIM.MAGIC);
      const delay = fly(room.map, npc, player, FLIGHT.MAGIC);
      Shared.areaSound(room.raiders(), SOUND.MAGIC, npc.getLocation(), { delay: 10, range: 10 });
      const max = Monsters.maxHitFor(npc, BASE.MAGIC, Monsters.LEVELS.MAGIC);
      Shared.strike(npc, player, "magic", max, delay, { prayerMultiplier: 1 / 3 });
      // Not on the Wiki (to check against a capture): the magic splashes anyone beside its path.
      const from = npc.getLocation();
      const to = player.getLocation();
      for (const raider of room.raiders()) {
        if (raider === player) continue;
        if (distanceToSegment(raider.getLocation(), from, to) <= 2) Shared.strike(npc, raider, "magic", max, delay, { prayerMultiplier: 1 / 3 });
      }
    }

    hits() {
      return [];
    }
  };
}

function distanceToSegment(point, a, b) {
  const ax = a.getX();
  const ay = a.getY();
  const dx = b.getX() - ax;
  const dy = b.getY() - ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.getX() - ax) * dx + (point.getY() - ay) * dy) / length));
  return Math.max(Math.abs(point.getX() - (ax + t * dx)), Math.abs(point.getY() - (ay + t * dy)));
}

MuttadileRoom.prototype.reachableBy = function reachableBy(npc, player) {
  const at = npc.getLocation();
  const size = npc.getSize();
  const x = player.getLocation().getX() - at.getX();
  const y = player.getLocation().getY() - at.getY();
  const inX = x >= 0 && x < size;
  const inY = y >= 0 && y < size;
  return (inX && (y === -1 || y === size)) || (inY && (x === -1 || x === size));
};

function passTendrils(event) {
  const room = roomOf(event.player);
  if (!room) return false;
  room.passTendrils(event.player, event.object);
  return true;
}

function cutTree(event) {
  const room = event.npc?.__coxRoom;
  if (!(room instanceof MuttadileRoom)) return false;
  room.chop(event.player);
  return true;
}

module.exports = function registerCoxMuttadiles(api) {
  Shared.bind(api);
  api.registerNpcCombatMethodProvider([NPC.SUBMERGED, NPC.SMALL, NPC.LARGE], muttadileCombat(api), { singleton: true });
  Shared.onObjectIds(api, [OBJECT.TENDRILS], passTendrils);
  api.onNpcInteraction("Meat tree", { Cut: cutTree });
};

Object.assign(module.exports, { MuttadileRoom, chopChance, chopDamage });
