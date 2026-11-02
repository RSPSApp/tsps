"use strict";

/**
 * Wave 5: Xarpus.
 *
 * Wiki (Xarpus; "Theatre of Blood/Strategies", Xarpus):
 * - Recovery: it doesn't attack. Exhumed rise from the floor and heal it until they sink back,
 *   unless someone stands on them.
 * - Poison: it spits at one player every 4 ticks, in party order. The splat lightly poisons the
 *   3x3 round where it lands, splashes on to the next players, and stays for the rest of the
 *   fight: standing on it or running over it hurts for 4-8 (running over it, a tick late),
 *   raised by what it absorbed. Standing under Xarpus hurts for up to 9 every tick.
 * - Counter: it screeches, stops spitting and stares at one quadrant, never the same twice in a
 *   row, turning every 8 ticks. Each hitsplat from a player in that quadrant comes back as 50-75
 *   poison, raised by 40% of what absorbing raised its stats (Mod Ash).
 * - Hard Mode: as the fight starts it splatters the two outer layers of the arena but for the
 *   six tiles at the entrance; Defence 200, not 250 (10772's definition); in the stare it turns
 *   at once to the quadrant that hit it, which overrides its turning.
 * - Entry Mode's infobox: poison up to 6, retaliation from 38.
 * Cache: Xarpus (8338-8340, Entry 10766-10768, Hard 10770-10772 as captured), the exhumed (32743)
 * and the acidic miasma (32744). RuneLite (gameval): its animations (8059 spit, 8061 rising), the
 * exhumed's (8065) and the splat's (8068), its graphics (1549 exhumed sinking, 1550 the
 * exhumed's orb, 1555 the spit, 1556 the splash, 1557 pebbles).
 * Captured, per party size and mode (1764, 1837, 1852, 554, 101; 3 Hard, 11 Normal, 2 Entry):
 * how many exhumed, how often and how much each orb heals; each lives 11 ticks, its first orb 3
 * ticks in; when it rises and first spits; the aim a tick before each spit; the Hard ring's tiles
 * and timing; the pools' rotation by quadrant; the sounds; "Xarpus begins to stare intently.",
 * the first look 8 ticks later and the look's coordinates; the retaliation's spit, line and
 * graphic. Total damage dealt is starting hitpoints + heals to within 2 in all 11 Normal fights.
 * Estimates: see EXHUMED, ABSORB_UPLIFT, SPLASH, HITPOINTS; the stare's quadrants are taken
 * from the pools' rotation.
 * The splat also poisons, starting at 2 (Wiki, Strategies). Not done:
 * green hitsplats.
 */

const Shared = require("./Shared.TheatreOfBlood");
const Raid = require("./RaidState.TheatreOfBlood");

const NPC = {
  normal: { WAITING: 8338, FEEDING: 8339, FIGHTING: 8340 },
  entry: { WAITING: 10766, FEEDING: 10767, FIGHTING: 10768 },
  hard: { WAITING: 10770, FEEDING: 10771, FIGHTING: 10772 },
};
const OBJECT = { EXHUMED: 32743, MIASMA: 32744 };
const PLANE = 1;
const SPAWN = { x: 3169, y: 4386, z: PLANE };
const ARENA = { minX: 3163, maxX: 3177, minY: 4380, maxY: 4394 };
const CENTRE = { x: 3170, y: 4387 };
/**
 * Captured: a pinwheel round the centre, from the pools' rotation (the 98 Hard ring tiles of 3
 * raids, and the Normal fights). `look` is what it faces, as offsets from the centre.
 */
const QUADRANTS = {
  SE: { face: 0, look: { x: 18, y: -22 }, inside: (t) => t.x >= CENTRE.x && t.y < CENTRE.y },
  SW: { face: 1, look: { x: -22, y: -22 }, inside: (t) => t.x < CENTRE.x && t.y <= CENTRE.y },
  NW: { face: 2, look: { x: -22, y: 18 }, inside: (t) => t.x < CENTRE.x && t.y > CENTRE.y },
  NE: { face: 3, look: { x: 18, y: 18 }, inside: (t) => t.x >= CENTRE.x && t.y >= CENTRE.y },
};

