"use strict";

/**
 * The Corporeal Beast's attacks.
 *
 * Wiki ("Corporeal Beast/Strategies", Mechanics):
 * - An attack every 4 ticks. In melee range: melee 40% of the time and each magic attack 20%;
 *   out of it, each magic attack a third of the time.
 * - Melee: up to 33, fully blocked by Protect from Melee.
 * - Magic: up to 65. Protect from Magic only takes a third off this and the next two.
 * - Draining magic: up to 55; a hit drains Magic or Prayer by 1 or 2 and heals the Beast by
 *   half the damage.
 * - Splitting magic at the player's tile: up to 40 there and 30 beside it; it then splits
 *   into six that land in the 7x7 around it, each up to 30 on its tile and 20 beside it.
 * Capture (corp.txt):
 * - Attacks on ticks 69, 73, 77, 81, 85, 89 and 93.
 * - The splitting attack is anim 1679 with projectile 315 from the Beast's centre to the tile:
 *   start 21, 10 cycles a tile, heights 190 to 0. Where it lands: splash 1836, then six 315s
 *   from that tile (start 10, end 31 + 10 a tile, heights 0) each with a 1836 splash as it lands.
 * - The draining attack is anim 1681 with projectile 314 (21 to 41, end height 124), with
 *   "Your Prayer has been slightly drained!" / "Your Magic has been slightly drained!" - on
 *   every hit that landed, a 0 included.
 * - The melee swipe is anim 1683.
 * RuneLite (gameval): the plain magic attack is CORPBEAST_SPRITE_SHOOT_2 (1680) with
 * CORP_SPIRIT_BEAST_STRONG_PROJ (316). Its projectile timing is assumed to be the others'.
 * Heights here are a quarter of the capture's (the packet multiplies them by 4).
 */

const Shared = require("./CorpShared");

const SIZE = 5;
const ATTACK = { speed: 4, range: 15, meleeChance: 0.4 };
const MELEE = { anim: 1683, max: 33 };
const MAGIC = {
  plain: { anim: 1680, projectile: 316, max: 65 },
  drain: { anim: 1681, projectile: 314, max: 55, drainMin: 1, drainMax: 2 },
  split: { anim: 1679, projectile: 315, max: 40, adjacentMax: 30 },
};
const PROJECTILE = { start: 21, perTile: 10, startHeight: 47, endHeight: 31 };
const SPLIT = { count: 6, radius: 3, max: 30, adjacentMax: 20, splash: 1836, start: 10, base: 31, perTile: 10 };
const PROTECT_MAGIC_KEEPS = 2 / 3;

let MethodClass = null;

function tileOf(entity) {
  return { x: entity.getLocation().getX(), y: entity.getLocation().getY(), z: entity.getLocation().getZ() };
}

function centreOf(npc) {
  const { x, y, z } = tileOf(npc);
  return { x: x + (SIZE >> 1), y: y + (SIZE >> 1), z };
}

function distance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Beside one of the Beast's sides (not a corner): where its claws reach. */
function inMeleeRange(npc, player) {
  const { x, y } = tileOf(npc);
  const p = tileOf(player);
  const alongX = p.x >= x && p.x < x + SIZE;
  const alongY = p.y >= y && p.y < y + SIZE;
  return (alongX && (p.y === y - 1 || p.y === y + SIZE)) || (alongY && (p.x === x - 1 || p.x === x + SIZE));
}

/** Which attack: melee 40% when in reach, else an even pick of the three magic attacks. */
function choose(npc, player, random = Math.random) {
  if (inMeleeRange(npc, player) && random() < ATTACK.meleeChance) return "melee";
  return ["plain", "drain", "split"][Math.floor(random() * 3)];
}

function ticksFor(cycles) {
  return Math.max(1, Math.ceil(cycles / 30));
}

function projectile(from, to, id, start, end, startHeight, endHeight, lockon = null) {
  const { Projectile } = Shared.core();
  new Projectile(Shared.loc(from), Shared.loc(to), lockon, id, start, end, startHeight, endHeight, null).sendProjectile();
}

/** Protect from Magic takes only a third off the Beast's magic (Wiki). */
function rollMagic(npc, player, method, max, delay) {
  const { CombatFactory, CombatType, PendingHit, PrayerHandler } = Shared.core();
  // A split lands after the next attack may have turned the method to melee.
  const stance = method.stance;
  method.stance = CombatType.MAGIC;
  const hit = new PendingHit(npc, player, method, delay);
  method.stance = stance;
  CombatFactory.applyStyleDamage(hit, max, { bypassProtectionPrayer: true });
  if (PrayerHandler.isActivated(player, PrayerHandler.PROTECT_FROM_MAGIC)) {
    for (const part of hit.getHits()) part.setDamage(Math.floor(part.getDamage() * PROTECT_MAGIC_KEEPS));
    hit.updateTotalDamage();
  }
  return hit;
}

const SPECTRAL_SPIRIT_SHIELD = 12821;

function wearsSpectral(player) {
  const { Equipment } = Shared.core();
  return player.getEquipment?.().getItems?.()[Equipment.SHIELD_SLOT]?.getId?.() === SPECTRAL_SPIRIT_SHIELD;
}

