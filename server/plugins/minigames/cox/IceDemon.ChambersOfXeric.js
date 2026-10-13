"use strict";

/**
 * The Ice Demon's room: braziers lit with kindling thaw the ice storm around the demon; then
 * the demon is fought, and its death clears the way on.
 *
 * Wiki (Ice demon; Brazier (Chambers of Xeric); Kindling):
 * - Four braziers surround the demon, each with an icefiend by it (one per raider, at most
 *   four). Lighting needs kindling and a tinderbox and is a skill roll: 8% at Firemaking 1,
 *   rising linearly to 78% at 99. Lighting gives 32 points, each kindling 36.
 * - A lit brazier's icefiend tries every 3 or 4 ticks to take from it, a 1 in 6 chance.
 * - Thawed, the icefiends vanish and the demon attacks every 3 ticks: a snow boulder (ranged)
 *   or Ice Burst (magic), each hitting the 3x3 around its target. Praying against one makes it
 *   use only that one.
 * - All damage to it is a third, but fire spells deal 250% and demonbane weapons aren't cut.
 * - It drops fiendish ashes, 7 stinkhorn mushrooms, 7 endarkened juice and 5 cicely for each
 *   raider.
 *
 * rsprox captures (recordings 820, 843, 3282, 3285, 3389; rev 234-235):
 * - Lighting is retried every tick (anim 3687, sound 2066 at the brazier, range 4); the tick
 *   after a success the brazier is lit and all the kindling held (up to 28) goes into it, with
 *   no message. Without both: "You need a tinderbox and some suitable kindling to light the
 *   brazier." in a message box.
 * - The storm is headbar 7 over the frozen demon, 100 to 0, sent every tick. It thaws the same
 *   whatever the party size and Firemaking level: all four raids that fed two braziers 28
 *   kindling each follow one curve, about 1.45% a tick falling to 1.1% as the fires burn down,
 *   and one such brazier alone about 0.75%. Fitted: each lit brazier thaws 0.15% + 0.02% per
 *   kindling in it each tick, burns a kindling every 8 ticks (a 28-kindling brazier robbed by
 *   its icefiend went out after 168 ticks), and with nothing lit the storm regrows 0.17% a tick.
 * - Icefiends: anim 1582 and sound 531 (range 4) at their brazier on each attempt.
 * - Thawed (the bar reaching 0): every brazier goes out with a smoke puff (gfx 188, height 40,
 *   5 client cycles apart) and sound 1930 (4 loops, range 8); a tick later the icefiends die
 *   (anim 1580, sound 532, range 10), gone 2 ticks after, and the demon walks out a tile a
 *   tick. It turns hostile (7585) 8 ticks after the thaw and attacks the tick after.
 * - It stands still and every 3 ticks picks a raider at random (anim 69):
 *   - the boulder: projectile 1324 (from 51 to 60 client cycles within 3 tiles, else 90;
 *     heights 350 to 10, angle 8; sound 1440, range 10) on the target's tile, landing as
 *     gfx 1325 (height 10) with sound 1021 (range 6);
 *   - Ice Burst: projectile 366 (51 to 60 cycles, heights 325 to 10, angle 8; sound 171,
 *     range 10), landing 2 ticks later as gfx 363 (height 10) on the 3x3, centre first then
 *     NW/SE, N/S, NE/SW, E/W 3 cycles apart, with sound 170 (range 6). Damage lands with the
 *     impact; "<col=ef1020>You have been frozen!</col>" comes 2 ticks later, and a freeze can
 *     be renewed by the next burst 3 ticks on.
 * - Dying: anim 67; it goes 5 ticks later, the drops are left on its tile and the storm loc
 *   is taken away.
 * Not on the Wiki (to check against a capture): the tiles; 5 Firemaking XP a kindling; the
 *   attacks' max hits (30 and 25 at the base scale); protection prayers letting 50% (missiles)
 *   and 33% (magic) through; a freeze lasting 3 ticks; fuelling (anim 832; never recorded).
 */

const Shared = require("./CoxShared");
const Raid = require("./CoxRaid");

