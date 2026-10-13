"use strict";

/**
 * Tekton's room: he smiths at his anvil until someone comes near, walks to a raider, plants
 * himself and swings; after a while (or with nobody in reach) he goes back to the anvil to
 * repair himself while sparks fly, then comes back enraged.
 *
 * Wiki (Tekton; Chambers of Xeric/Strategies, Tekton):
 * - Immune to Ranged; Magic does a fifth. Immune to binding.
 * - He walks to a player until he reaches them, then stands solid in a combat stance and
 *   attacks the side in front of him (and with a slash, the side to his right too). Max hit
 *   52, 59 enraged (78 / 87 in Challenge Mode); attack speed 3.
 * - After 10-14 attacks, or nobody in melee range when he looks, he returns to the anvil,
 *   repairing about 1.33% of his health every few ticks while two sparks fly at each player
 *   (3x3, 10-20 damage). Anyone under him as he walks is stomped.
 * - Done repairing he is enraged (higher max hit and defences) for a short while.
 * - Drops: 5 stinkhorn mushrooms, 2 overload (+), a revitalisation (+) and a prayer enhance
 *   (+) (its drop table).
 * rsprox captures (recordings 820 and 3389, full fights; 843 and 3285 in passing):
 * - Woken, he plays 7474; 2 ticks later he is walking (7541) and the fire (30021) shuts the way
 *   in. Walking, he makes sound 2720 (range 7) every 4 ticks.
 * - In reach he plants himself on the same tick: fighting form (7542), stance 7478 (30 client
 *   cycles' delay) and the walk-blocker (30023) on his tile. He swings 3 ticks later (2 when
 *   enraged) and every 3 ticks after: stab 7482 and crush 7484 land the tick after, slash 7483
 *   two ticks after.
 * - He leaves on his 9th swing the first time and on his 16th after each repair, turning back
 *   to walking and taking the blocker away on that tick. Back from the anvil he is enraged
 *   (7543 / 7544, stance 7488, swings 7493 / 7494 / 7492) until his 6th swing.
 * - At the anvil he plays 7475 (15 cycles' delay) and turns to 7545 on arriving. Sparks come
 *   every 4 ticks from the tick after, two at each raider: projectile 660 from fixed spots
 *   (start 3-27 cycles, end 85-145, angle 20-25, height 0; sound 155 at the spot, range 8),
 *   landing on or beside the raider as gfx 659 with sound 156 (range 8). He heals every 3
 *   ticks, 85 at 8,400 hitpoints (1% + 1). He stays 12-21 ticks (12, 15, 18 or 21 seen), then
 *   rises enraged (7487) and walks 2 ticks later.
 * - Dying: anim 7495; he goes 3 ticks later; the fire goes as well.
 * Not on the Wiki (to check against a capture): the tiles; the spark spots; spark damage 10-20
 *   on the 3x3; stomps 1-3; protect from melee letting half through; which sides each swing
 *   hits; the exit crystal 30017.
 */

const Shared = require("./CoxShared");
const Raid = require("./CoxRaid");
const Monsters = require("./CoxMonsters");

const FORM = { IDLE: 7540, WALKING: 7541, FIGHTING: 7542, ENRAGED_WALKING: 7543, ENRAGED_FIGHTING: 7544, ANVIL: 7545 };
const OBJECT = { CRYSTAL: 30017, FIRE: 30021, BLOCK: 30023 };
const ANIM = {
  RISE: [7474, 7487], STANCE: [7478, 7488], LEAVE: [7479, 7489], TO_ANVIL: 7475,
  STAB: [7482, 7493], SLASH: [7483, 7494], CRUSH: [7484, 7492],
};
const SOUND = { STEP: 2720, SPARK: 155, SPARK_HIT: 156 };
const SPARK = { PROJECTILE: 660, GFX: 659, MIN: 10, MAX: 20, EVERY: 4, PER_RAIDER: 2 };
/** Swings before he goes back to the anvil: the first time, and after each repair. */
const SWINGS = { FIRST: 9, AFTER_REPAIR: 16, ENRAGED: 6 };
const TIMING = { RISE: 2, FIRST_SWING: 3, FIRST_SWING_ENRAGED: 2, SWING: 3, HEAL: 3, STEP_SOUND: 4 };
/** How long he repairs: 12, 15, 18 or 21 ticks. */
const ANVIL_TICKS = [12, 15, 18, 21];

