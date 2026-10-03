"use strict";

/**
 * The Crystalline and Corrupted Hunllef (Wiki, both use the same mechanics):
 * - 600 / 1000 hitpoints, an attack every 5 ticks; Ranged first, switching between Ranged and
 *   Magic every 4 attacks (tornado and prayer-disabling attacks count, the stomp does not), with
 *   an animation as it switches;
 * - it protects against one style; every 6th off-prayer hit, zero hits included, it switches to
 *   protect against that hit's style. Hits it protects against do nothing;
 * - a stomp if the player stands under it when it attacks;
 * - tornadoes that chase the player for 20 ticks: Crystalline 1 / 2 / 3, Corrupted 2 / 3 / 4,
 *   above 66% / 33-66% / below 33% of its hitpoints;
 * - floor tiles that turn blue (Corrupted: crimson) then orange; orange tiles hurt 10-20 a tick.
 *   Three sets of patterns by those thirds, turning orange faster each time.
 *
 * Max hits by full crystal armour tier (none / basic / attuned / perfected), Wiki:
 * - Crystalline, correct protection prayer: 12 / 10 / 8 / 6;
 * - Corrupted: 16 / 13 / 10 / 8 with it, 68 / 55 / 45 / 35 without; stomp up to 68.
 * The Wiki gives no Crystalline maxes without prayer: they are the Corrupted ratio per tier
 * (51 / 42 / 36 / 26), and its stomp the unprotected, unarmoured max.
 *
 * Near-Reality's (the Wiki gives none): the ids, animations and projectiles, a tornado summon
 * every 56 ticks, a floor pattern every 30, orange for 6 ticks, and a 15% chance for a magic
 * attack to disable prayers. The patterns are Near-Reality's three sets.
 */

const Shared = require("./GauntletShared");
const Items = require("./GauntletItems");
const GauntletMap = require("./GauntletMap");
const Resources = require("./GauntletResources");

const IDS = {
  regular: { melee: 9021, ranged: 9022, magic: 9023, tornado: 9025, floor: 36149 },
  corrupted: { melee: 9035, ranged: 9036, magic: 9037, tornado: 9039, floor: 36046 },
};
const STYLES = ["melee", "ranged", "magic"];
// Its overhead prayer: an index in the headicons_prayer sprites.
const HEAD_ICON = { melee: 0, ranged: 1, magic: 2 };
const HITPOINTS = { regular: 600, corrupted: 1000 };
const MAX_HIT = {
  regular: { prayed: [12, 10, 8, 6], unprayed: [51, 42, 36, 26], stomp: 51 },
  corrupted: { prayed: [16, 13, 10, 8], unprayed: [68, 55, 45, 35], stomp: 68 },
};
const TORNADO_DAMAGE = {
  regular: [[10, 20], [10, 16], [7, 13], [5, 10]],
  corrupted: [[15, 30], [15, 25], [10, 20], [7, 15]],
};
const TORNADOES = { regular: [1, 2, 3], corrupted: [2, 3, 4] };

const ATTACK_SPEED = 5;
const ATTACKS_PER_STYLE = 4;
const OFF_PRAYER_HITS_PER_SWITCH = 6;
const FIRST_ATTACK_TICKS = 2;
const TORNADO_EVERY = 56;
const TORNADO_TICKS = 20;
const PATTERN_EVERY = 30;
const FIRST_PATTERN_TICKS = 4;
const BLUE_TICKS = [5, 4, 3];
const ORANGE_TICKS = 6;
const FLOOR_DAMAGE = [10, 20];
const DISABLE_PRAYER_CHANCE = 0.15;

const ANIMATION = { ATTACK: 8419, TORNADO: 8418, STOMP: 8420, SWITCH: 8754 };
const PROJECTILE = {
  regular: { ranged: 1711, magic: 1707, disable: 1713 },
  corrupted: { ranged: 1712, magic: 1708, disable: 1714 },
};
const TORNADO_HIT_GRAPHIC = 1717;
// From the boss room's corner: the arena floor, and where the Hunllef stands.
const ARENA = { min: 2, size: 12 };
const SPAWN = { x: 6, y: 7 };
const SIZE = 5;
// Near-Reality's: it closes in until the player is within 5 tiles of it, then holds.
const ATTACK_DISTANCE = 5;

/** Near-Reality's three sets of floor patterns, as arena offsets. */
function square(size, x, y) {
  const tiles = [];
  for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) tiles.push([x + i, y + j]);
  return tiles;
}

function rectangle(width, height, x, y) {
  const tiles = [];
  for (let i = 0; i < width; i++) for (let j = 0; j < height; j++) tiles.push([x + i, y + j]);
  return tiles;
}