function drainOnLanding(npc, player, hit, ticks) {
  if (!hit.isAccurate()) return;
  Shared.later(npc, ticks, () => {
    if (player.getHitpoints() <= 0) return;
    const { Skill } = Shared.core();
    const skill = Math.random() < 0.5 ? Skill.PRAYER : Skill.MAGIC;
    let amount = Shared.randomInclusive(MAGIC.drain.drainMin, MAGIC.drain.drainMax);
    // The spectral spirit shield halves prayer drains (Wiki).
    if (skill === Skill.PRAYER && wearsSpectral(player)) amount = Math.floor(amount / 2);
    player.getSkillManager().decreaseCurrentLevel(skill, amount, 0);
    player.sendMessage(`Your ${skill === Skill.PRAYER ? "Prayer" : "Magic"} has been slightly drained!`);
    npc.heal(Math.floor(hit.getTotalDamage() / 2));
  });
}

/** Up to `max` on the tile and `adjacentMax` beside it, to each player there. */
function blast(npc, method, tile, max, adjacentMax) {
  const { CombatFactory } = Shared.core();
  for (const player of Shared.playersNear(npc)) {
    const reach = distance(tileOf(player), tile);
    if (reach > 1) continue;
    CombatFactory.addPendingHit(rollMagic(npc, player, method, reach === 0 ? max : adjacentMax, 0));
  }
}

function freeTile(tile) {
  const { RegionManager } = Shared.core();
  return (RegionManager.getClipping(tile.x, tile.y, tile.z) & 0x1280100) === 0;
}

/** Six tiles in the 7x7 around the landing, each different and walkable (capture: six). */
function splitTiles(centre, random = Math.random) {
  const tiles = [];
  for (let tries = 0; tiles.length < SPLIT.count && tries < 100; tries++) {
    const tile = {
      x: centre.x + Math.floor(random() * (SPLIT.radius * 2 + 1)) - SPLIT.radius,
      y: centre.y + Math.floor(random() * (SPLIT.radius * 2 + 1)) - SPLIT.radius,
      z: centre.z,
    };
    if ((tile.x === centre.x && tile.y === centre.y) || !freeTile(tile)) continue;
    if (tiles.some((other) => other.x === tile.x && other.y === tile.y)) continue;
    tiles.push(tile);
  }
  return tiles;
}

/** The splitting attack: the shot to the tile, then the six splits from where it lands. */
function split(npc, method, tile) {
  const from = centreOf(npc);
  const end = PROJECTILE.start + distance(from, tile) * PROJECTILE.perTile;
  projectile(from, tile, MAGIC.split.projectile, PROJECTILE.start, end, PROJECTILE.startHeight, 0);
  Shared.later(npc, ticksFor(end), () => {
    if (npc.getHitpoints() <= 0) return;
    const players = Shared.playersNear(npc);
    Shared.tileGraphic(players, SPLIT.splash, tile);
    blast(npc, method, tile, MAGIC.split.max, MAGIC.split.adjacentMax);
    for (const target of splitTiles(tile)) {
      const landing = SPLIT.base + distance(tile, target) * SPLIT.perTile;
      projectile(tile, target, MAGIC.split.projectile, SPLIT.start, landing, 0, 0);
      Shared.tileGraphic(players, SPLIT.splash, target, landing);
      Shared.later(npc, ticksFor(landing), () => {
        if (npc.getHitpoints() > 0) blast(npc, method, target, SPLIT.max, SPLIT.adjacentMax);
      });
    }
  });
}

function method() {
  if (MethodClass) return MethodClass;
  const { Animation, CombatFactory, CombatMethod, CombatType, PendingHit } = Shared.core();
  MethodClass = class CorporealBeastMethod extends CombatMethod {
    constructor() {
      super();
      this.stance = CombatType.MAGIC;
      this.next = null;
    }

    type() {
      return this.stance;
    }

    attackSpeed() {
      return ATTACK.speed;
    }

    attackDistance() {
      return ATTACK.range;
    }

    start(npc, target) {
      require("./DarkCore.CorporealBeast").beastAttacks(npc);
      const attack = choose(npc, target);
      this.next = attack;
      if (attack === "melee") {
        this.stance = CombatType.MELEE;
        npc.performAnimation(new Animation(MELEE.anim));
        return;
      }
      this.stance = CombatType.MAGIC;
      const shot = MAGIC[attack];
      npc.performAnimation(new Animation(shot.anim));
      if (attack === "split") {
        split(npc, this, tileOf(target));
        return;
      }
      const from = centreOf(npc);
      const end = PROJECTILE.start + distance(from, tileOf(target)) * PROJECTILE.perTile;
      projectile(from, tileOf(target), shot.projectile, PROJECTILE.start, end, PROJECTILE.startHeight, PROJECTILE.endHeight, target);
      this.landing = ticksFor(end);
    }

    hits(npc, target) {
      if (this.next === "melee") {
        const hit = new PendingHit(npc, target, this, 0);
        CombatFactory.applyStyleDamage(hit, MELEE.max);
        return [hit];
      }
      if (this.next === "split") return [];
      const shot = MAGIC[this.next];
      const hit = rollMagic(npc, target, this, shot.max, this.landing);
      if (this.next === "drain") drainOnLanding(npc, target, hit, this.landing);
      return [hit];
    }
  };
  return MethodClass;
}

module.exports = {
  ATTACK, MELEE, MAGIC, SPLIT, PROTECT_MAGIC_KEEPS,
  method, choose, inMeleeRange, splitTiles, rollMagic, centreOf,
};