/** Cache tiles by version. */
const ANVIL_TILES = [{ x: 3279, y: 5298 }, { x: 3307, y: 5294 }, { x: 3341, y: 5298 }];
const CRYSTAL_TILES = [{ x: 3270, y: 5294 }, { x: 3310, y: 5304 }, { x: 3352, y: 5296 }];
const FIRE_TILES = [{ x: 3279, y: 5281 }, { x: 3311, y: 5281 }, { x: 3343, y: 5281 }];
const SAFE_TILES = [{ x: 3280, y: 5280 }, { x: 3312, y: 5280 }, { x: 3344, y: 5280 }];
const SPARK_TILES = [
  [{ x: 3273, y: 5288 }, { x: 3273, y: 5302 }, { x: 3280, y: 5305 }, { x: 3289, y: 5303 }, { x: 3288, y: 5289 }],
  [{ x: 3320, y: 5289 }, { x: 3321, y: 5303 }, { x: 3317, y: 5302 }, { x: 3303, y: 5295 }, { x: 3305, y: 5288 }, { x: 3305, y: 5301 }],
  [{ x: 3350, y: 5289 }, { x: 3334, y: 5288 }, { x: 3335, y: 5302 }, { x: 3343, y: 5304 }, { x: 3350, y: 5303 }],
];
/** Facing south, west, north, east; the side to his right is the next one. */
const FACINGS = ["south", "west", "north", "east"];

/** rsprox captures: 85 a heal at 8,400 hitpoints. */
function anvilHeal(maxHitpoints) {
  return Math.floor(maxHitpoints / 100) + 1;
}

class TektonRoom extends Raid.Room {
  constructor(raid, record) {
    super(raid, record);
    this.state = "idle";
    this.enraged = false;
    this.repaired = false;
    this.steps = 0;
  }

  load() {
    const variant = this.record.variant;
    const anvil = ANVIL_TILES[variant];
    this.tekton = this.spawnNpc(FORM.IDLE, this.tile(anvil.x, anvil.y, 6));
    this.home = this.tekton?.getLocation().clone();
    this.safeTile = this.tile(SAFE_TILES[variant].x, SAFE_TILES[variant].y);
    this.sparkTiles = SPARK_TILES[variant].map((spot) => this.tile(spot.x, spot.y));
    this.blockExit(CRYSTAL_TILES, OBJECT.CRYSTAL);
  }

  combatPoints() {
    return this.tekton ? Math.floor(5 * this.tekton.getMaxHitpoints() * 1.05) : 0;
  }

  alive() {
    return this.tekton?.isRegistered() && this.tekton.getHitpoints() > 0;
  }

  form(normal, enraged) {
    this.tekton.setNpcTransformationId(this.enraged ? enraged : normal);
  }

  anim(pair, delay = 0) {
    const { Animation } = Shared.core();
    const id = Array.isArray(pair) ? pair[this.enraged ? 1 : 0] : pair;
    this.tekton.performAnimation(new Animation(id, delay));
  }

  /** Raiders in reach of a melee swing: beside him, not under him nor on a corner. */
  reachable() {
    const npc = this.tekton;
    const at = npc.getLocation();
    const size = npc.getSize();
    return this.raiders().filter((player) => {
      if (player.getHitpoints() <= 0) return false;
      const x = player.getLocation().getX() - at.getX();
      const y = player.getLocation().getY() - at.getY();
      const inX = x >= 0 && x < size;
      const inY = y >= 0 && y < size;
      if (inX && inY) return false;
      return (inX && (y === -1 || y === size)) || (inY && (x === -1 || x === size));
    });
  }