const EASY = [
  square(6, 0, 0), square(6, 6, 0), square(6, 0, 6), square(6, 6, 6),
  square(6, 2, 2), square(6, 4, 2), square(6, 2, 4), square(6, 4, 4),
  rectangle(4, 12, 0, 0), rectangle(4, 12, 8, 0), rectangle(12, 4, 0, 0), rectangle(12, 4, 0, 8),
];
const MEDIUM = [
  ...EASY,
  [...rectangle(4, 12, 0, 0), ...rectangle(4, 12, 8, 0)],
  [...rectangle(12, 4, 0, 0), ...rectangle(12, 4, 0, 8)],
];
const HARD = [
  [...square(3, 0, 0), ...square(3, 9, 0), ...square(3, 0, 9), ...square(3, 9, 9), ...square(4, 4, 4)],
  [...rectangle(2, 12, 0, 0), ...rectangle(2, 12, 10, 0), ...rectangle(8, 2, 2, 0), ...rectangle(8, 2, 2, 10)],
  [...square(4, 1, 1), ...square(4, 7, 1), ...square(4, 1, 7), ...square(4, 7, 7)],
  [...square(4, 0, 0), ...square(4, 8, 0), ...square(4, 0, 8), ...square(4, 8, 8)],
];
const PATTERNS = [EASY, MEDIUM, HARD];