const NPC = { FROZEN: 7584, DEMON: 7585, ICEFIEND: 7586 };
const OBJECT = { BRAZIER: 29747, LIT_BRAZIER: 29748, STORM: 29876 };
const KINDLING = 20799;
const TINDERBOX = 590;
const KINDLING_CAP = 28;
/** The storm in hundredths of a percent; per lit brazier and tick, BASE + PER_KINDLING x its kindling. */
const STORM = { MAX: 10000, THAW_BASE: 15, THAW_PER_KINDLING: 2, REGROW: 17, HEADBAR: 7, HEADBAR_WIDTH: 100 };
const BURN_TICKS = 8;
const POINTS = { LIGHT: 32, KINDLING: 36, CAP: 6050 };
const FIRE_SPELLS = ["FIRE_STRIKE", "FIRE_BOLT", "FIRE_BLAST", "FIRE_WAVE", "FIRE_SURGE", "FLAMES_OF_ZAMORAK"];
const DEMONBANE = new Set([2402, 6746, 19675, 29577, 29589, 29591]);
const ANIM = { LIGHT: 3687, FUEL: 832, STEAL: 1582, ICEFIEND_DEATH: 1580, CAST: 69 };
const SOUND = {
  LIGHT: 2066, STEAL: 531, THAW: 1930, ICEFIEND_DEATH: 532,
  BOULDER: 1440, BOULDER_HIT: 1021, BURST: 171, BURST_HIT: 170,
};
const GFX = { SMOKE: 188, BOULDER_HIT: 1325, BURST_HIT: 363 };
const PROJECTILE = {
  BOULDER: { id: 1324, startHeight: 88, endHeight: 3 },
  BURST: { id: 366, startHeight: 81, endHeight: 3 },
  DELAY: 51, ANGLE: 8,
};
const ATTACK = { SPEED: 3, BOULDER_MAX: 30, BURST_MAX: 25, FREEZE_TICKS: 3, FREEZE_DELAY: 2 };
const FROZEN_MESSAGE = "<col=ef1020>You have been frozen!</col>";
const NEED_MESSAGE = "You need a tinderbox and some suitable kindling to light the brazier.";
/** Ice Burst's 3x3 by the client cycles each tile's graphic waits: centre, NW/SE, N/S, NE/SW, E/W. */
const BURST_TILES = [
  [0, 0, 0], [-1, 1, 3], [1, -1, 3], [0, 1, 6], [0, -1, 6], [1, 1, 9], [-1, -1, 9], [1, 0, 12], [-1, 0, 12],
];
/** Thawed to hostile, and the walk out between (a tile a tick). */
const THAW = { WALK_AFTER: 1, ICEFIENDS_GONE: 3, HOSTILE_AFTER: 8 };

/** Cache tiles by the room's version (west, north, east). */
const DEMON_TILES = [
  [{ x: 3271, y: 5365 }, { x: 3272, y: 5365 }, { x: 3278, y: 5365 }],
  [{ x: 3310, y: 5368 }, { x: 3310, y: 5367 }, { x: 3310, y: 5361 }],
  [{ x: 3349, y: 5362 }, { x: 3348, y: 5362 }, { x: 3342, y: 5363 }],
];
const BRAZIER_TILES = [
  [{ x: 3272, y: 5362 }, { x: 3275, y: 5364 }, { x: 3275, y: 5367 }, { x: 3272, y: 5369 }],
  [{ x: 3307, y: 5368 }, { x: 3309, y: 5365 }, { x: 3312, y: 5365 }, { x: 3314, y: 5368 }],
  [{ x: 3349, y: 5366 }, { x: 3346, y: 5364 }, { x: 3346, y: 5361 }, { x: 3349, y: 5359 }],
];
const ICEFIEND_TILES = [
  [{ x: 3273, y: 5362 }, { x: 3275, y: 5365 }, { x: 3275, y: 5366 }, { x: 3273, y: 5369 }],
  [{ x: 3307, y: 5367 }, { x: 3310, y: 5365 }, { x: 3311, y: 5365 }, { x: 3314, y: 5367 }],
  [{ x: 3348, y: 5366 }, { x: 3346, y: 5363 }, { x: 3346, y: 5362 }, { x: 3348, y: 5359 }],
];

let fireSpells = null;

