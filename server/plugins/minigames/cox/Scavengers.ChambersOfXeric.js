"use strict";

/**
 * Scavenger rooms: scavenger beasts guarding raid tools and secondaries, and in the large room
 * a shortcut to clear - rocks to mine, a rotten sapling to chop or a boulder to push.
 *
 * Wiki (Chambers of Xeric; Scavenger beast; Gaining points, Shortcuts):
 * - The number of scavengers and (mildly) their strength follow the party size. They drop
 *   three items at a time.
 * - Clearing a shortcut gives points of 5 x its level requirement.
 * Not on the Wiki (to check against a capture): the counts (1 solo, 2 up to 4, 3 to 7, 4 to 15, 5 to 23, 6 to 31, 7 to 39,
 *   8 beyond); they spawn around the room's middle, 2 tiles apart; bite anim 255; the
 *   shortcut's tile; its level is random between the party's lowest and highest level + 2 (at
 *   most 99); each swing has a 1 in max(5, min(20, raiders / 3)) chance to clear it (rubble
 *   29739, stump 29737, crossed with anim 839); 4.5 Mining XP a swing; the boulder needs
 *   Strength and rolls 3 tiles (anim 6131), hurting whoever it lands on for 4-6.
 * rsprox captures (recordings 820, 843, 3282, 3285, 3389):
 * - Scavengers bite with 255 and die with 258; one is gone 2 ticks after dying and another
 *   takes its place 2 ticks after that, so the room never empties.
 * - Clearing the rocks: the rubble (29739) with sound 360 (range 4).
 */

const Shared = require("./Shared.ChambersOfXeric");
const Raid = require("./RaidState.ChambersOfXeric");

const NPC = { SCAVENGERS: [7548, 7549] };
const OBJECT = { SAPLING: 29736, STUMP: 29737, ROCKS: 29738, RUBBLE: 29739, BOULDER: 29740 };
const SHORTCUT_TILES = [{ x: 3272, y: 5222 }, { x: 3314, y: 5238 }, { x: 3353, y: 5224 }];
const SHORTCUTS = [
  { object: OBJECT.ROCKS, skill: "MINING", cleared: OBJECT.RUBBLE },
  { object: OBJECT.SAPLING, skill: "WOODCUTTING", cleared: OBJECT.STUMP },
  { object: OBJECT.BOULDER, skill: "STRENGTH", cleared: null },
];

const RESPAWN_TICKS = 4;

function scavengerCount(raiders) {
  const limits = [[1, 1], [4, 2], [7, 3], [15, 4], [23, 5], [31, 6], [39, 7]];
  return limits.find(([most]) => raiders <= most)?.[1] ?? 8;
}

class ScavengerRoom extends Raid.Room {
  constructor(raid, record) {
    super(raid, record);
    this.beasts = [];
  }

  load() {
    const middle = this.map.tile(this.record.gridX * 32 + 16, this.record.gridY * 32 + 16, this.record.plane);
    const count = scavengerCount(this.raid.scale);
    for (let tries = 0; tries < 200 && this.beasts.length < count; tries++) {
      const { Location } = Shared.core();
      const tile = new Location(middle.getX() + Shared.random(-5, 5), middle.getY() + Shared.random(-5, 5), middle.getZ());
      if (!this.freeSquare(tile) || this.beasts.some((beast) => beast.getLocation().getDistance(tile) <= 2)) continue;
      const beast = this.spawnNpc(Shared.randomOf(NPC.SCAVENGERS), tile, { wanderRadius: 4 });
      if (!beast) continue;
      beast.__coxHome = tile;
      this.beasts.push(beast);
    }
    if (this.key === "LARGE_SCAVENGER_BEAST") this.placeShortcut();
  }

  freeSquare(tile) {
    const { Location, RegionManager } = Shared.core();
    for (let dx = 0; dx < 2; dx++) {
      for (let dy = 0; dy < 2; dy++) {
        const at = new Location(tile.getX() + dx, tile.getY() + dy, tile.getZ());
        if (RegionManager.blocked(at, this.map) || this.raid.roomAt(at) !== this) return false;
      }
    }
    return true;
  }

  combatPoints() {
    return Math.floor(5 * this.beasts.reduce((sum, beast) => sum + beast.getMaxHitpoints(), 0) * 1.05);
  }

  /** rsprox captures: another takes a dead one's place 4 ticks after it dies. */
  onNpcDeath(npc) {
    const index = this.beasts.indexOf(npc);
    if (index < 0) return;
    const home = npc.__coxHome ?? npc.getLocation().clone();
    Shared.later(this.raid, RESPAWN_TICKS, () => {
      if (this.raid.destroyed || this.beasts[index] !== npc) return;
      const beast = this.spawnNpc(Shared.randomOf(NPC.SCAVENGERS), home, { wanderRadius: 4 });
      if (!beast) return;
      beast.__coxHome = home;
      this.beasts[index] = beast;
    });
  }

  placeShortcut() {
    const shortcut = Shared.randomOf(SHORTCUTS);
    const raiders = [...this.raid.players];
    const levels = raiders.map((player) => Shared.baseLevel(player, shortcut.skill));
    const lowest = Math.min(...levels, 99);
    const highest = Math.max(...levels, 1);
    this.shortcut = { ...shortcut, level: Math.min(99, Shared.random(Math.min(lowest, highest + 2), highest + 2)), workers: new Set() };
    const spot = SHORTCUT_TILES[this.record.variant];
    const { GameObject, ObjectManager } = Shared.core();
    this.shortcut.object = new GameObject(shortcut.object, this.tile(spot.x, spot.y), 10, this.record.rotation, this.map);
    ObjectManager.register(this.shortcut.object, true);
  }