function randomInt(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

/** The lowest tier of a full crystal set worn: 0 none (or not a full set), 1-3 basic-perfected. */
function armourTier(player, mode) {
  const items = Items.itemsFor(mode);
  let tier = 3;
  for (const piece of ["helm", "body", "legs"]) {
    const worn = items[piece].findIndex((id) => player.getEquipment().contains(id));
    if (worn < 0) return 0;
    tier = Math.min(tier, worn + 1);
  }
  return tier;
}

function protects(player, style) {
  const { PrayerHandler } = Shared.core();
  const prayer = style === "magic" ? PrayerHandler.PROTECT_FROM_MAGIC : PrayerHandler.PROTECT_FROM_MISSILES;
  return PrayerHandler.isActivated(player, prayer);
}

function damage(target, amount) {
  const { HitDamage, HitMask } = Shared.core();
  if (!target || target.getHitpoints() <= 0) return;
  target.getCombat().getHitQueue().addPendingDamage([new HitDamage(Math.max(0, Math.trunc(amount)), amount > 0 ? HitMask.RED : HitMask.BLUE)]);
}

/** A combat style key for a hit's combat type. */
function styleOf(combatType) {
  const { CombatType } = Shared.core();
  if (combatType === CombatType.MAGIC) return "magic";
  if (combatType === CombatType.RANGED) return "ranged";
  return "melee";
}

class HunllefFight {
  constructor(run) {
    this.run = run;
    this.mode = run.mode;
    this.random = run.random;
    this.ids = IDS[this.mode];
    this.protecting = STYLES[Math.floor(this.random() * STYLES.length)];
    this.style = "ranged";
    this.attacks = 0;
    this.offPrayerHits = 0;
    this.ticks = 0;
    this.nextAttack = 0;
    this.nextTornado = TORNADO_EVERY;
    this.nextPattern = FIRST_PATTERN_TICKS;
    this.tornadoes = [];
    this.floor = new Map();
    this.task = null;
    this.npc = this.spawn();
  }

  room() {
    return this.run.map.room(GauntletMap.CENTRE, GauntletMap.CENTRE);
  }

  arenaTile(x, y) {
    return this.run.map.roomTile(this.room(), ARENA.min + x, ARENA.min + y);
  }

  spawn() {
    const tile = this.run.map.roomTile(this.room(), SPAWN.x, SPAWN.y);
    const npc = Shared.api().spawnNpc({ id: this.ids[this.protecting], x: tile.getX(), y: tile.getY(), z: tile.getZ(), wanderRadius: 0 });
    if (!npc) return null;
    npc.__skipDefaultRespawn = true;
    npc.__gauntletRun = this.run;
    npc.__gauntletScripted = true;
    npc.__gauntletHunllef = this;
    npc.setFlag("combat:no-retaliate");
    npc.setFlag("interaction:keep");
    npc.setHeadIcon(HEAD_ICON[this.protecting]);
    npc.getMovementQueue().setBlockMovement(true);
    this.run.map.add(npc);
    return npc;
  }

  /** The fight begins: the Hunllef starts attacking. */
  start() {
    if (this.task || !this.npc) return;
    this.nextAttack = FIRST_ATTACK_TICKS;
    this.npc.getMovementQueue().setBlockMovement(false);
    this.npc.setMobileInteraction?.(this.run.player);
    this.task = Shared.repeat(this, 1, () => this.tick());
  }

  stop() {
    this.task?.stop?.();
    this.task = null;
    for (const tornado of this.tornadoes) Shared.api().removeNpc(tornado.npc);
    this.tornadoes = [];
    this.floor.clear();
  }

  phase() {
    const left = this.npc.getHitpoints() / HITPOINTS[this.mode];
    return left > 2 / 3 ? 0 : left > 1 / 3 ? 1 : 2;
  }

  tick() {
    const player = this.run.player;
    if (this.run.stage !== "boss" || !this.npc || this.npc.getHitpoints() <= 0 || player.getHitpoints?.() <= 0) {
      this.stop();
      return false;
    }
    this.ticks++;
    if (this.npc.getInteractingMobile?.() !== player) this.npc.setMobileInteraction?.(player);
    this.approach(player);
    this.tickTornadoes(player);
    this.tickFloor(player);
    if (this.ticks === this.nextPattern) this.startPattern();
    if (this.ticks === this.switchAt) this.npc.performAnimation(new (Shared.core().Animation)(ANIMATION.SWITCH));
    if (this.ticks >= this.nextAttack) this.attack(player);
    return true;
  }

  // -------------------------------------------------------------- attacks

  /** Tiles between the player and the Hunllef's 5x5 body (0 under it). */
  distanceTo(player) {
    const npcTile = this.npc.getLocation();
    const here = player.getLocation();
    const gap = (value, from) => Math.max(0, from - value, value - (from + SIZE - 1));
    return Math.max(gap(here.getX(), npcTile.getX()), gap(here.getY(), npcTile.getY()));
  }

  /** One step closer while the player is out of its reach, around the arena's walls. */
  approach(player) {
    if (this.distanceTo(player) <= ATTACK_DISTANCE) return;
    const { RegionManager } = Shared.core();
    const from = this.npc.getLocation();
    const centre = (axis) => axis + Math.floor(SIZE / 2);
    const dx = Math.sign(player.getLocation().getX() - centre(from.getX()));
    const dy = Math.sign(player.getLocation().getY() - centre(from.getY()));
    for (const [x, y] of [[dx, dy], [dx, 0], [0, dy]]) {
      if (x === 0 && y === 0) continue;
      if (!RegionManager.canMove(from.getX(), from.getY(), from.getX() + x, from.getY() + y, from.getZ(), SIZE, SIZE, this.run.map)) continue;
      const movement = this.npc.getMovementQueue();
      movement.reset();
      movement.addSteps(from.transform(x, y));
      return;
    }
  }

  underneath(player) {
    const npcTile = this.npc.getLocation();
    const x = player.getLocation().getX() - npcTile.getX();
    const y = player.getLocation().getY() - npcTile.getY();
    return x >= 0 && y >= 0 && x < SIZE && y < SIZE;
  }

  attack(player) {
    const { Animation } = Shared.core();
    this.nextAttack = this.ticks + ATTACK_SPEED;
    if (this.underneath(player)) {
      // The stomp is not one of the four attacks before a switch.
      this.npc.performAnimation(new Animation(ANIMATION.STOMP));
      damage(player, randomInt(this.random, 0, MAX_HIT[this.mode].stomp));
      player.sendMessage(`You're trampled beneath the ${this.mode === "corrupted" ? "Corrupted" : "Crystalline"} Hunllef.`);
      return;
    }
    if (this.ticks >= this.nextTornado) {
      this.summonTornadoes(player);
    } else {
      this.standardAttack(player);
    }
    this.attacks++;
    if (this.attacks % ATTACKS_PER_STYLE === 0) {
      this.style = this.style === "ranged" ? "magic" : "ranged";
      this.switchAt = this.ticks + 1;
    }
  }

  standardAttack(player) {
    const { Animation, Projectile, PrayerHandler } = Shared.core();
    this.npc.performAnimation(new Animation(ANIMATION.ATTACK));
    const disable = this.style === "magic" && this.random() < DISABLE_PRAYER_CHANCE;
    const projectileId = PROJECTILE[this.mode][disable ? "disable" : this.style];
    const speed = Projectile.arrivalCycles(this.npc, player, 45);
    Projectile.createProjectile(this.npc, player, projectileId, 45, speed, 50, 25).sendProjectile();
    const tier = armourTier(player, this.mode);
    const style = this.style;
    Shared.later(this, Math.max(1, Math.ceil(speed / 30)), () => {
      if (this.run.stage !== "boss") return;
      const max = MAX_HIT[this.mode][protects(player, style) ? "prayed" : "unprayed"][tier];
      damage(player, randomInt(this.random, 0, max));
      if (disable) {
        PrayerHandler.deactivatePrayers(player);
        player.sendMessage("<col=ff0000>Your prayers have been disabled!</col>");
      }
    });
  }

  // -------------------------------------------------------------- tornadoes

  summonTornadoes(player) {
    const { Animation } = Shared.core();
    this.npc.performAnimation(new Animation(ANIMATION.TORNADO));
    this.nextTornado = this.ticks + TORNADO_EVERY;
    const count = TORNADOES[this.mode][this.phase()];
    for (let i = 0; i < count; i++) {
      let tile;
      do {
        tile = this.arenaTile(randomInt(this.random, 0, ARENA.size - 1), randomInt(this.random, 0, ARENA.size - 1));
      } while (tile.equals(player.getLocation()));
      const npc = Shared.api().spawnNpc({ id: this.ids.tornado, x: tile.getX(), y: tile.getY(), z: tile.getZ(), wanderRadius: 0 });
      if (!npc) continue;
      npc.__skipDefaultRespawn = true;
      npc.__gauntletRun = this.run;
      npc.__gauntletScripted = true;
      npc.setFlag("combat:no-retaliate");
      this.run.map.add(npc);
      this.tornadoes.push({ npc, left: TORNADO_TICKS });
    }
  }

  tickTornadoes(player) {
    const { Graphic } = Shared.core();
    const [min, max] = TORNADO_DAMAGE[this.mode][armourTier(player, this.mode)];
    for (const tornado of [...this.tornadoes]) {
      if (--tornado.left < 0) {
        this.tornadoes.splice(this.tornadoes.indexOf(tornado), 1);
        this.run.map.detach(tornado.npc);
        Shared.api().removeNpc(tornado.npc);
        continue;
      }
      if (tornado.npc.getLocation().equals(player.getLocation())) {
        damage(player, randomInt(this.random, min, max));
        player.performGraphic(new Graphic(TORNADO_HIT_GRAPHIC));
      }
      walkToward(tornado.npc, player.getLocation());
    }
  }

  // -------------------------------------------------------------- floor

  startPattern() {
    const phase = this.phase();
    const patterns = PATTERNS[phase];
    const pattern = patterns[Math.floor(this.random() * patterns.length)];
    this.nextPattern = this.ticks + PATTERN_EVERY;
    const orangeAt = this.ticks + BLUE_TICKS[phase];
    for (const [x, y] of pattern) {
      const key = `${x},${y}`;
      if (this.floor.has(key)) continue;
      this.floor.set(key, { x, y, orangeAt, clearAt: orangeAt + ORANGE_TICKS, state: "blue" });
      this.setFloor(x, y, 1);
    }
  }

  tickFloor(player) {
    const here = player.getLocation();
    for (const [key, tile] of [...this.floor]) {
      if (this.ticks >= tile.clearAt) {
        this.floor.delete(key);
        this.setFloor(tile.x, tile.y, 0);
        continue;
      }
      if (tile.state === "blue" && this.ticks >= tile.orangeAt) {
        tile.state = "orange";
        this.setFloor(tile.x, tile.y, 2);
      }
      if (tile.state === "orange" && this.arenaTile(tile.x, tile.y).equals(here)) {
        damage(player, randomInt(this.random, ...FLOOR_DAMAGE));
      }
    }
  }

  /** Floor tile look: 0 plain, 1 blue (crimson), 2 orange - the floor loc and the next two ids. */
  setFloor(x, y, look) {
    const map = this.run.map;
    const tile = this.arenaTile(x, y);
    const current = map.getObjects().find((object) => object.getType() === 22 && object.getLocation().equals(tile))
      ?? map.getTemplateObject(tile, 22);
    if (!current) return;
    const id = this.ids.floor + look;
    if (current.getId() !== id) Resources.replaceObject(map, current, id);
  }

  // -------------------------------------------------------------- the player's hits

  /** Hits it protects against do nothing; every 6th other hit changes what it protects against. */
  onHit(hit) {
    const style = styleOf(hit.getCombatType?.());
    if (style === this.protecting) {
      for (const part of hit.getHits()) part.setDamage(0);
      hit.updateTotalDamage();
      return;
    }
    this.offPrayerHits++;
    if (this.offPrayerHits >= OFF_PRAYER_HITS_PER_SWITCH) {
      this.offPrayerHits = 0;
      this.protecting = style;
      this.npc.setNpcTransformationId(this.ids[style]);
      this.npc.setHeadIcon(HEAD_ICON[style]);
    }
  }
}

/** One step toward a tile, ignoring collision (tornadoes cross the arena freely). */
function walkToward(npc, target) {
  const from = npc.getLocation();
  const dx = Math.sign(target.getX() - from.getX());
  const dy = Math.sign(target.getY() - from.getY());
  if (dx === 0 && dy === 0) return;
  npc.setFlag("movement:ignore-clipping");
  const movement = npc.getMovementQueue();
  movement.setBlockMovement?.(false);
  movement.reset();
  movement.addSteps(from.transform(dx, dy));
}

module.exports = { HunllefFight, IDS, HEAD_ICON, MAX_HIT, TORNADO_DAMAGE, TORNADOES, PATTERNS, armourTier, HITPOINTS };