function isFireSpell(spell) {
  if (!spell) return false;
  if (!fireSpells) {
    const { CombatSpells } = Shared.core();
    fireSpells = new Set(FIRE_SPELLS.map((name) => CombatSpells[name]).filter(Boolean));
  }
  return fireSpells.has(spell);
}

/** Wiki (Mod Ash): a normal skill roll, 8% at level 1 to 78% at 99. */
function lightChance(level) {
  return 0.08 + ((Math.min(99, Math.max(1, level)) - 1) * 0.7) / 98;
}

/** How much of the storm one lit brazier thaws a tick, by the kindling in it. */
function thawRate(kindling) {
  return STORM.THAW_BASE + STORM.THAW_PER_KINDLING * kindling;
}

/** The headbar's fill for what is left of the storm. */
function stormFill(left) {
  return Math.max(0, Math.floor((left * STORM.HEADBAR_WIDTH) / STORM.MAX));
}

/** The boulder's flight in client cycles: 60 within 3 tiles, 30 more for each 3 beyond. */
function boulderCycles(distance) {
  return 60 + 30 * Math.max(0, Math.floor((distance - 1) / 3));
}

class IceDemonRoom extends Raid.Room {
  constructor(raid, record) {
    super(raid, record);
    this.stage = "frozen";
    this.braziers = new Map();
    this.icefiends = new Map();
    this.kindlingPoints = 0;
    this.attackWait = 0;
  }

  load() {
    const variant = this.record.variant;
    const [stormAt, faceAt] = DEMON_TILES[variant];
    const { GameObject, ObjectManager } = Shared.core();
    this.storm = new GameObject(OBJECT.STORM, this.tile(stormAt.x, stormAt.y, 2), 10, 0, this.map);
    ObjectManager.register(this.storm, true);
    this.demon = this.spawnNpc(NPC.FROZEN, this.storm.getLocation().clone());
    this.demon?.setPositionToFace(this.tile(faceAt.x, faceAt.y, 2));
    this.stormLeft = STORM.MAX;
    const count = Math.min(this.raid.scale, 4);
    for (const index of Shared.shuffle([0, 1, 2, 3]).slice(0, count)) {
      const spot = ICEFIEND_TILES[variant][index];
      const icefiend = this.spawnNpc(NPC.ICEFIEND, this.tile(spot.x, spot.y), { scale: false });
      if (!icefiend) continue;
      icefiend.getMovementQueue().setBlockMovement?.(true);
      const brazier = BRAZIER_TILES[variant][index];
      icefiend.setPositionToFace(this.tile(brazier.x, brazier.y));
      this.icefiends.set(index, { npc: icefiend, wait: Shared.random(3, 4) });
    }
  }

  combatPoints() {
    return this.demon ? Math.floor(5 * this.demon.getMaxHitpoints() * 1.05) : 0;
  }

  /** Which brazier (0-3) stands on a tile. */
  brazierIndex(location) {
    return BRAZIER_TILES[this.record.variant].findIndex((spot) => this.tile(spot.x, spot.y).equals(location));
  }

  brazierTiles() {
    return BRAZIER_TILES[this.record.variant].map((spot) => this.tile(spot.x, spot.y));
  }

  tick() {
    if (this.stage === "frozen") this.thaw();
    else if (this.stage === "fighting") this.fight();
  }

  thaw() {
    if (this.braziers.size === 0) {
      this.stormLeft = Math.min(STORM.MAX, this.stormLeft + STORM.REGROW);
    }
    for (const [index, brazier] of [...this.braziers]) {
      this.stormLeft -= thawRate(brazier.kindling);
      this.icefiendSteals(index, brazier);
      if (--brazier.burn <= 0) {
        brazier.burn = BURN_TICKS;
        brazier.kindling--;
      }
      if (brazier.kindling <= 0) this.extinguish(index);
    }
    const fill = stormFill(this.stormLeft);
    this.demon?.showHeadbar(STORM.HEADBAR, { fill });
    if (fill <= 0) this.defreeze();
  }

  /** Wiki (Mod Ash): every 3 or 4 ticks, a 1 in 6 chance to take a kindling. */
  icefiendSteals(index, brazier) {
    const icefiend = this.icefiends.get(index);
    if (!icefiend || --icefiend.wait > 0) return;
    icefiend.wait = Shared.random(3, 4);
    Shared.animate(icefiend.npc, ANIM.STEAL);
    Shared.areaSound(this.raiders(), SOUND.STEAL, brazier.object.getLocation(), { range: 4 });
    if (Shared.random(1, 6) === 1) brazier.kindling = Math.max(0, brazier.kindling - 1);
  }

