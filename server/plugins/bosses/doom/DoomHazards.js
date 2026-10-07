"use strict";

/**
 * Everything in the arena besides the Doom: larvae, thrown rocks, volatile earth and the
 * earthen shield.
 *
 * Captures (delves 1-5):
 * - Larvae drop with some of the Doom's attacks (DoomBoss), about four tiles past the player on
 *   the side away from it, with graphic 3417 and anim 12458; two side by side at delve 5. At
 *   delves 1-2 half pray Melee (headicon 0), at delve 3 any prayer (0-2); coloured larvae from
 *   delve 4 show the two prayers they use (6 melee, 7 magic, 8 ranged). They crawl a tile every
 *   2 ticks (melee ones often every tick) to the Doom's centre tile, where they vanish: the
 *   charge varbit (17758) goes up, the player takes graphic 3426 and a hit of the charge, and the
 *   Doom heals 9 plus the charge. Killed, a larva plays 12459, its 3x3 shows graphic 3374, and it
 *   goes the next tick; hitting it with the style it prays says "The demonic larva seems
 *   resistant to your attack." (purple).
 * - A rock bursts (graphic 3386/3387 where it lands) into pieces, one on the player's tile and
 *   the rest within four tiles: 8 at delve 1, 12, 15, 17, 18 at delve 5 (projectiles 3388-3395,
 *   heights 500 to 0, 60 + 3 cycles a tile, a shadow 2380 under each). The player's protection
 *   prayers go off. Two ticks later the impacts (3404) are sent, each delayed to its piece; the
 *   next tick a rock (57286) stands where the player was, a player still there is hit and thrown
 *   aside (anim 1114), and the rock's orbs leave from the pieces' tiles together (height 100),
 *   landing a tick apart from cycle 90 (150 at delve 2), alternating styles from the rock's.
 * - Rocks and acid stay from delve to delve.
 * - Volatile earth (14714): see EARTH.
 * Wiki: larvae have 2 hitpoints and take 1 damage a hit unless it's demonbane, multi-hit or
 *   the Eye of Ayak; killed, they explode for up to 21 in a 3x3, or 5-10 to the Doom instead
 *   if it is caught (sparing the player). Getting hit by any piece of rock deals up to 21. The
 *   earthen shield (14715) appears at the second volatile earth destroyed and walks to the first
 *   (half walking speed at delve 1), diagonally first, and goes when it arrives or the
 *   shockwaves end; standing in it is safe from them. Demonic charge carries over between
 *   delves. Coloured larvae take only their colour's style; melee ones come only during the
 *   shield; two at a time at delves 5-7; from delve 8 giant ones (14788/14789: 4 hitpoints, a
 *   4x4 blast, tripled penalties). Larvae give up after about 20 seconds once the Doom has
 *   burrowed elsewhere. From delve 7 a rock's orbs land 2 ticks after its debris; at delve 8 two
 *   rocks are thrown, their debris never overlapping.
 * In game (player report): larvae path around rocks rather than crawling through them, and a
 *   larva reaching the Doom hurts the player at most 12 (20 from delve 8, 30 for a giant).
 * Guesses: a giant larva one time in three at delve 8, adding one charge; one more piece of rock
 *   a delve after delve 5; orbs from cycle 30 from delve 7; a larva walled in by rocks crawls
 *   straight on, through them.
 */

const Shared = require("./DoomShared");

const LARVA = {
  hp: 2, crawlTicks: 2, spawnGfx: 3417, spawnAnim: 12458, impactGfx: 3426,
  damageCap: { normal: 12, deep: 20, giant: 30 },
  explosion: 21, bossDamage: [5, 10], heal: 9, lifetime: 33, past: [3, 5], deathAnim: 12459, blastGfx: 3374,
};
const HEAD_ICON = { melee: 0, ranged: 1, magic: 2 };
const COLOURED_ICON = { melee: 6, magic: 7, ranged: 8 };
const RESISTANT = "<col=a53fff>The demonic larva seems resistant to your attack.</col>";
const DEMONBANE = new Set([
  2402, 6745, 6746, 8279, 8281, 16900, 16901, 17755, 19675, 19676, 29577, 29578, 29579, 29589, 29590,
  29591, 29592, 29594, 29595, 31113, 31114,
]);