  tick() {
    if (!this.alive()) return;
    if (this.tekton.getMovementQueue().isMovings()) {
      this.stomp();
      if (this.steps++ % TIMING.STEP_SOUND === 0) {
        Shared.areaSound(this.raiders(), SOUND.STEP, Shared.core().Projectile.centreOf(this.tekton), { range: 7 });
      }
    } else {
      this.steps = 0;
    }
    switch (this.state) {
      case "idle": return this.watch();
      case "rising": return this.rise();
      case "engaging": return this.approach();
      case "fighting": return this.fight();
      case "returning": return this.returnHome();
      case "anvil": return this.smith();
      default: return undefined;
    }
  }

  /** Anyone within 3 tiles of him wakes him. */
  watch() {
    const at = this.tekton.getLocation();
    const size = this.tekton.getSize();
    const near = this.raiders().some((player) => {
      const x = player.getLocation().getX();
      const y = player.getLocation().getY();
      return x >= at.getX() - 3 && x < at.getX() + size + 3 && y >= at.getY() - 3 && y < at.getY() + size + 3;
    });
    if (near) this.wake();
  }

  /** He rises (7474, or 7487 back from the anvil) and walks 2 ticks later. */
  wake() {
    this.state = "rising";
    this.wait = TIMING.RISE;
    this.anim(ANIM.RISE);
  }

  rise() {
    if (--this.wait > 0) return;
    this.form(FORM.WALKING, FORM.ENRAGED_WALKING);
    if (!this.fire) {
      const spot = FIRE_TILES[this.record.variant];
      const { GameObject, ObjectManager } = Shared.core();
      this.fire = new GameObject(OBJECT.FIRE, this.tile(spot.x, spot.y, 2), 10, this.record.rotation, this.map);
      ObjectManager.register(this.fire, true);
    }
    this.state = "engaging";
    this.target = null;
    this.searching = 0;
    this.approach();
  }

  /** Picks a raider and walks to them; in reach, plants himself. */
  approach() {
    if (!this.target || !this.raid.players.has(this.target) || this.raid.roomAt(this.target.getLocation()) !== this) {
      const raiders = this.raiders().filter((player) => player.getHitpoints() > 0 && !player.getLocation().equals(this.safeTile));
      if (raiders.length === 0) return this.retreat();
      this.target = Shared.randomOf(raiders);
    }
    this.tekton.setPositionToFace(this.target.getLocation());
    if (this.reachable().includes(this.target)) return this.plant();
    if (!this.tekton.getMovementQueue().isMovings()) {
      Shared.core().PathFinder.calculateEntityRoute(this.tekton, this.target);
      if (!this.tekton.getMovementQueue().isMovings() && ++this.searching > 3) return this.retreat();
    }
    return undefined;
  }

  /** Fighting form, stance and the blocker on one tick; the first swing 3 ticks on (2 enraged). */
  plant() {
    this.tekton.getMovementQueue().reset();
    this.state = "fighting";
    this.swings = 0;
    this.swingLimit = this.repaired ? SWINGS.AFTER_REPAIR : SWINGS.FIRST;
    this.wait = this.enraged ? TIMING.FIRST_SWING_ENRAGED : TIMING.FIRST_SWING;
    this.form(FORM.FIGHTING, FORM.ENRAGED_FIGHTING);
    this.anim(ANIM.STANCE, 30);
    this.solid(true);
  }

  /** A solid block where he stands while fighting (no walking under him). */
  solid(on) {
    const { GameObject, ObjectManager } = Shared.core();
    if (on && !this.block) {
      this.block = new GameObject(OBJECT.BLOCK, this.tekton.getLocation().clone(), 10, 0, this.map);
      ObjectManager.register(this.block, true);
    } else if (!on && this.block) {
      ObjectManager.deregister(this.block, true);
      this.block = null;
    }
  }