  light(player, object, index) {
    const have = Math.min(KINDLING_CAP, player.getInventory().getAmount(KINDLING));
    if (have <= 0 || this.stage !== "frozen" || this.braziers.has(index)) return;
    player.getInventory().delete(KINDLING, have);
    const lit = Shared.replaceObject(this.map, object, OBJECT.LIT_BRAZIER);
    this.braziers.set(index, { object: lit, kindling: have, burn: BURN_TICKS });
    Shared.addXp(player, "FIREMAKING", have * 5);
    this.kindlingRewards(player, have, POINTS.LIGHT);
  }

  fuel(player, index) {
    const brazier = this.braziers.get(index);
    const amount = player.getInventory().getAmount(KINDLING);
    if (!brazier || amount <= 0) return;
    player.getInventory().delete(KINDLING, amount);
    brazier.kindling += amount;
    Shared.animate(player, ANIM.FUEL);
    Shared.addXp(player, "FIREMAKING", amount * 5);
    this.kindlingRewards(player, amount, 0);
  }

  /** Wiki: 36 a kindling and 32 a lighting, up to about 6,050 in a normal raid. */
  kindlingRewards(player, kindling, bonus) {
    const points = Math.max(0, Math.min(POINTS.CAP - this.kindlingPoints, kindling * POINTS.KINDLING + bonus));
    this.kindlingPoints += points;
    this.raid.addPoints(player, points);
  }

  extinguish(index) {
    const brazier = this.braziers.get(index);
    this.braziers.delete(index);
    if (brazier) Shared.replaceObject(this.map, brazier.object, OBJECT.BRAZIER);
  }

  defreeze() {
    this.stage = "thawing";
    const viewers = this.raiders();
    const lit = [...this.braziers.values()][0]?.object.getLocation();
    for (const index of [...this.braziers.keys()]) this.extinguish(index);
    this.brazierTiles().forEach((tile, index) => {
      Shared.graphicAt(viewers, GFX.SMOKE, tile, { height: 40, delay: index * 5 });
    });
    Shared.areaSound(viewers, SOUND.THAW, lit ?? this.brazierTiles()[0], { loops: 4, range: 8 });
    const icefiends = [...this.icefiends.values()].map(({ npc }) => npc);
    this.icefiends.clear();
    Shared.later(this.raid, THAW.WALK_AFTER, () => {
      const { Animation } = Shared.core();
      for (const npc of icefiends) {
        npc.performAnimation(new Animation(ANIM.ICEFIEND_DEATH));
        Shared.areaSound(this.raiders(), SOUND.ICEFIEND_DEATH, npc.getLocation(), { range: 10 });
      }
      const out = DEMON_TILES[this.record.variant][2];
      if (this.demon?.isRegistered()) Shared.walkStraight(this.demon, this.tile(out.x, out.y, 2));
    });
    Shared.later(this.raid, THAW.ICEFIENDS_GONE, () => {
      for (const npc of icefiends) this.removeNpc(npc);
    });
    Shared.later(this.raid, THAW.HOSTILE_AFTER, () => {
      if (!this.demon?.isRegistered()) return;
      this.demon.getMovementQueue().reset();
      this.demon.getMovementQueue().setBlockMovement?.(true);
      this.demon.setNpcTransformationId(NPC.DEMON);
      this.stage = "fighting";
      this.attackWait = 1;
    });
  }

  /** Every 3 ticks it attacks a raider in the room at random, from where it stands. */
  fight() {
    if (!this.demon?.isRegistered() || this.demon.getHitpoints() <= 0) return;
    if (--this.attackWait > 0) return;
    const targets = this.raiders().filter((player) => player.getHitpoints() > 0);
    if (!targets.length) {
      this.attackWait = 1;
      return;
    }
    this.attackWait = ATTACK.SPEED;
    this.attack(Shared.randomOf(targets));
  }