const ROCK = {
  splitGfx: { ranged: 3386, magic: 3387 },
  debris: [3388, 3389, 3390, 3391, 3392, 3393, 3394, 3395],
  impactGfx: 3404, shadowGfx: 2380, spread: 4, damage: 21, pushAnim: 1114,
  landTicks: 2, rockTicks: 3,
  /** Capture: pieces of rock, the player's tile included, by delve (guess: one more a delve after 5). */
  pieces: [8, 12, 15, 17, 18],
  /**
   * Capture: the orbs leave together, landing a tick apart from cycle 90 (150 at delve 2).
   * Wiki: from delve 7 they land 2 ticks after the debris (guess: from cycle 30).
   */
  orbFirst: { 1: 90, 2: 150 },
  fastOrbFirst: 30,
  orbHeight: 100,
};

function rockPieces(level) {
  const table = ROCK.pieces;
  return level <= table.length ? table[level - 1] : table[table.length - 1] + (level - table.length);
}

function rockOrbFlight(level, index) {
  const first = level >= 7 ? ROCK.fastOrbFirst : (ROCK.orbFirst[level] ?? ROCK.orbFirst[1]);
  return { delay: 0, end: first + 30 * index, startHeight: ROCK.orbHeight, endHeight: ROCK.orbHeight };
}

/**
 * Capture: four shockwaves put 19-28 volatile earth on tiles of one pool of 39 (delve 1's frame),
 * and an earlier capture put 22 on 22 of them. Spawn anim 12432; the destroyed ones pop (12434)
 * and, once the shield appears (12436), the rest die (12433) and go 2 ticks later.
 */
const EARTH = {
  anim: 12432, pop: 12434, death: 12433, shieldSpawn: 12436, count: [19, 28], gone: 2,
  /** Capture: the player's tint inside the shield (over 30 cycles), and none outside. */
  tint: { startCycle: 0, endCycle: 30, hue: 0, saturation: 0, lightness: 106, weight: 112 },
  noTint: { startCycle: 0, endCycle: 0, hue: -1, saturation: -1, lightness: -1, weight: 0 },
  pool: [
    [1301, 9583], [1302, 9565], [1302, 9570], [1302, 9581], [1303, 9576], [1304, 9573], [1305, 9568], [1305, 9579],
    [1305, 9583], [1306, 9564], [1307, 9571], [1307, 9575], [1308, 9581], [1309, 9567], [1309, 9574], [1309, 9578],
    [1309, 9585], [1310, 9563], [1311, 9576], [1311, 9583], [1312, 9568], [1312, 9580], [1313, 9565], [1313, 9573],
    [1314, 9571], [1315, 9563], [1315, 9577], [1316, 9569], [1316, 9574], [1316, 9580], [1318, 9565], [1318, 9572],
    [1319, 9568], [1319, 9578], [1319, 9584], [1320, 9571], [1320, 9574], [1320, 9581], [1320, 9585],
  ],
};

function isDemonbane(player) {
  const { Equipment } = Shared.core();
  const weapon = player.getEquipment().getItems()[Equipment.WEAPON_SLOT]?.getId?.() ?? -1;
  if (DEMONBANE.has(weapon)) return true;
  const spell = player.getCombat().getSelectedSpell?.() ?? player.getCombat().getCastSpell?.();
  return spell?.demonbane === true;
}

function shuffle(list) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

function step(from, to) {
  return Math.sign(to - from);
}

const NEIGHBOURS = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [1, -1], [-1, -1], [-1, 1]];

