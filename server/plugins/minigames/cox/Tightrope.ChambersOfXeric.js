"use strict";

/**
 * The Tightrope room (the deathly room): across a tightrope lies a keystone crystal that
 * dispels the shimmering barrier on, guarded by deathly rangers and mages.
 *
 * Wiki (Chambers of Xeric/Strategies, Tightrope):
 * - Groups of 2-4 deathly rangers and mages; their attacks pass through prayer at reduced
 *   damage and accuracy. They tolerate players, but whoever crosses the rope while they aren't
 *   fighting becomes their target.
 * - Crossing needs an Agility level between 80% and 100% of the party's average, at random.
 * - Using the keystone on the barrier kills any of them still standing.
 * rsprox captures (recordings 820, 843, 3282, 3285, 3389):
 * - Crossing: the player faces the rope and walks across a tile a tick from 2 ticks later,
 *   with sound 2495 (2 loops) each tick, and gets the Agility XP the tick after arriving.
 *   There are no messages.
 * - Mages: 1162 with gfx 129 (height 92) and sound 155 (range 10); projectile 130 (from 51
 *   client cycles to 116-136, angle 16, heights 172 to 124); on the target gfx 131 (85
 *   splashing) and sound 156, sent with the flight's delay. Rangers: 426 with gfx 24 (height
 *   96) and sound 2693; projectile 15 (from 41 to 56-61, angle 15, progress 11, heights 163 to
 *   146), landing the tick after. Once they fight, they shout ("Stop them at all costs!",
 *   "Protect the keystone!") one a tick. Dying: 836.
 * Not on the Wiki (to check against a capture): the tiles; counts by raiders (rangers 2 / 3 at
 *   4+ / 4 at 7+, mages 2 / 3 at 4+ / 4 at 10+); walk anim 762; 7.5 Agility XP; protection
 *   prayers letting a third through; taking the keystone anim 832, sound 2582; dispelling anim
 *   832, sound 1657, "Your keystone glows as it is absorbed into the barrier, which disperses.".
 */

const Shared = require("./CoxShared");
const Raid = require("./CoxRaid");

const NPC = { RANGER: 7559, MAGE: 7560 };
const OBJECT = { TIGHTROPE: 29750, KEYSTONE: 29751, BARRIER: 29749 };
const KEYSTONE = 20884;
const SHOUTS = ["Intruder!", "Stop them at all costs!", "Protect the keystone!"];
const CROSS = { WALK: 762, SOUND: 2495, XP: 7.5, START: 2 };

/** Cache tiles by version. */
const MAGE_TILES = [[{ x: 3285, y: 5363 }, { x: 3287, y: 5363 }], [{ x: 3317, y: 5363 }, { x: 3319, y: 5363 }], [{ x: 3340, y: 5365 }, { x: 3340, y: 5367 }]];
const RANGER_TILES = [[{ x: 3284, y: 5370 }, { x: 3286, y: 5370 }], [{ x: 3316, y: 5370 }, { x: 3318, y: 5370 }], [{ x: 3333, y: 5364 }, { x: 3333, y: 5366 }]];
const BARRIERS = [{ x: 3270, y: 5360, face: 0 }, { x: 3309, y: 5368, face: 1 }, { x: 3355, y: 5360, face: 2 }];

function counts(raiders) {
  return {
    rangers: raiders >= 7 ? 4 : raiders >= 4 ? 3 : 2,
    mages: raiders >= 10 ? 4 : raiders >= 4 ? 3 : 2,
  };
}

class TightropeRoom extends Raid.Room {
  constructor(raid, record) {
    super(raid, record);
    this.guards = [];
  }