const ANIMATION = { SPIT: 8059, RISE: 8061, EXHUMED: 8065, SPLAT: 8068 };
const GRAPHIC = { EXHUMED_GONE: 1549, ORB: 1550, SPIT: 1555, SPLASH: 1556, PEBBLES: 1557 };
/** As captured: the exhumed's orb, the spit and its splashes, the ring, the retaliation, the guano. */
const PROJECTILE = {
  ORB: { delay: 0, duration: 0, perTile: 10, startHeight: 0, endHeight: 67, angle: 50, progress: 0 },
  SPIT: { delay: 30, duration: -60, perTile: 30, minDuration: 30, startHeight: 100, endHeight: 0, angle: 16, progress: 32 },
  SPLASH: { delay: 15, duration: 15, perTile: 30, startHeight: 0, endHeight: 0, angle: 45, progress: 32 },
  RING: { delay: 30, duration: 60, perTile: 0, startHeight: 100, endHeight: 0, angle: 16, progress: 32 },
  RETALIATION: { delay: 0, duration: 25, perTile: 0, startHeight: 87, endHeight: 20, angle: 16, progress: 32 },
  GUANO: { delay: 0, duration: 20, perTile: 0, startHeight: 40, endHeight: 24, angle: 0, progress: 0 },
};
/** Captured area sounds: an exhumed rising, its orb, the orb landing, it sinking, a new pool, the stare. */
const SOUND = { EXHUMED_RISE: 3230, ORB: 3231, ABSORB: 3956, EXHUMED_GONE: 3995, POOL: 4005, STARE: 4007 };
const HEAL_SPLAT = 6;

/**
 * Hitpoints at the start of the fight before team scaling (Wiki infoboxes). Captured: it starts
 * on this scaled figure, and the Wiki's "75%" means that is 75% of its true maximum (heals can't
 * reach it). Hard Mode's captures fit 9000 (6751, 7877 and 9002 at 3, 4 and 5 players): the Wiki's
 * 6000 is kept, as those are Leagues worlds.
 */
/** Captured Entry fits 2550 x a fifth per player (610-90 solo, 1126-138 duo). */
/** Poison severity: five points per starting damage, so 2. */
const SPLAT_POISON_SEVERITY = 10;
const HITPOINTS = { entry: 2550, normal: 5000, hard: 6000 };
const START_SHARE = 0.75;

/**
 * Per party size (index 1-5). Captured: Normal 2-4, Hard 3-5, Entry 1-2; the 15 at four and 12 for
 * a trio are also the Wiki's (Strategies' "9 in 4-man and 6 in 5-man" don't fit the captures).
 * Estimates: Normal 1 and 5 (count from Entry solo and +3 a player; heal 8 as Hard's), Hard 1-2
 * (4 a player + 4, every 4), Entry 3-5 (Normal's count and pace, heal 6), solo's heal of 20.
 */
const WAVES = {
  normal: { count: [0, 7, 9, 12, 15, 18], heal: [0, 20, 16, 12, 9, 8], every: [0, 12, 8, 8, 4, 4] },
  entry: { count: [0, 7, 9, 12, 15, 18], heal: [0, 6, 6, 6, 6, 6], every: [0, 12, 8, 8, 4, 4] },
  hard: { count: [0, 8, 12, 16, 20, 24], heal: [0, 20, 16, 12, 9, 8], every: [0, 4, 4, 4, 4, 4] },
};
const EXHUMED = {
  ...WAVES.normal,
  /** Captured: the first is 8-12 ticks in; Hard keeps them 5 tiles from the centre (Normal 7). */
  first: [8, 12],
  reach: { normal: 7, hard: 5 },
  /** Captured: 2+ tiles from the centre, and each lasts 11 ticks, the first 3 rising. */
  clearance: 1,
  lifespan: 11, rising: 3,
  /** Captured: it rises 8-9 ticks after the last one sinks; Hard 4-5. */
  riseAfter: { normal: [8, 9], hard: [4, 5] },
};
/** Captured: Hard's spit at the room's start lands 3 ticks later, and pools animate 2 ticks in. */
const RING_DELAY = 3;
const POOL_ANIMATE_DELAY = 2;
/** Tiles the Hard ring covers: two outer layers, except these columns of the two south rows (the entrance). */
const RING_DEPTH = 2;
const ENTRANCE = { minX: 3169, maxX: 3171 };