  /** Wiki: a third of all damage, except fire spells (250%) and demonbane weapons. */
  modifyHit(npc, hit) {
    if (npc !== this.demon) return;
    const attacker = hit.getAttacker?.();
    if (!attacker?.isPlayer?.()) return;
    const player = attacker.getAsPlayer();
    const spell = player.getCombat().getPreviousCast?.() ?? player.getCombat().getSelectedSpell?.();
    const magic = hit.getCombatType?.() === Shared.core().CombatType.MAGIC;
    const weapon = player.getEquipment().getItems()[Shared.core().Equipment.WEAPON_SLOT]?.getId?.();
    let factor = 1 / 3;
    if (magic && isFireSpell(spell)) factor = 2.5;
    else if (!magic && DEMONBANE.has(weapon)) factor = 1;
    for (const part of hit.getHits()) part.setDamage(Math.floor(part.getDamage() * factor));
    hit.updateTotalDamage();
  }

  /** It attacks with the style its target prays against, or either. */
  attack(target) {
    const style = Shared.isProtected(target, "ranged") ? "ranged"
      : Shared.isProtected(target, "magic") ? "magic" : Shared.randomOf(["ranged", "magic"]);
    const demon = this.demon;
    const at = target.getLocation().clone();
    demon.setPositionToFace(at);
    Shared.animate(demon, ANIM.CAST);
    const stats = demon.getDefinition().getStats();
    const scaled = (base, level) => Math.floor((base * (level + 9)) / (390 + 9));
    if (style === "ranged") {
      const cycles = boulderCycles(demon.getLocation().getDistance(at));
      this.projectile(at, PROJECTILE.BOULDER, cycles);
      Shared.areaSound(this.raiders(), SOUND.BOULDER, demon.getLocation(), { range: 10 });
      Shared.later(this.raid, Math.ceil(cycles / 30), () => {
        if (!demon.isRegistered()) return;
        Shared.graphicAt(this.raiders(), GFX.BOULDER_HIT, at, { height: 10 });
        Shared.areaSound(this.raiders(), SOUND.BOULDER_HIT, at, { range: 6 });
        for (const player of this.inBlast(at)) {
          Shared.strike(demon, player, "ranged", scaled(ATTACK.BOULDER_MAX, stats[3]), 0, { prayerMultiplier: 0.5 });
        }
      });
      return;
    }
    this.projectile(at, PROJECTILE.BURST, 60);
    Shared.areaSound(this.raiders(), SOUND.BURST, demon.getLocation(), { range: 10 });
    Shared.later(this.raid, 2, () => {
      if (!demon.isRegistered()) return;
      const { Location } = Shared.core();
      const viewers = this.raiders();
      for (const [dx, dy, delay] of BURST_TILES) {
        Shared.graphicAt(viewers, GFX.BURST_HIT, new Location(at.getX() + dx, at.getY() + dy, at.getZ()), { height: 10, delay });
      }
      Shared.areaSound(viewers, SOUND.BURST_HIT, at, { range: 6 });
      for (const player of this.inBlast(at)) {
        const hit = Shared.strike(demon, player, "magic", scaled(ATTACK.BURST_MAX, stats[4]), 0, { prayerMultiplier: 0.33 });
        if (hit.isAccurate?.() !== false) Shared.later(player, ATTACK.FREEZE_DELAY, () => freeze(player));
      }
    });
  }

  /** The raiders on the 3x3 around a tile. */
  inBlast(at) {
    return this.raiders().filter((player) => {
      const tile = player.getLocation();
      return tile.getZ() === at.getZ() && Math.abs(tile.getX() - at.getX()) <= 1 && Math.abs(tile.getY() - at.getY()) <= 1;
    });
  }

  /** A projectile from the demon's tile to a tile, flying from client cycle 51 to `cycles`. */
  projectile(at, { id, startHeight, endHeight }, cycles) {
    const { Projectile } = Shared.core();
    new Projectile(this.demon.getLocation(), at, null, id, PROJECTILE.DELAY, cycles, startHeight, endHeight, this.map)
      .withAngle(PROJECTILE.ANGLE)
      .sendProjectile();
  }