  load() {
    const variant = this.record.variant;
    const { rangers, mages } = counts(this.raid.scale);
    // rsprox captures: the guards stand on tiles of their own, in a little group by their spots.
    const taken = new Set();
    for (const spot of this.guardTiles(MAGE_TILES[variant], mages, taken)) this.addGuard(NPC.MAGE, spot);
    for (const spot of this.guardTiles(RANGER_TILES[variant], rangers, taken)) this.addGuard(NPC.RANGER, spot);
    const barrier = BARRIERS[variant];
    const [sizeX, sizeY] = barrier.face % 2 === 0 ? [1, 2] : [2, 1];
    const { GameObject, ObjectManager } = Shared.core();
    this.barrier = new GameObject(OBJECT.BARRIER, this.tile(barrier.x, barrier.y, sizeX, sizeY), 10,
      (barrier.face + this.record.rotation) & 3, this.map);
    ObjectManager.register(this.barrier, true);
    // Wiki (Mod Ash): between 80% and 100% of the party's average Agility, at random.
    const raiders = [...this.raid.players];
    const average = raiders.reduce((sum, player) => sum + Shared.baseLevel(player, "AGILITY"), 0) / Math.max(1, raiders.length);
    this.requirement = Math.max(1, Math.floor(average * (0.8 + Math.random() * 0.2)));
  }

  /** `count` free tiles: the spots first, then the tiles around them. */
  guardTiles(spots, count, taken) {
    const { RegionManager } = Shared.core();
    const candidates = [...spots];
    for (const spot of spots) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        candidates.push({ x: spot.x + dx, y: spot.y + dy });
      }
    }
    const chosen = [];
    for (const spot of candidates) {
      if (chosen.length >= count) break;
      const key = `${spot.x},${spot.y}`;
      if (taken.has(key) || RegionManager.blocked(this.tile(spot.x, spot.y), this.map)) continue;
      taken.add(key);
      chosen.push(spot);
    }
    return chosen;
  }

  addGuard(id, spot) {
    const npc = this.spawnNpc(id, this.tile(spot.x, spot.y));
    if (!npc) return;
    npc.getMovementQueue().setBlockMovement?.(true);
    this.guards.push(npc);
  }

  combatPoints() {
    return Math.floor(5 * this.guards.reduce((sum, npc) => sum + npc.getMaxHitpoints(), 0) * 1.05);
  }

  /** The rope's far end: the other tightrope in line with this one. */
  farEnd(rope) {
    const at = rope.getLocation();
    return this.templateObjects(OBJECT.TIGHTROPE)
      .map((other) => other.getLocation())
      .filter((other) => !other.equals(at) && (other.getX() === at.getX() || other.getY() === at.getY()))
      .sort((a, b) => a.getDistance(at) - b.getDistance(at))[0] ?? null;
  }

  cross(player, rope) {
    if (Shared.level(player, "AGILITY") < this.requirement) {
      Shared.statement(player, `You need an Agility level of ${this.requirement} to cross this tightrope.`);
      return;
    }
    if (player.__coxBalancing) return;
    const end = this.farEnd(rope);
    if (!end) return;
    const at = rope.getLocation();
    const { Location } = Shared.core();
    const destination = new Location(end.getX() + Math.sign(end.getX() - at.getX()), end.getY() + Math.sign(end.getY() - at.getY()), end.getZ());
    const shouting = [];
    for (const npc of this.guards) {
      if (!npc.isRegistered() || npc.getCombat().getTarget()) continue;
      shouting.push(npc);
      npc.getCombat().attack(player);
    }
    Shared.shuffle(shouting).slice(0, Shared.random(1, 4)).forEach((npc, index) => {
      Shared.later(this.raid, 1 + index, () => npc.isRegistered() && npc.forceChat(Shared.randomOf(SHOUTS)));
    });
    player.__coxBalancing = true;
    player.getMovementQueue().reset();
    player.setPositionToFace(destination);
    Shared.later(player, CROSS.START, () => {
      player.__coxBalancing = false;
      Shared.repeat(player, 1, () => {
        if (!player.__coxBalancing) return false;
        player.getPacketSender().sendSound(CROSS.SOUND, 2, 0);
        return true;
      });
      Shared.balanceWalk(player, destination, CROSS.WALK, () => {
        Shared.later(player, 1, () => Shared.addXp(player, "AGILITY", CROSS.XP));
      });
    });
  }

  dispel(player) {
    if (!this.barrier) return;
    if (!Shared.has(player, KEYSTONE)) {
      player.sendMessage("You're going to need a magical keystone to dispel this barrier.");
      return;
    }
    player.getInventory().delete(KEYSTONE, 1);
    Shared.animate(player, 832);
    Shared.sound(player, 1657);
    player.sendMessage("Your keystone glows as it is absorbed into the barrier, which disperses.");
    Shared.core().ObjectManager.deregister(this.barrier, true);
    this.barrier = null;
    this.completed = true;
    for (const npc of this.guards) {
      if (npc.isRegistered() && npc.getHitpoints() > 0) npc.setHitpoints(0);
    }
  }
}