/** Captured: it aims and looks a tick before each spit (first spit 9 ticks after rising). */
const POISON = {
  every: 4, firstAim: 8, under: 9,
  normal: { splat: [2, 6], pool: [4, 8], retaliate: [50, 75] },
  /** Wiki's max 6 and 38+, as 75% of Normal's (estimate); Entry's 2-3 captured in 5 hits. */
  entry: { splat: [2, 4], pool: [3, 6], retaliate: [38, 56] },
};
/**
 * Captured: spits land 1 or 2 splashes on the next players in party order, wrapping round in a
 * duo, about 40% of them 2. The Wiki's "first splashes on one, the rest on two" isn't in the
 * captured order. None solo. Entry: only single splashes (5 of 5, few samples).
 */
const SPLASH = { twoChance: { normal: 0.4, entry: 0 } };
/**
 * Mod Kieren/Ash: absorbing raises its stats and poison by a percentage; neither gives the rate.
 * Estimate: +1.4% per orb absorbed, the least the captures allow (18 orbs saw a pool of 10; 36 saw
 * a pool of 11 and a retaliation of 86; the Wiki's max 11 is the same pool).
 */
const ABSORB_UPLIFT = 0.014;
const RETALIATION_SHARE = 0.4;
/** Captured: 30-33% of its hitpoints on rising (Wiki: about 25%, of its true maximum), each 4 ticks. */
const COUNTER = {
  below: 1 / 3, firstLook: 8, turnTicks: 8,
  message: "<col=bf0000>Xarpus is staring in your direction and retaliates with a powerful attack!</col>",
};

const TASKS = {
  LOOK: "Don't Look at Me!",
  DANCE: "Can You Dance?",
  PERFECT: "Perfect Xarpus",
  HARDER: "Harder Mode II",
};
const TASK_BY_MODE = { entry: [TASKS.LOOK], normal: [TASKS.DANCE, TASKS.PERFECT], hard: [TASKS.HARDER] };
/** Captured: an Exhumed fails Perfect Xarpus as its third orb leaves (2 samples, 1 tick apart). */
const PERFECT_ORBS = 2;
/** Weapon types that count as ranged or magic, by their keys in item-combat-styles.json. */
const RANGED_OR_MAGIC = new Set([
  "CROSSBOW", "BALLISTA", "BLOWPIPE", "KARILS_CROSSBOW", "SHORTBOW", "LONGBOW", "KNIFE", "OBBY_RINGS", "THROWNAXE",
  "DART", "JAVELIN", "DARK_BOW", "CHINCHOMPA", "SALAMANDER", "STAFF", "ANCIENT_STAFF", "POWERED_STAFF", "BLADED_STAFF",
]);

const key = (tile) => `${tile.x},${tile.y}`;
const reach = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const quadrantOf = (tile) => Object.keys(QUADRANTS).find((name) => QUADRANTS[name].inside(tile));

class XarpusRoom extends Raid.Room {
  onBuild() {
    this.ids = Shared.byMode(this.raid, NPC);
    this.tuning = Shared.byMode(this.raid, POISON);
    this.size = Math.max(1, Math.min(5, this.raid.size));
    this.xarpus = this.spawn(this.ids.WAITING, SPAWN, { scripted: true, scale: false });
    this.xarpus?.getMovementQueue().setBlockMovement(true);
    this.setStartingHitpoints();
    this.phase = "waiting";
    this.exhumed = [];
    this.pools = new Map();
    /** Per player: where they stood after their last move, and the pool tile a run crossed since. */
    this.lastTiles = new Map();
    this.crossed = new Map();
    this.absorbed = 0;
    this.uplift = 0;
    this.aim = null;
  }