  fight() {
    if (--this.wait > 0) return undefined;
    const reachable = this.reachable();
    if (reachable.length === 0) return this.retreat();
    if (!reachable.includes(this.target)) this.target = Shared.randomOf(reachable);
    const style = Shared.random(0, 2);
    this.anim([ANIM.STAB, ANIM.SLASH, ANIM.CRUSH][style]);
    const facing = this.facingTowards(this.target.getLocation());
    this.tekton.setPositionToFace(this.target.getLocation());
    const slash = style === 1;
    Shared.later(this.raid, slash ? 2 : 1, () => this.swing(facing, slash));
    this.swings++;
    this.wait = TIMING.SWING;
    if (this.enraged && this.swings === SWINGS.ENRAGED) this.calmDown();
    if (this.swings >= this.swingLimit) this.retreat();
    return undefined;
  }

  calmDown() {
    this.enraged = false;
    this.tekton.setNpcTransformationId(FORM.FIGHTING);
    Monsters.restat(this.tekton, FORM.FIGHTING, this.raid.scaling);
  }

  facingTowards(location) {
    const npc = this.tekton;
    const size = npc.getSize();
    const dx = location.getX() - (npc.getLocation().getX() + (size - 1) / 2);
    const dy = location.getY() - (npc.getLocation().getY() + (size - 1) / 2);
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "east" : "west";
    return dy > 0 ? "north" : "south";
  }

  /** The swing lands on the side he faces (and with a slash the side to his right). */
  swing(facing, slash) {
    if (!this.alive()) return;
    const sides = [facing];
    if (slash) sides.push(FACINGS[(FACINGS.indexOf(facing) + 1) % 4]);
    const npc = this.tekton;
    const at = npc.getLocation();
    const size = npc.getSize();
    const maxHit = npc.getDefinition().getMaxHit();
    for (const player of this.reachable()) {
      const x = player.getLocation().getX() - at.getX();
      const y = player.getLocation().getY() - at.getY();
      const side = y === -1 ? "south" : y === size ? "north" : x === -1 ? "west" : "east";
      if (sides.includes(side)) Shared.strike(npc, player, "melee", maxHit, 0, { prayerMultiplier: 0.5 });
    }
  }

  /** Raiders under him as he walks take 1-3. */
  stomp() {
    const at = this.tekton.getLocation();
    const size = this.tekton.getSize();
    for (const player of this.raiders()) {
      const x = player.getLocation().getX() - at.getX();
      const y = player.getLocation().getY() - at.getY();
      if (x >= 0 && x < size && y >= 0 && y < size) Shared.damage(player, Shared.random(1, 3));
    }
  }

  /** Back to the anvil: walking again, the blocker gone, on the tick of his last swing. */
  retreat() {
    this.state = "returning";
    this.solid(false);
    this.enraged = false;
    this.tekton.setNpcTransformationId(FORM.WALKING);
    Shared.core().PathFinder.calculateWalkRoute(this.tekton, this.home.getX(), this.home.getY());
  }

  returnHome() {
    if (this.tekton.getMovementQueue().isMovings()) return;
    if (!this.tekton.getLocation().equals(this.home)) {
      Shared.walkStraight(this.tekton, this.home);
      return;
    }
    this.state = "anvil";
    Monsters.restat(this.tekton, FORM.FIGHTING, this.raid.scaling);
    this.anim(ANIM.TO_ANVIL, 15);
    this.tekton.setNpcTransformationId(FORM.ANVIL);
    this.anvilTicks = 0;
    this.anvilFor = Shared.randomOf(ANVIL_TICKS);
  }