  onNpcDeath(npc, killer) {
    if (npc !== this.demon) return;
    this.stage = "dead";
    this.completed = true;
    // rsprox captures: the storm goes with the demon, 5 ticks after it starts dying.
    Shared.later(this.raid, 5, () => {
      if (this.storm) Shared.core().ObjectManager.deregister(this.storm, true);
      this.storm = null;
    });
    // Wiki: the drop is for each raider; the killer has theirs from its drop table.
    const { Item, ItemOnGroundManager } = Shared.core();
    const at = npc.getLocation().clone();
    for (const player of this.raiders()) {
      if (player === killer) continue;
      for (const [id, amount] of [[25766, 1], [20910, 7], [20911, 7], [20912, 5]]) {
        ItemOnGroundManager.registerLocation(player, new Item(id, amount), at);
      }
    }
  }
}

Raid.registerRoom("ICE_DEMON", IceDemonRoom);

/** Ice Burst's freeze: short, and renewed by any burst that finds the player no longer frozen. */
function freeze(player) {
  if (!player.isRegistered?.() || player.getHitpoints() <= 0) return;
  const { TimerKey } = Shared.core();
  const timers = player.getTimers();
  if (timers.has(TimerKey.FREEZE)) return;
  timers.registers(TimerKey.FREEZE, ATTACK.FREEZE_TICKS);
  player.getMovementQueue().reset();
  player.sendMessage(FROZEN_MESSAGE);
}

function roomOf(player) {
  const room = Raid.raidOf(player)?.roomAt(player.getLocation());
  return room instanceof IceDemonRoom ? room : null;
}

/** Lighting tries every tick until it catches; fuelling adds all the kindling held. */
function useBrazier(event) {
  const { player, object } = event;
  const room = roomOf(player);
  if (!room) return false;
  const index = room.brazierIndex(object.getLocation());
  if (index < 0) return true;
  if (room.stage !== "frozen") {
    player.sendMessage("That's not going to help now.");
    return true;
  }
  if (object.getId() === OBJECT.LIT_BRAZIER) {
    if (!Shared.has(player, KINDLING)) Shared.statement(player, NEED_MESSAGE);
    else room.fuel(player, index);
    return true;
  }
  if (!Shared.has(player, KINDLING) || !Shared.has(player, TINDERBOX)) {
    Shared.statement(player, NEED_MESSAGE);
    return true;
  }
  const attempt = () => {
    if (room.stage !== "frozen" || room.braziers.has(index)) return false;
    if (!Shared.has(player, KINDLING) || !Shared.has(player, TINDERBOX)) return false;
    Shared.animate(player, ANIM.LIGHT);
    Shared.areaSound(room.raiders(), SOUND.LIGHT, object.getLocation(), { range: 4 });
    if (Math.random() < lightChance(Shared.level(player, "FIREMAKING"))) {
      Shared.later(player, 1, () => room.light(player, object, index));
      return false;
    }
    return true;
  };
  if (attempt()) Shared.action(player, { first: 1, interval: 1, step: attempt });
  return true;
}

/**
 * The thawed demon's combat method: it never chases or retaliates on its own; its room picks
 * a raider and attacks every 3 ticks.
 */
function demonCombat(api) {
  const { CombatMethod, CombatType } = api.core;
  return class IceDemonCombat extends CombatMethod {
    type() {
      return CombatType.MAGIC;
    }

    attackDistance() {
      return 64;
    }

    attackSpeed() {
      return ATTACK.SPEED;
    }

    canAttack() {
      return false;
    }

    canPursue() {
      return false;
    }

    start() {}

    hits() {
      return [];
    }
  };
}

function frozenDemon(event) {
  const target = event.target;
  if (target?.getId?.() !== NPC.FROZEN || !(target.__coxRoom instanceof IceDemonRoom)) return;
  event.allow = false;
  if (event.attacker?.isPlayer?.()) event.attacker.getAsPlayer().sendMessage("It's protected by the ice storm.");
}

module.exports = function registerCoxIceDemon(api) {
  Shared.bind(api);
  Shared.onObjectIds(api, [OBJECT.BRAZIER, OBJECT.LIT_BRAZIER], useBrazier);
  api.registerNpcCombatMethodProvider([NPC.DEMON], demonCombat(api));
  Raid.onRaidArea("canAttack", frozenDemon);
};

Object.assign(module.exports, { IceDemonRoom, lightChance, thawRate, stormFill, boulderCycles, BURST_TILES });