  setStartingHitpoints() {
    const npc = this.xarpus;
    if (!npc) return;
    const hitpoints = Shared.byMode(this.raid, HITPOINTS) * Shared.MODES[this.raid.mode].hitpoints(this.size);
    this.hitpointCap = Math.floor(hitpoints / START_SHARE);
    npc.setMaxHitpoints(Math.floor(hitpoints));
    npc.setHitpoints(Math.floor(hitpoints));
  }

  onStart() {
    const npc = this.xarpus;
    if (!npc) return;
    npc.setNpcTransformationId?.(this.ids.FEEDING);
    const waves = Shared.byMode(this.raid, WAVES);
    this.recovery = {
      after: null,
      left: waves.count[this.size],
      heal: waves.heal[this.size],
      every: waves.every[this.size],
      nextAt: Shared.random(...EXHUMED.first),
    };
    this.phase = "recovery";
    this.ticks = 0;
    if (this.raid.isHard) this.spitRing();
  }

  /** While it feeds the bar stays full and grey (as captured); then it runs from the risen hitpoints. */
  healthBar() {
    const npc = this.xarpus;
    if (!npc) return null;
    const kind = this.phase === "recovery" ? Shared.HEALTH_BAR.DISABLED : Shared.HEALTH_BAR.REGULAR;
    return { kind, current: Math.max(0, npc.getHitpoints()), maximum: npc.getMaxHitpoints() };
  }

  tick() {
    this.watchWeapons();
    const npc = this.xarpus;
    if (!this.isStarted() || !npc) return;
    if (npc.getHitpoints() <= 0) {
      this.complete();
      return;
    }
    this.ticks++;
    if (this.phase === "recovery") this.tickRecovery();
    else if (this.phase === "poison") this.tickPoison();
    else if (this.phase === "counter") this.tickCounter();
    this.tickFloor();
  }

  onComplete() {
    for (const pool of this.pools.values()) this.removeObject(pool);
    this.pools.clear();
    for (const task of TASK_BY_MODE[this.raid.mode] ?? []) {
      if (this.raid.taskLive(task)) this.raid.completeTask(task);
    }
  }

  /** Off the map and out of what an arriving player is re-sent (RaidState.redrawObjects). */
  removeObject(object) {
    Shared.core().ObjectManager.deregister(object, true);
    this.objects = this.objects.filter((entry) => entry !== object);
  }

  // -------------------------------------------------------------- tasks

  /**
   * Captured: a ranged or magic weapon fails it the moment it's worn from the fight's start, even
   * once the fight is won ("<name> has equipped a Twisted bow"). Spells without one: see modifyHit.
   */
  watchWeapons() {
    if ((!this.isStarted() && !this.isCompleted()) || !this.raid.taskLive(TASKS.DANCE)) return;
    for (const player of this.roomPlayers()) {
      const weapon = rangedOrMagicWeapon(player);
      if (weapon) this.raid.failTask(TASKS.DANCE, `${Shared.displayName(player)} has equipped ${weapon}`);
    }
  }

  /** All that hurts here is Xarpus' own: both no-damage tasks go. Wording in the captures' voice. */
  hurt(player, amount, mask, reason) {
    if (!this.isStarted() || !this.fighters().includes(player)) return;
    Shared.damage(player, amount, mask);
    const line = `${Shared.displayName(player)} ${reason}`;
    this.raid.failTask(TASKS.PERFECT, line);
    this.raid.failTask(TASKS.HARDER, line);
  }

  // -------------------------------------------------------------- recovery

  tickRecovery() {
    const recovery = this.recovery;
    if (recovery.left > 0 && this.ticks >= recovery.nextAt) {
      recovery.nextAt += recovery.every;
      this.raiseExhumed();
    }
    for (const exhumed of [...this.exhumed]) this.tickExhumed(exhumed);
    if (recovery.left > 0 || this.exhumed.length > 0) return;
    recovery.after ??= this.ticks + Shared.random(...Shared.byMode(this.raid, EXHUMED.riseAfter));
    if (this.ticks >= recovery.after) this.rise();
  }