  smith() {
    const tick = ++this.anvilTicks;
    const targets = this.raiders().filter((player) => !player.getLocation().equals(this.safeTile) && player.getLocation().getDistance(this.safeTile) > 1);
    if (targets.length === 0) {
      this.state = "idle";
      this.tekton.setNpcTransformationId(FORM.IDLE);
      return;
    }
    if ((tick - 1) % SPARK.EVERY === 0) {
      for (const player of targets) for (let i = 0; i < SPARK.PER_RAIDER; i++) this.spark(player);
    }
    if (tick % TIMING.HEAL === 0) Shared.healSplat(this.tekton, anvilHeal(this.tekton.getMaxHitpoints()));
    if (tick >= this.anvilFor) {
      this.enraged = true;
      this.repaired = true;
      Monsters.restat(this.tekton, FORM.ENRAGED_FIGHTING, this.raid.scaling);
      this.wake();
    }
  }

  /** One spark from a spot at random onto or beside the raider. */
  spark(player) {
    const { Location, Projectile } = Shared.core();
    const at = player.getLocation();
    const to = new Location(at.getX() + Shared.random(-1, 1), at.getY() + Shared.random(-1, 1), at.getZ());
    const from = Shared.randomOf(this.sparkTiles);
    const start = Shared.random(3, 27);
    const end = start + Shared.random(70, 120);
    new Projectile(from, to, null, SPARK.PROJECTILE, start, end, 0, 0, this.map)
      .withAngle(Shared.random(20, 25))
      .withProgress(0)
      .sendProjectile();
    Shared.areaSound(this.raiders(), SOUND.SPARK, from, { delay: start, range: 8 });
    const landsIn = Math.floor(end / 30);
    const delay = end - landsIn * 30;
    Shared.later(this.raid, landsIn, () => {
      if (!this.alive()) return;
      Shared.graphicAt(this.raiders(), SPARK.GFX, to, { delay });
      Shared.areaSound(this.raiders(), SOUND.SPARK_HIT, to, { delay, range: 8 });
      for (const raider of this.raiders()) {
        if (raider.getLocation().getDistance(to) <= 1) Shared.damage(raider, Shared.random(SPARK.MIN, SPARK.MAX));
      }
    });
  }

  /** Wiki: immune to Ranged, a fifth from Magic; nothing while he repairs at the anvil. */
  modifyHit(npc, hit) {
    if (npc !== this.tekton) return;
    const { CombatType } = Shared.core();
    const type = hit.getCombatType?.();
    let factor = type === CombatType.RANGED ? 0 : type === CombatType.MAGIC ? 0.2 : 1;
    if (npc.getNpcTransformationId() === FORM.ANVIL) {
      factor = 0;
      const attacker = hit.getAttacker?.();
      if (attacker?.isPlayer?.()) attacker.getAsPlayer().sendMessage("Tekton's anvil protects him from your attacks.");
    }
    if (factor === 1) return;
    for (const part of hit.getHits()) part.setDamage(Math.floor(part.getDamage() * factor));
    hit.updateTotalDamage();
  }

  onNpcDeath(npc) {
    if (npc !== this.tekton) return;
    this.state = "dead";
    this.solid(false);
    this.clearExit();
    const fire = this.fire;
    this.fire = null;
    if (fire) Shared.later(this.raid, 3, () => Shared.core().ObjectManager.deregister(fire, true));
  }
}

Raid.registerRoom("TEKTON", TektonRoom);

/** His attacks are the room's; the core combat only keeps him targeting. */
function tektonCombat(api) {
  const { CombatMethod, CombatType } = api.core;
  return class TektonCombat extends CombatMethod {
    type() {
      return CombatType.MELEE;
    }

    canAttack() {
      return false;
    }

    hits() {
      return [];
    }
  };
}

/** The fire at the way in: crossing it puts you on its other side. */
function crossFire(event) {
  const room = Raid.raidOf(event.player)?.roomAt(event.player.getLocation());
  if (!(room instanceof TektonRoom)) return false;
  Shared.crossFire(event.player, event.object);
  return true;
}

module.exports = function registerCoxTekton(api) {
  Shared.bind(api);
  api.registerNpcCombatMethodProvider(Object.values(FORM), tektonCombat(api));
  Shared.onObjectIds(api, [OBJECT.FIRE], crossFire);
};

Object.assign(module.exports, { TektonRoom, anvilHeal, SWINGS });