Raid.registerRoom("DEATHLY_ROOM", TightropeRoom);

function roomOf(player) {
  const room = Raid.raidOf(player)?.roomAt(player.getLocation());
  return room instanceof TightropeRoom ? room : null;
}

function crossRope(event) {
  const room = roomOf(event.player);
  if (!room) return false;
  room.cross(event.player, event.object);
  return true;
}

function takeKeystone(event) {
  const { player } = event;
  if (!Raid.raidOf(player)) return false;
  if (player.getInventory().getFreeSlots() <= 0) {
    player.sendMessage("You need some more free inventory space to pick it up.");
    return true;
  }
  if (Shared.has(player, KEYSTONE)) {
    player.sendMessage("You already have a keystone, and see no need to take another.");
    return true;
  }
  Shared.animate(player, 832);
  Shared.sound(player, 2582);
  Shared.give(player, KEYSTONE);
  return true;
}

function useBarrier(event) {
  const room = roomOf(event.player);
  if (!room) return false;
  room.dispel(event.player);
  return true;
}

function keystoneOnBarrier(event) {
  const id = event.objectId ?? event.object?.getId?.();
  if (event.handled || id !== OBJECT.BARRIER || event.itemId !== KEYSTONE) return;
  if (useBarrier(event) !== false) event.handled = true;
}

/** Deathly rangers and mages: a third of their damage passes protection prayers. */
function guardCombat(api) {
  const { CombatMethod, CombatType, Animation } = api.core;
  return class DeathlyCombat extends CombatMethod {
    type() {
      return CombatType.RANGED;
    }

    attackDistance() {
      return 10;
    }

    attackSpeed() {
      return 4;
    }

    start(npc, target) {
      const room = npc.__coxRoom;
      if (!(room instanceof TightropeRoom) || !target?.isPlayer?.()) return;
      const player = target.getAsPlayer();
      const mage = npc.getId() === NPC.MAGE;
      const maxHit = npc.getDefinition().getMaxHit();
      const { Projectile } = api.core;
      const from = npc.getLocation();
      const distance = from.getDistance(player.getLocation());
      const viewers = room.raiders();
      npc.performAnimation(new Animation(mage ? 1162 : 426));
      npc.performGraphic(Shared.gfx(mage ? 129 : 24, { height: mage ? 92 : 96 }));
      Shared.areaSound(viewers, mage ? 155 : 2693, from, { range: 10 });
      const flight = mage
        ? { id: 130, start: 51, end: 86 + 5 * distance, angle: 16, progress: 64, startHeight: 43, endHeight: 31 }
        : { id: 15, start: 41, end: 51 + Math.min(10, distance), angle: 15, progress: 11, startHeight: 41, endHeight: 36 };
      new Projectile(from, player.getLocation(), player, flight.id, flight.start, flight.end, flight.startHeight, flight.endHeight, room.map)
        .withAngle(flight.angle)
        .withProgress(flight.progress)
        .sendProjectile();
      const lands = Math.max(1, Math.floor(flight.end / 30));
      const hit = Shared.strike(npc, player, mage ? "magic" : "ranged", maxHit, lands, { prayerMultiplier: 1 / 3 });
      if (mage) {
        player.performGraphic(Shared.gfx(hit.isAccurate?.() !== false ? 131 : 85, { delay: flight.end, height: 124 }));
        Shared.areaSound(viewers, 156, player.getLocation(), { delay: flight.end, range: 10 });
      }
    }

    hits() {
      return [];
    }
  };
}

module.exports = function registerCoxTightrope(api) {
  Shared.bind(api);
  Shared.onObjectIds(api, [OBJECT.TIGHTROPE], crossRope);
  Shared.onObjectIds(api, [OBJECT.KEYSTONE], takeKeystone);
  Shared.onObjectIds(api, [OBJECT.BARRIER], useBarrier);
  api.onItemOnObject(keystoneOnBarrier);
  api.registerNpcCombatMethodProvider([NPC.RANGER, NPC.MAGE], guardCombat(api));
};

Object.assign(module.exports, { TightropeRoom, counts });