  raiseExhumed() {
    this.recovery.left--;
    const tile = this.randomFloor();
    const object = this.placeObject(OBJECT.EXHUMED, tile, 22, 0);
    Shared.areaSound(this.area, tile, SOUND.EXHUMED_RISE);
    this.exhumed.push({ object, tile, age: 0, orbs: 0 });
    this.later(1, () => this.animateObject(object, ANIMATION.EXHUMED));
  }

  /** After rising, it sends an orb every tick nobody stands on it. */
  tickExhumed(exhumed) {
    exhumed.age++;
    if (exhumed.age > EXHUMED.lifespan) {
      this.removeObject(exhumed.object);
      this.exhumed = this.exhumed.filter((entry) => entry !== exhumed);
      Shared.graphicAt(this.area, GRAPHIC.EXHUMED_GONE, exhumed.tile);
      Shared.areaSound(this.area, exhumed.tile, SOUND.EXHUMED_GONE);
      return;
    }
    if (exhumed.age <= EXHUMED.rising) return;
    const blocker = this.fighters().find((player) => key(Shared.tileOf(player)) === key(exhumed.tile));
    if (blocker) {
      // Heals can't reach its true maximum: "full health" can only mean no orb was stopped.
      this.raid.failTask(TASKS.HARDER, `${Shared.displayName(blocker)} stopped an Exhumed from healing Xarpus.`);
      return;
    }
    if (++exhumed.orbs > PERFECT_ORBS) this.raid.failTask(TASKS.PERFECT, "An Exhumed healed Xarpus more than twice.");
    this.absorbed++;
    const ticks = Shared.projectile(this.area, exhumed.tile, this.xarpus, GRAPHIC.ORB, PROJECTILE.ORB);
    Shared.areaSound(this.area, exhumed.tile, SOUND.ORB);
    this.later(ticks, () => this.absorb(this.recovery.heal));
  }

  /** An orb lands: the bar stays full, so the maximum rises with it, to its true maximum. */
  absorb(amount) {
    const npc = this.xarpus;
    if (!npc || npc.getHitpoints() <= 0) return;
    const hitpoints = Math.min(this.hitpointCap, npc.getHitpoints() + amount);
    npc.setMaxHitpoints(hitpoints);
    npc.setHitpoints(hitpoints);
    npc.showHitsplat?.(amount, { mine: HEAL_SPLAT, others: HEAL_SPLAT });
    Shared.areaSound(this.area, centreTile(), SOUND.ABSORB);
  }

  /** It takes to the air and fights, its stats raised by what it absorbed. */
  rise() {
    const npc = this.xarpus;
    const { Animation } = Shared.core();
    npc.setNpcTransformationId?.(this.ids.FIGHTING);
    npc.moveTo(Shared.loc({ x: SPAWN.x - 1, y: SPAWN.y - 1, z: PLANE }));
    npc.performAnimation(new Animation(ANIMATION.RISE));
    this.uplift = this.absorbed * ABSORB_UPLIFT;
    const stats = [...(npc.getCurrentDefinition?.()?.getStats?.() ?? [])];
    for (let slot = 0; slot < 5 && slot < stats.length; slot++) stats[slot] = Math.floor(stats[slot] * (1 + this.uplift));
    if (stats.length) npc.setCombatOverride?.({ stats });
    npc.setMaxHitpoints(npc.getHitpoints());
    this.stareAt = Math.ceil(npc.getHitpoints() * COUNTER.below);
    this.phase = "poison";
    this.ticks = 0;
    this.lastTarget = null;
    this.aim = null;
    this.raid.refreshHealthBars();
  }

  // -------------------------------------------------------------- Hard Mode's ring

  /** Captured: one spit per tile, all together from the centre, as the fight starts. */
  spitRing() {
    const tiles = ringTiles();
    const centre = centreTile();
    for (const tile of tiles) Shared.projectile(this.area, centre, tile, GRAPHIC.SPIT, PROJECTILE.RING);
    this.later(RING_DELAY, () => {
      for (const tile of tiles) {
        this.placePool(tile);
        Shared.graphicAt(this.area, GRAPHIC.SPLASH, tile);
      }
    });
  }

  // -------------------------------------------------------------- poison