  /** One swing (or push) at the shortcut; true to keep going. */
  work(player, verb) {
    const shortcut = this.shortcut;
    if (!shortcut || shortcut.done) return false;
    if (Shared.level(player, shortcut.skill) < shortcut.level) {
      const skill = shortcut.skill.charAt(0) + shortcut.skill.slice(1).toLowerCase();
      player.sendMessage(`You need a ${skill} level of at least ${shortcut.level} to ${verb} this.`);
      return false;
    }
    shortcut.workers.add(player);
    const odds = Math.max(5, Math.min(20, Math.floor(this.raid.scale / 3)));
    if (shortcut.skill === "MINING") Shared.addXp(player, "MINING", 4.5);
    if (Shared.random(0, odds - 1) !== 0) return true;
    this.clear(player);
    return false;
  }

  /** Wiki: 5 x the level requirement, to those clearing it. */
  clear(player) {
    const shortcut = this.shortcut;
    shortcut.done = true;
    for (const worker of shortcut.workers) this.raid.addPoints(worker, shortcut.level * 5);
    shortcut.workers.clear();
    if (shortcut.cleared) {
      shortcut.object = Shared.replaceObject(this.map, shortcut.object, shortcut.cleared);
      Shared.areaSound(this.raiders(), shortcut.skill === "MINING" ? 360 : 2734, shortcut.object.getLocation(), { range: 4 });
      crossRemnant(player, shortcut.object);
      return;
    }
    this.rollBoulder(player);
  }

  rollBoulder(player) {
    const { Location, ObjectManager, GameObject } = Shared.core();
    const boulder = this.shortcut.object;
    const at = boulder.getLocation();
    const here = player.getLocation();
    const dx = Math.sign(at.getX() - here.getX());
    const dy = dx === 0 ? Math.sign(at.getY() - here.getY()) : 0;
    const to = new Location(at.getX() + dx * 3, at.getY() + dy * 3, at.getZ());
    ObjectManager.deregister(boulder, true);
    Shared.later(this.raid, 3, () => {
      this.shortcut.object = new GameObject(OBJECT.BOULDER, to, boulder.getType(), boulder.getFace(), this.map);
      ObjectManager.register(this.shortcut.object, true);
      for (const raider of this.raiders()) if (raider.getLocation().equals(to)) Shared.damage(raider, Shared.random(4, 6));
    });
  }
}

Raid.registerRoom("SMALL_SCAVENGER_RUNT", ScavengerRoom);
Raid.registerRoom("LARGE_SCAVENGER_BEAST", ScavengerRoom);

function roomOf(player) {
  const room = Raid.raidOf(player)?.roomAt(player.getLocation());
  return room instanceof ScavengerRoom ? room : null;
}

/** Over the rubble or stump to the far side (Not on the Wiki (to check against a capture): anim 839). */
function crossRemnant(player, object) {
  const { Location } = Shared.core();
  const at = object.getLocation();
  const here = player.getLocation();
  const destination = new Location(at.getX() * 2 - here.getX(), at.getY() * 2 - here.getY(), at.getZ());
  Shared.animate(player, 839);
  Shared.balanceWalk(player, destination, -1, null);
}

function mineRocks(event) {
  const { player } = event;
  const room = roomOf(player);
  if (!room) return false;
  const pickaxe = Shared.pickaxeOf(player);
  if (!pickaxe) {
    player.sendMessage("You do not have a pickaxe which you have the Mining level to use.");
    return true;
  }
  player.sendMessage("You swing your pickaxe at the rocks...");
  let ticks = 0;
  Shared.action(player, {
    first: 1,
    interval: 1,
    step: () => {
      if (ticks++ % 4 === 0) Shared.animate(player, pickaxe.animation);
      if (ticks % 4 !== 0) return room.shortcut && !room.shortcut.done;
      Shared.sound(player, 3600);
      return room.work(player, "mine");
    },
    stop: () => Shared.animate(player, -1),
  });
  return true;
}

function chopSapling(event) {
  const { player } = event;
  const room = roomOf(player);
  if (!room) return false;
  const axe = Shared.axeOf(player);
  if (!axe) {
    player.sendMessage("You do not have an axe which you have the Woodcutting level to use.");
    return true;
  }
  player.sendMessage("You swing your axe at the sapling...");
  let ticks = 0;
  Shared.action(player, {
    first: 1,
    interval: 1,
    step: () => {
      if (ticks++ % 4 === 0) Shared.animate(player, axe.animation);
      if (ticks % 4 !== 0) return room.shortcut && !room.shortcut.done;
      Shared.sound(player, 2070);
      return room.work(player, "chop down");
    },
    stop: () => Shared.animate(player, -1),
  });
  return true;
}

function pushBoulder(event) {
  const { player } = event;
  const room = roomOf(player);
  if (!room) return false;
  if (room.shortcut?.done) {
    player.sendMessage("There's no need to push the boulder anymore.");
    return true;
  }
  Shared.animate(player, 6131);
  Shared.action(player, { first: 2, interval: 2, step: () => room.work(player, "have any effect on") });
  return true;
}

function crossObject(event) {
  if (!roomOf(event.player)) return false;
  crossRemnant(event.player, event.object);
  return true;
}

module.exports = function registerCoxScavengers(api) {
  Shared.bind(api);
  Shared.onObjectIds(api, [OBJECT.ROCKS], mineRocks);
  Shared.onObjectIds(api, [OBJECT.SAPLING], chopSapling);
  Shared.onObjectIds(api, [OBJECT.BOULDER], pushBoulder);
  Shared.onObjectIds(api, [OBJECT.RUBBLE, OBJECT.STUMP], crossObject);
};

Object.assign(module.exports, { ScavengerRoom, scavengerCount });