/** A larva's reach cap on the damage it does the player (in game: 12, 20 from delve 8, 30 giant). */
function larvaDamageCap(level, giant) {
  if (giant) return LARVA.damageCap.giant;
  return level >= 8 ? LARVA.damageCap.deep : LARVA.damageCap.normal;
}

class HazardSet {
  constructor(run) {
    this.run = run;
    this.charge = 0;
    this.larvae = new Set();
    this.rocks = [];
    this.earth = new Set();
    this.destroyed = [];
    this.shield = null;
  }

  get area() {
    return this.run.area;
  }

  get player() {
    return this.run.player;
  }


  tick() {
    const ticks = this.run.ticks;
    for (const larva of [...this.larvae]) this.crawl(larva);
    this.walkShield();
  }

  // ---------------------------------------------------------------- larvae

  /** During the shield, larvae come from one side of the Doom (Wiki). */
  sideTile(from) {
    const boss = this.run.boss;
    const centre = Shared.core().Projectile.centreOf(boss);
    const sides = [from, ...[[0, 1], [-1, 1], [-1, 0], [-1, -1], [1, 0], [0, -1]]];
    for (const [dx, dy] of sides) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const reach = Shared.random(7, 9);
        const jitter = Shared.random(-2, 2);
        const tile = { x: centre.getX() + dx * reach + (dy !== 0 ? jitter : 0), y: centre.getY() + dy * reach + (dx !== 0 ? jitter : 0), z: 0 };
        if (Shared.onFloor(tile) && Shared.floorFree(this.area, tile)) return tile;
      }
    }
    return this.larvaTile();
  }

  /**
   * Capture: a larva drops about four tiles past the player, on the side away from the Doom,
   * a tile or two to either side.
   */
  larvaTile() {
    const at = this.player.getLocation();
    const boss = this.run.boss;
    const centre = boss ? Shared.core().Projectile.centreOf(boss) : at;
    const dx = Math.sign(at.getX() - centre.getX());
    const dy = Math.sign(at.getY() - centre.getY());
    for (let attempt = 0; attempt < 40; attempt++) {
      const reach = Shared.random(...LARVA.past);
      const side = Shared.random(-2, 2);
      const away = attempt < 30 && (dx || dy);
      const tile = away
        ? { x: at.getX() + dx * reach + (dx === 0 ? side : 0), y: at.getY() + dy * reach + (dy === 0 ? side : 0), z: 0 }
        : { x: at.getX() + Shared.random(-4, 4), y: at.getY() + Shared.random(-4, 4), z: 0 };
      if (!Shared.onFloor(tile) || !Shared.floorFree(this.area, tile)) continue;
      if (boss && Shared.distanceTo(boss, tile) <= 1) continue;
      return tile;
    }
    return null;
  }

  /** The second of a pair, beside the first (capture). */
  besideTile(first) {
    for (const [dx, dy] of [[-1, 1], [1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const tile = { x: first.x + dx, y: first.y + dy, z: 0 };
      if (Shared.onFloor(tile) && Shared.floorFree(this.area, tile)) return tile;
    }
    return first;
  }

  /** Capture: half pray Melee at delves 1-2 (the rest nothing); any of the three at delve 3. */
  larvaPrayer() {
    const level = this.run.level;
    if (level <= 2) return this.run.random() < 0.5 ? "melee" : null;
    if (level <= 3) return Shared.randomOf(["melee", "ranged", "magic"]);
    return null;
  }

  /**
   * Which larva (Wiki): neutral to delve 3 (praying as larvaPrayer says); coloured from delve 4,
   * Ranged or Magic, and Melee only during the shield; from delve 8 a giant one now and then
   * outside the shield (guess: one in three).
   */
  larvaKind(shield) {
    const level = this.run.level;
    if (level < 4) return { id: Shared.NPC.LARVA, protect: this.larvaPrayer() };
    const styles = shield ? ["ranged", "magic", "melee"] : ["ranged", "magic"];
    const style = Shared.randomOf(styles);
    if (level >= 8 && !shield && this.run.random() < 1 / 3) {
      return { id: style === "ranged" ? Shared.NPC.GIANT_LARVA_RANGED : Shared.NPC.GIANT_LARVA_MAGIC, style, giant: true };
    }
    const id = { ranged: Shared.NPC.LARVA_RANGED, magic: Shared.NPC.LARVA_MAGIC, melee: Shared.NPC.LARVA_MELEE }[style];
    return { id, style };
  }

  spawnLarva({ from = null, shield = false, beside = false } = {}) {
    const { Animation } = Shared.core();
    const tile = beside && this.lastLarvaTile ? this.besideTile(this.lastLarvaTile) : from ? this.sideTile(from) : this.larvaTile();
    if (!tile) return;
    this.lastLarvaTile = tile;
    const kind = this.larvaKind(shield);
    const larva = this.run.spawnNpc(kind.id, tile);
    if (!larva) return;
    larva.__doomLarva = { protect: kind.protect ?? null, style: kind.style ?? null, giant: !!kind.giant, movedAt: this.run.ticks, born: this.run.ticks };
    larva.setFlag?.("combat:no-retaliate");
    larva.setFlag?.("movement:ignore-clipping");
    // Capture: every larva step is a crawl, which clients play at half walking speed.
    larva.setCrawling?.(true);
    // Capture: prayer larvae show the prayer (0-2); coloured ones the two they pray (6-8).
    const icon = kind.protect ? HEAD_ICON[kind.protect] : kind.style ? COLOURED_ICON[kind.style] : -1;
    if (icon >= 0) larva.setHeadIcon(icon);
    larva.performGraphic(Shared.gfx(LARVA.spawnGfx));
    larva.performAnimation(new Animation(LARVA.spawnAnim));
    this.larvae.add(larva);
  }

  /** A tile every two ticks towards the Doom's centre, through anything. */
  crawl(larva) {
    const boss = this.run.boss;
    if (!larva.isRegistered?.() || larva.getHitpoints() <= 0) {
      this.larvae.delete(larva);
      return;
    }
    if (!boss) return;
    const state = larva.__doomLarva;
    // Wiki: larvae give up after about 20 seconds, but only once the Doom has moved (burrowing).
    if (this.run.attacks.phase === "burrow" && this.run.ticks - state.born > LARVA.lifetime) {
      this.removeLarva(larva);
      return;
    }
    const centre = Shared.core().Projectile.centreOf(boss);
    const at = larva.getLocation();
    if (Shared.distanceTo(larva, centre) === 0) {
      this.larvaReached(larva);
      return;
    }
    // Capture: melee larvae crawl a tile a tick more often than not; the others every 2 ticks.
    const every = state.style === "melee" && this.run.random() < 0.5 ? 1 : LARVA.crawlTicks;
    if (this.run.ticks - state.movedAt < every) return;
    state.movedAt = this.run.ticks;
    const next = this.larvaStep(larva, centre)
      ?? at.transform(step(at.getX(), centre.getX()), step(at.getY(), centre.getY()));
    const movement = larva.getMovementQueue();
    movement.reset();
    movement.addSteps?.(next);
    if (!movement.addSteps) larva.moveTo(next);
  }

  /**
   * The larva's next tile towards the Doom's centre, around rocks: a breadth-first search over the
   * arena floor, 8 ways (diagonals only past two free sides). The Doom's own tiles are always
   * open, as NPCs don't block each other, so it goes into the Doom over the last stretch. Null
   * when rocks wall it in.
   */
  larvaStep(larva, centre) {
    const size = larva.getSize?.() ?? 1;
    const boss = this.run.boss;
    const at = larva.getLocation();
    const start = { x: at.getX(), y: at.getY() };
    const goal = { x: centre.getX(), y: centre.getY() };
    const underBoss = (x, y) => Shared.distanceTo(boss, { x, y, z: 0 }) === 0;
    const open = (x, y) => {
      for (let dx = 0; dx < size; dx++) {
        for (let dy = 0; dy < size; dy++) {
          const tx = x + dx;
          const ty = y + dy;
          if (underBoss(tx, ty)) continue;
          if (!Shared.onFloor({ x: tx, y: ty, z: 0 }) || this.rockAt(tx, ty)) return false;
        }
      }
      return true;
    };
    const key = (x, y) => `${x},${y}`;
    const from = new Map([[key(start.x, start.y), null]]);
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      const tile = queue[head];
      if (tile.x === goal.x && tile.y === goal.y) {
        let current = tile;
        while (true) {
          const previous = from.get(key(current.x, current.y));
          if (!previous || (previous.x === start.x && previous.y === start.y)) break;
          current = previous;
        }
        return Shared.loc({ x: current.x, y: current.y, z: at.getZ() });
      }
      for (const [dx, dy] of NEIGHBOURS) {
        const x = tile.x + dx;
        const y = tile.y + dy;
        if (from.has(key(x, y)) || !open(x, y)) continue;
        if (dx && dy && (!open(tile.x + dx, tile.y) || !open(tile.x, tile.y + dy))) continue;
        from.set(key(x, y), tile);
        queue.push({ x, y });
      }
    }
    return null;
  }

  /** Into the Doom: it heals, the player is hurt, and the charge grows (Wiki, capture). */
  larvaReached(larva) {
    // Wiki: a giant larva's penalties are tripled.
    const times = larva.__doomLarva?.giant ? 3 : 1;
    this.removeLarva(larva);
    this.charge++;
    this.player.getPacketSender().sendVarbit(Shared.VARBIT.MISSED_ORBS, this.charge);
    this.player.performGraphic(Shared.gfx(LARVA.impactGfx));
    this.run.hurt(Math.min(this.charge * times, larvaDamageCap(this.run.level, times > 1)));
    this.run.heal((LARVA.heal + this.charge) * times);
  }

  removeLarva(larva) {
    this.larvae.delete(larva);
    this.area.detach?.(larva);
    this.run.removeNpc(larva);
  }

  /** Killed: it bursts over the 3x3 around it, into the Doom if it's caught. */
  /** Killed: it bursts over the tiles around it (4x4 for a giant), into the Doom if it's caught. */
  larvaKilled(larva) {
    const { Animation } = Shared.core();
    const at = larva.getLocation();
    const size = larva.getSize?.() ?? 1;
    // Capture: the death anim, the blast over the 3x3 (graphic 3374), and it goes a tick later.
    this.larvae.delete(larva);
    larva.performAnimation(new Animation(LARVA.deathAnim));
    Shared.areaSound(this.player, Shared.SOUND.LARVA_DEATH, { x: at.getX(), y: at.getY(), z: at.getZ() }, { range: 7 });
    this.run.attacks.after(1, () => this.removeLarva(larva));
    this.run.shield.larvaKilled();
    for (let x = at.getX() - 1; x <= at.getX() + size; x++) {
      for (let y = at.getY() - 1; y <= at.getY() + size; y++) Shared.graphicAt(this.player, LARVA.blastGfx, { x, y, z: 0 });
    }
    const caught = (tile) => tile.getX() >= at.getX() - 1 && tile.getX() <= at.getX() + size
      && tile.getY() >= at.getY() - 1 && tile.getY() <= at.getY() + size;
    const boss = this.run.boss;
    if (boss && boss.getHitpoints() > 0 && this.bossCaught(boss, at, size)) {
      if (this.run.shield.up) {
        this.run.shield.larvaBurst();
        return;
      }
      // Capture: a bonus hitsplat (17).
      Shared.damage(boss, Shared.random(...LARVA.bossDamage), "RED", Shared.SPLAT.BONUS);
      this.run.acid.spray();
      return;
    }
    if (caught(this.player.getLocation())) this.run.hurt(Shared.random(0, LARVA.explosion));
  }

  bossCaught(boss, at, size) {
    const b = boss.getLocation();
    const reach = boss.getSize();
    return at.getX() - 1 <= b.getX() + reach - 1 && at.getX() + size >= b.getX()
      && at.getY() - 1 <= b.getY() + reach - 1 && at.getY() + size >= b.getY();
  }

  /** One damage a hit, unless demonbane, and nothing through the larva's prayer. */
  modifyLarvaHit(larva, hit) {
    const { CombatType } = Shared.core();
    const attacker = hit.getAttacker?.();
    const { protect, style: needs } = larva.__doomLarva ?? {};
    const style = hit.getCombatType?.();
    // Coloured larvae take only their colour's style (they pray the other two).
    const blocked = (protect && CombatType[protect.toUpperCase()] === style)
      || (needs && CombatType[needs.toUpperCase()] !== style);
    const full = attacker?.isPlayer?.() && isDemonbane(attacker);
    for (const part of hit.getHits()) {
      if (blocked) part.setDamage(0);
      else if (!full) part.setDamage(Math.min(1, part.getDamage()));
    }
    hit.updateTotalDamage();
    if (blocked) attacker?.sendMessage?.(RESISTANT);
  }

  // ---------------------------------------------------------------- rocks

  /** The thrown rock bursts over the player (capture timings). */
  burstRock(at, style, { orbs = this.run.delve.rockOrbs, exclude = [] } = {}) {
    const { PrayerHandler } = Shared.core();
    const player = this.player;
    Shared.graphicAt(player, ROCK.splitGfx[style], Shared.loc(at));
    Shared.areaSound(player, Shared.SOUND.ROCK_SPLIT, at, { range: 10 });
    for (const prayer of [PrayerHandler.PROTECT_FROM_MAGIC, PrayerHandler.PROTECT_FROM_MISSILES, PrayerHandler.PROTECT_FROM_MELEE]) {
      if (PrayerHandler.isActivated(player, prayer)) PrayerHandler.deactivatePrayer(player, prayer);
    }
    const marked = Shared.tileOf(player);
    const tiles = [marked, ...this.debrisTiles(marked, exclude)];
    const from = Shared.loc(at);
    const ends = tiles.map((tile) => 60 + 3 * from.getDistance(Shared.loc(tile)));
    tiles.forEach((tile, index) => {
      Shared.projectile(this.area, from, Shared.loc(tile), Shared.randomOf(ROCK.debris), { delay: 0, end: ends[index], startHeight: 500, endHeight: 0 });
      Shared.graphicAt(player, ROCK.shadowGfx, tile);
    });
    // Capture: the impacts are sent 2 ticks on, each delayed to its piece's landing.
    this.run.attacks.after(ROCK.landTicks, () => {
      tiles.forEach((tile, index) => {
        const delay = Math.max(0, ends[index] - 60);
        Shared.graphicAt(player, ROCK.impactGfx, tile, { delay });
        Shared.areaSound(player, Shared.SOUND.ROCK_PIECE, tile, { delay, range: 1 });
      });
    });
    this.run.attacks.after(ROCK.rockTicks, () => this.rockLands(marked, tiles, style, orbs));
    return tiles;
  }

  debrisTiles(centre, exclude = []) {
    const tiles = [];
    const taken = new Set([`${centre.x},${centre.y}`, ...exclude.map((tile) => `${tile.x},${tile.y}`)]);
    const pieces = rockPieces(this.run.level) - 1;
    for (let attempt = 0; attempt < 120 && tiles.length < pieces; attempt++) {
      const tile = { x: centre.x + Shared.random(-ROCK.spread, ROCK.spread), y: centre.y + Shared.random(-ROCK.spread, ROCK.spread), z: 0 };
      const key = `${tile.x},${tile.y}`;
      if (taken.has(key) || !Shared.onFloor(tile) || !Shared.floorFree(this.area, tile)) continue;
      taken.add(key);
      tiles.push(tile);
    }
    return tiles;
  }

  rockLands(marked, tiles, style, orbs) {
    const { Animation } = Shared.core();
    this.run.attacks.rockLanded();
    const player = this.player;
    const here = Shared.tileOf(player);
    if (tiles.some((tile) => tile.x === here.x && tile.y === here.y)) this.run.hurt(Shared.random(0, ROCK.damage));
    this.addRock(marked);
    if (here.x === marked.x && here.y === marked.y) {
      const aside = this.pushTile(marked);
      if (aside) {
        player.getMovementQueue().reset();
        player.moveTo(Shared.loc(aside));
      }
      player.performAnimation(new Animation(ROCK.pushAnim));
    }
    const sources = tiles.filter((tile) => tile.x !== marked.x || tile.y !== marked.y);
    // Capture: the orbs alternate styles, starting with the rock's.
    let current = style;
    for (let index = 0; index < orbs; index++) {
      const from = sources.length ? sources.splice(Math.floor(this.run.random() * sources.length), 1)[0] : marked;
      this.run.attacks.rockOrb(from, current, rockOrbFlight(this.run.level, index % this.run.delve.rockOrbs));
      current = current === "ranged" ? "magic" : "ranged";
    }
  }

  pushTile(rock) {
    const free = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const tile = { x: rock.x + dx, y: rock.y + dy, z: 0 };
        if ((dx || dy) && Shared.onFloor(tile) && Shared.floorFree(this.area, tile)) free.push(tile);
      }
    }
    return free.length ? Shared.randomOf(free) : null;
  }

  /** Capture: a rock takes the place of any acid on its tile, and the acid is back when it breaks. */
  addRock(tile) {
    const { GameObject, ObjectManager } = Shared.core();
    if (this.rockAt(tile.x, tile.y)) return;
    const acid = this.run.acid.has(tile.x, tile.y);
    if (acid) this.run.acid.clearAt(tile.x, tile.y);
    const rock = new GameObject(Shared.OBJECT.ROCK, Shared.loc(tile), 10, Shared.random(0, 3), this.area);
    rock.__doomAcidUnder = acid;
    ObjectManager.register(rock, true);
    this.rocks.push(rock);
  }

  rockAt(x, y) {
    return this.rocks.find((rock) => rock.getLocation().getX() === x && rock.getLocation().getY() === y) ?? null;
  }

  removeRock(rock) {
    Shared.core().ObjectManager.deregister(rock, true);
    this.rocks = this.rocks.filter((other) => other !== rock);
    if (rock.__doomAcidUnder) this.run.acid.place(Shared.tileOf(rock));
  }

  breakRockAt(x, y) {
    const rock = this.rockAt(x, y);
    if (rock) this.removeRock(rock);
    return !!rock;
  }

  clearRocks() {
    const { ObjectManager } = Shared.core();
    for (const rock of this.rocks) ObjectManager.deregister(rock, true);
    this.rocks = [];
  }

  // ---------------------------------------------------------------- volatile earth

  spawnVolatileEarth() {
    const { Animation } = Shared.core();
    this.clearVolatileEarth();
    const boss = this.run.boss;
    const free = EARTH.pool.map(([x, y]) => this.run.tile({ x, y, z: 0 })).filter((tile) =>
      Shared.floorFree(this.area, tile) && !this.rockAt(tile.x, tile.y) && !(boss && Shared.distanceTo(boss, tile) === 0));
    const count = Math.min(free.length, Shared.random(...EARTH.count));
    for (const { x, y } of shuffle(free).slice(0, count)) {
      const earth = this.run.spawnNpc(Shared.NPC.VOLATILE_EARTH, { x, y });
      if (!earth) continue;
      earth.__doomEarth = true;
      earth.setFlag?.("combat:no-retaliate");
      earth.getMovementQueue().setBlockMovement(true);
      earth.performAnimation(new Animation(EARTH.anim));
      this.earth.add(earth);
    }
  }

  /** The first destroyed is where the shield goes, the second where it appears (Wiki). */
  earthDestroyed(earth) {
    const { Animation } = Shared.core();
    const tile = Shared.tileOf(earth);
    this.earth.delete(earth);
    earth.performAnimation(new Animation(EARTH.pop));
    this.run.attacks.after(1, () => this.run.removeNpc(earth));
    if (this.shield) return;
    this.destroyed.push(tile);
    if (this.destroyed.length < 2) return;
    const [destination, from] = this.destroyed;
    const shield = this.run.spawnNpc(Shared.NPC.EARTHEN_SHIELD, { x: from.x - 1, y: from.y - 1 });
    if (!shield) return;
    shield.setFlag?.("movement:ignore-clipping");
    // Capture: a step every 2 ticks (delves 1-2) is a crawl, so it slides; every tick it walks.
    shield.setCrawling?.(this.run.delve.shieldWalk >= 2);
    shield.performAnimation(new Animation(EARTH.shieldSpawn));
    this.shield = { npc: shield, destination, movedAt: this.run.ticks, spawnedAt: this.run.ticks };
    const rest = [...this.earth];
    this.earth.clear();
    for (const other of rest) other.performAnimation(new Animation(EARTH.death));
    this.run.attacks.after(EARTH.gone, () => rest.forEach((other) => this.run.removeNpc(other)));
  }

  walkShield() {
    const shield = this.shield;
    if (!shield) return;
    const npc = shield.npc;
    const centre = npc.getLocation().transform(1, 1);
    const { destination } = shield;
    // Wiki: its centre tile clears acid blood as it goes.
    this.run.acid.clearAt(centre.getX(), centre.getY());
    if (centre.getX() === destination.x && centre.getY() === destination.y) {
      this.removeShield();
      return;
    }
    // Capture: from the tick after it appears, the player is tinted each tick inside it, untinted outside.
    if (this.run.ticks > shield.spawnedAt) {
      this.player.tint?.(this.sheltered(this.player) ? EARTH.tint : EARTH.noTint);
    }
    if (this.run.ticks - shield.movedAt < this.run.delve.shieldWalk) return;
    shield.movedAt = this.run.ticks;
    const next = npc.getLocation().transform(step(centre.getX(), destination.x), step(centre.getY(), destination.y));
    const movement = npc.getMovementQueue();
    movement.reset();
    movement.addSteps?.(next);
    if (!movement.addSteps) npc.moveTo(next);
  }

  removeShield() {
    if (!this.shield) return;
    this.run.removeNpc(this.shield.npc);
    this.shield = null;
  }

  /** Standing in the earthen shield (its 3x3). */
  sheltered(player) {
    if (!this.shield) return false;
    return Shared.distanceTo(this.shield.npc, player.getLocation()) === 0;
  }

  clearVolatileEarth() {
    for (const earth of this.earth) this.run.removeNpc(earth);
    this.earth.clear();
    this.destroyed = [];
    this.removeShield();
  }

  // ---------------------------------------------------------------- delves

  /** The Doom is beaten: its larvae and earth go with it. */
  levelEnded() {
    for (const larva of [...this.larvae]) this.removeLarva(larva);
    this.clearVolatileEarth();
  }

  /**
   * Capture: rocks and acid stay from delve to delve, but delve 2 moves to another square,
   * leaving delve 1's behind. Wiki: delve 6 starts with the arena cleared.
   */
  descended(level, newSquare = false) {
    if (newSquare || level === 6) {
      this.clearRocks();
      this.run.acid.clear();
    }
  }

  cleared() {
    this.levelEnded();
    this.clearRocks();
  }
}

module.exports = { HazardSet, isDemonbane, rockPieces, rockOrbFlight, larvaDamageCap, LARVA, ROCK, EARTH };