  tickPoison() {
    const npc = this.xarpus;
    if (this.ticks < POISON.firstAim) return;
    const beat = (this.ticks - POISON.firstAim) % POISON.every;
    if (beat === 0) {
      if (npc.getHitpoints() <= this.stareAt) {
        this.startCounter();
        return;
      }
      this.takeAim();
    } else if (beat === 1 && this.aim) {
      this.spitAtAim();
    }
  }

  /** The next player in party order; the tile they stand on now is where it lands. */
  takeAim() {
    const fighters = this.fighters();
    this.aim = null;
    if (fighters.length === 0) return;
    const target = fighters[(fighters.indexOf(this.lastTarget) + 1) % fighters.length];
    this.lastTarget = target;
    this.aim = { target, tile: Shared.tileOf(target) };
    this.xarpus.setPositionToFace?.(Shared.loc({ ...this.aim.tile, z: PLANE }));
  }

  spitAtAim() {
    const { target, tile } = this.aim;
    this.aim = null;
    const { Animation } = Shared.core();
    this.xarpus.performAnimation(new Animation(ANIMATION.SPIT));
    this.spit(this.xarpus, tile, target, true);
  }

  /** A splat lands, poisons round it, stays, and the first one splashes on to the next players. */
  spit(from, tile, target, first) {
    const ticks = Shared.projectile(this.area, from, tile, GRAPHIC.SPIT, first ? PROJECTILE.SPIT : PROJECTILE.SPLASH);
    this.later(ticks, () => {
      if (!this.isStarted()) return;
      this.placePool(tile);
      Shared.graphicAt(this.area, GRAPHIC.SPLASH, tile);
      for (const player of this.fighters()) {
        if (reach(Shared.tileOf(player), tile) > 1) continue;
        this.hurt(player, Shared.random(...this.tuning.splat), "GREEN", "was hit by Xarpus' poison.");
        // Wiki (Strategies): the splat's 3x3 poisons, starting at 2 ("You have been poisoned!" captured).
        Shared.core().CombatFactory.poisonEntity(player, SPLAT_POISON_SEVERITY);
      }
      if (first) this.splash(tile, target);
    });
  }

  splash(tile, target) {
    const fighters = this.fighters();
    if (fighters.length < 2) return;
    const start = fighters.indexOf(target);
    const twoChance = Shared.byMode(this.raid, SPLASH.twoChance);
    const count = Math.random() < twoChance ? 2 : 1;
    for (let i = 1; i <= count; i++) {
      const next = fighters[(start + i + fighters.length) % fighters.length];
      this.spit(Shared.loc({ ...tile, z: PLANE }), Shared.tileOf(next), null, false);
    }
  }

  placePool(tile) {
    if (this.pools.has(key(tile))) return;
    const pool = this.placeObject(OBJECT.MIASMA, { ...tile, z: PLANE }, 22, QUADRANTS[quadrantOf(tile)].face);
    this.pools.set(key(tile), pool);
    Shared.areaSound(this.area, { ...tile, z: PLANE }, SOUND.POOL);
    this.later(POOL_ANIMATE_DELAY, () => this.animateObject(pool, ANIMATION.SPLAT));
  }

  /**
   * Right after a player's own movement (RaidState's area), the tile a run step passed over, kept until
   * the floor's next tick. The room ticks at the start of the next turn, by when the step's direction
   * has been cleared for sync, so it can't work this out itself.
   */
  onPlayerMoved(player) {
    const at = Shared.tileOf(player);
    const was = this.lastTiles.get(player);
    this.lastTiles.set(player, at);
    if (!was || (was.x === at.x && was.y === at.y)) return;
    const over = passedOver(was, at, player.getWalkingDirection?.());
    if (this.pools.has(key(over))) this.crossed.set(player, over);
  }

  /** The pools and, once it flies, the pebbles under Xarpus, every tick. */
  tickFloor() {
    const npc = this.xarpus;
    for (const player of this.fighters()) {
      const at = Shared.tileOf(player);
      const crossed = this.crossed.get(player);
      this.crossed.delete(player);
      if (this.pools.has(key(at))) this.hurt(player, this.poolDamage(), "GREEN", "stood in Xarpus' poison.");
      else if (crossed && this.pools.has(key(crossed))) {
        // Wiki: running over a pool hurts a tick late.
        this.later(1, () => this.hurt(player, this.poolDamage(), "GREEN", "stood in Xarpus' poison."));
      }
      if (this.phase !== "recovery" && Shared.covers(npc, at)) {
        Shared.projectile(this.area, npc, player, GRAPHIC.PEBBLES, PROJECTILE.GUANO);
        this.later(1, () => this.hurt(player, Shared.random(1, POISON.under), "RED", "stood under Xarpus."));
      }
    }
  }

  poolDamage() {
    return Math.floor(Shared.random(...this.tuning.pool) * (1 + this.uplift));
  }

  // -------------------------------------------------------------- counter

  /** Captured: the screech and the line, then nothing to fear until its first look 8 ticks later. */
  startCounter() {
    const npc = this.xarpus;
    this.phase = "counter";
    this.ticks = 0;
    this.aim = null;
    this.staring = null;
    this.nextTurn = COUNTER.firstLook;
    npc.setMobileInteraction(null);
    npc.forceChat("Screeeeech!");
    Shared.areaSound(this.area, centreTile(), SOUND.STARE);
    for (const player of this.roomPlayers()) player.sendMessage("Xarpus begins to stare intently.");
  }

  tickCounter() {
    if (this.ticks < this.nextTurn) return;
    this.turn(Shared.randomOf(Object.keys(QUADRANTS).filter((name) => name !== this.staring)));
  }

  turn(name) {
    this.staring = name;
    this.turnedAt = Shared.cycle();
    // A forced turn restarts its turning (estimate: the captures' gaps never exceed 8 ticks).
    this.nextTurn = this.ticks + COUNTER.turnTicks;
    const { look } = QUADRANTS[name];
    this.xarpus.setPositionToFace?.(Shared.loc({ x: CENTRE.x + look.x, y: CENTRE.y + look.y, z: PLANE }));
  }

  /**
   * A hit from the quadrant it's staring at comes back as poison, per hitsplat. Hard Mode: a damaging
   * hit from elsewhere turns it there at once, and others hitting from there on that tick are safe
   * (Wiki's pairs "attack on the same tick").
   */
  modifyHit(npc, hit) {
    if (npc !== this.xarpus) return;
    if (this.phase === "waiting" || this.phase === "recovery") {
      // Captured: nothing but its heals lands before it rises.
      for (const part of hit.getHits?.() ?? []) part.setDamage(0);
      hit.updateTotalDamage?.();
      return;
    }
    const attacker = hit.getAttacker?.();
    if (!attacker?.isPlayer?.() || !this.fighters().includes(attacker)) return;
    this.noteAttackStyle(attacker, hit);
    if (this.phase !== "counter" || !this.staring) return;
    const quadrant = quadrantOf(Shared.tileOf(attacker));
    if (quadrant === this.staring && this.turnedAt !== Shared.cycle()) {
      this.retaliate(attacker, Math.max(1, (hit.getHits?.() ?? []).length));
    } else if (this.raid.isHard && quadrant !== this.staring && (hit.getTotalDamage?.() ?? 0) > 0) {
      this.turn(quadrant);
    }
  }

  /** A spell or thrown attack needs no weapon `watchWeapons` knows. Our wording. */
  noteAttackStyle(attacker, hit) {
    const { CombatType } = Shared.core();
    const type = hit.getCombatMethod?.()?.type?.();
    if (type !== CombatType.RANGED && type !== CombatType.MAGIC) return;
    this.raid.failTask(TASKS.DANCE, `${Shared.displayName(attacker)} attacked with a ranged or magic weapon`);
  }

  /** Captured: its spit a tick ahead of the line and the graphic. */
  retaliate(attacker, splats) {
    this.raid.failTask(TASKS.LOOK, `${Shared.displayName(attacker)} was hit by Xarpus' retaliation.`);
    const ticks = Shared.projectile(this.area, centreTile(), attacker, GRAPHIC.SPIT, PROJECTILE.RETALIATION);
    this.later(ticks, () => {
      attacker.sendMessage(COUNTER.message);
      attacker.performGraphic?.(Shared.gfx(GRAPHIC.SPLASH, { height: 80 }));
      const raise = 1 + RETALIATION_SHARE * this.uplift;
      for (let i = 0; i < splats; i++) {
        this.hurt(attacker, Math.floor(Shared.random(...this.tuning.retaliate) * raise), "GREEN", "was hit by Xarpus' retaliation.");
      }
    });
  }

  // -------------------------------------------------------------- helpers

  /** Anywhere in the arena but the centre, on no pool or other exhumed (Hard is nearer in). */
  randomFloor() {
    const limit = Shared.byMode(this.raid, EXHUMED.reach);
    for (let tries = 0; tries < 50; tries++) {
      const tile = { x: Shared.random(ARENA.minX, ARENA.maxX), y: Shared.random(ARENA.minY, ARENA.maxY), z: PLANE };
      const distance = reach(tile, CENTRE);
      if (distance <= EXHUMED.clearance || distance > limit) continue;
      if (this.pools.has(key(tile)) || this.exhumed.some((entry) => key(entry.tile) === key(tile))) continue;
      return tile;
    }
    return { x: CENTRE.x + EXHUMED.clearance + 1, y: CENTRE.y, z: PLANE };
  }

  animateObject(object, id) {
    const { Animation } = Shared.core();
    for (const viewer of this.area.getPlayers()) viewer.getPacketSender().sendObjectAnimation(object, new Animation(id));
  }
}

const centreTile = () => Shared.loc({ ...CENTRE, z: PLANE });

const NOWHERE = { x: -1, y: -1 };

/**
 * The tile a two-tile run step passed over: its first step, from the tick's walking direction, so a
 * mixed run ((2,1): east then north-east, or north-east then east) is judged by where it really went.
 * Without a direction only a straight run has one answer, its middle.
 */
function passedOver(from, to, walking) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) return NOWHERE;
  const stepX = walking?.getX?.() ?? 0;
  const stepY = walking?.getY?.() ?? 0;
  if ((walking?.getId?.() ?? -1) >= 0) {
    const first = { x: from.x + stepX, y: from.y + stepY };
    if (Math.max(Math.abs(to.x - first.x), Math.abs(to.y - first.y)) === 1) return first;
  }
  if (dx % 2 !== 0 || dy % 2 !== 0) return NOWHERE;
  return { x: from.x + dx / 2, y: from.y + dy / 2 };
}

/** Captured: 98 tiles, the same in 3 Hard raids. */
function ringTiles() {
  const tiles = [];
  for (let x = ARENA.minX; x <= ARENA.maxX; x++) {
    for (let y = ARENA.minY; y <= ARENA.maxY; y++) {
      const edge = x < ARENA.minX + RING_DEPTH || x > ARENA.maxX - RING_DEPTH || y < ARENA.minY + RING_DEPTH || y > ARENA.maxY - RING_DEPTH;
      const entrance = y < ARENA.minY + RING_DEPTH && x >= ENTRANCE.minX && x <= ENTRANCE.maxX;
      if (edge && !entrance) tiles.push({ x, y, z: PLANE });
    }
  }
  return tiles;
}

/** "a Twisted bow", as the captured failure names it, or null for a melee weapon or none. */
function rangedOrMagicWeapon(player) {
  const { Equipment, ItemDefinition, RangedWeapon } = Shared.core();
  const id = player.getEquipment().getItems()[Equipment.WEAPON_SLOT]?.getId();
  if (!id || id <= 0) return null;
  const definition = ItemDefinition.forId(id);
  const style = definition?.getWeaponInterface?.()?.getName?.();
  if (!RangedWeapon.getFor(player) && !RANGED_OR_MAGIC.has(style)) return null;
  const name = definition.getName();
  return `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;
}

module.exports = function registerXarpus(api) {
  Shared.bind(api);
  Raid.registerRoom("XARPUS", XarpusRoom);
};

Object.assign(module.exports, { passedOver, XarpusRoom, QUADRANTS, EXHUMED, ringTiles });
