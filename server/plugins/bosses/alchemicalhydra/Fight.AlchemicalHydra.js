/**
 * One Alchemical Hydra fight (Wiki: Alchemical Hydra, /Strategies; timings, geometry, sounds and
 * messages from rsprox captures, docs/alchemical-hydra.md):
 * - four phases: at 825, 550 and 275 hitpoints a head falls off and it changes form (serpentine ->
 *   electric -> flame -> enraged), 2, 1 and 2 ticks in its change; each of the first three starts
 *   with 75% damage reduction, lost when a vent of its phase's colour is under it as the vents
 *   erupt (red for serpentine, green for electric, blue for flame); any other vent empowers it;
 * - its attacks are counted per phase: three, then the phase's special, then one every tenth;
 *   three basic attacks a style, the count carried over a phase change, the switch sequence 3 ticks
 *   after the third; enraged it alternates every attack, its first opposite the last;
 * - poison: five blobs, the first on the player, landing 3 ticks on in 3x3 splashes (up to 7,
 *   poison 6 for the one aimed at the player, 4 otherwise) and leaving one-tile pools that hit for
 *   up to 12 a tick for 13 ticks; enraged, one blob while the flame phase's fires remain;
 * - lightning: a ball onto the room's centre, then four currents, one from each quadrant, that
 *   step after the player for 12 ticks; one reaching them hits for up to 22 and paralyses them;
 *   a phase change dissipates them;
 * - fire: it walks to the centre and turns solid, stuns the player, breathes a 4x8 wall to either
 *   side of the player's diagonal, then a tracking fire down it that follows them: up to 25, then
 *   a burn of 5 every 5 ticks, five times; the fires stand 56 ticks; the next attack is 12 ticks
 *   after the last breath;
 * - its death or the player leaving clears every pool, current and fire.
 * Combat.AlchemicalHydra.js picks each attack; this keeps the count and runs the rest.
 *
 * Its specials hit as plain damage, not as its attacks, so what the Combat Achievement tasks read
 * is kept here per Hydra (lifeOf): whether it was ever empowered, how many fire specials it
 * breathed, and per player the acid, lightning and fire hits they took (a hit of 0 is still a
 * hit), the special damage they took, whether its acid poisoned them (the poison's own ticks are
 * damage too, even after a 0 splash), and their hitpoints as they changed: on the fight's ticks
 * and on every change between them (`skills:current-level-changed`), so a heal above 10 that a hit
 * takes back down within the same tick is still seen (No Pressure). It outlives stop(), so the
 * death's task rules still read it.
 */
const Common = require("./Common.AlchemicalHydra");
const { launchTiles } = require("./Combat.AlchemicalHydra");

/** Hydra npc -> its fight's record for Combat Achievements (see the header). */
const lives = new WeakMap();
/** Player -> the fight that last logged their hitpoints, for the changes between its ticks. */
const fightsByPlayer = new WeakMap();

/** Compass steps, and each diagonal's two sides: clockwise first, then counter-clockwise (rsprox). */
const STEPS = { N: [0, 1], NE: [1, 1], E: [1, 0], SE: [1, -1], S: [0, -1], SW: [-1, -1], W: [-1, 0], NW: [-1, 1] };
const SIDES = { NW: ["N", "W"], NE: ["E", "N"], SE: ["S", "E"], SW: ["W", "S"] };

function lifeOf(npc) {
  return lives.get(npc) ?? null;
}

function newLife() {
  return { empowered: false, fireBreaths: 0, hits: { acid: new Map(), lightning: new Map(), fire: new Map() }, damage: new Map(), poisoned: new Set(), hitpoints: new Map() };
}

/** Hits a player with one of its specials ("acid", "lightning" or "fire"), noting it for the tasks. */
function hurtBy(life, kind, player, amount, poison = false) {
  const damage = Common.hurtPlayer(player, amount, poison);
  const hits = life.hits[kind];
  hits.set(player, (hits.get(player) ?? 0) + 1);
  life.damage.set(player, (life.damage.get(player) ?? 0) + damage);
  return damage;
}

/** The world tick, for the hitpoints log. */
function now() {
  return Common.worldTick();
}

/** The most hitpoints the player had from this tick on, by the log (null when none was kept). */
function peakHitpointsSince(life, player, fromTick) {
  const log = life?.hitpoints.get(player);
  if (!log?.length) return null;
  let peak = null;
  for (let i = 0; i < log.length; i++) {
    const next = log[i + 1];
    // The entry in effect when the span began counts, and every one after it.
    if (next && next.tick <= fromTick) continue;
    peak = Math.max(peak ?? -Infinity, log[i].hp);
  }
  return peak;
}

/**
 * "skills:current-level-changed": a hitpoints change of a player in a live Hydra fight is logged at once, not only at
 * the Hydra's next tick, so a heal and a hit landing between two of its ticks both show in the log.
 */
function logHitpointsChange({ player, skill }) {
  if (!player || skill !== Common.core?.Skill?.HITPOINTS) return;
  const fight = fightsByPlayer.get(player);
  if (!fight || fight.stopped || !fight.lair.players().includes(player)) return;
  fight.logHitpoints([player]);
}

const PHASES = () => Common.data.phases;
const BLOCKS_PLAYERS_FLAG = () => Common.core.NPC?.BLOCKS_PLAYERS_FLAG ?? "movement:blocks-players";
const WALK_THROUGH_FLAG = () => Common.core.NPC?.WALK_THROUGH_ENTITIES_FLAG ?? "movement:walk-through-entities";
const opposite = (style) => (style === "ranged" ? "magic" : "ranged");

class Fight {
  constructor(lair, npc, random = Math.random) {
    this.lair = lair;
    this.npc = npc;
    this.random = random;
    this.phase = 0;
    /** Attacks this phase, specials included (the special's place in the count). */
    this.attacks = 0;
    /** Basic attacks in the current style; it carries over a phase change (rsprox: "RwMMS"). */
    this.basics = 0;
    // The Wiki: "It can start off with either attack style."
    this.style = random() < 0.5 ? "ranged" : "magic";
    this.shielded = true;
    this.empowered = false;
    this.transitionUntil = 0;
    this.tickCount = 0;
    /** The world tick of its first attack: the fight duration counts from it (rsprox). */
    this.firstAttackTick = null;
    this.pools = [];
    this.currents = [];
    this.waitingCurrents = [];
    this.lightningSpreadsAt = null;
    /** The fire special while it runs: { stage: "walk" | "breath", target, since }. */
    this.fire = null;
    /** Tiles on fire, until the blockers go. */
    this.flames = [];
    /** Only arrived graphics can catch a player stepping onto their tile. */
    this.activeFlames = new Set();
    this.blockedUntil = 0;
    this.trackers = [];
    /** Player -> { since, hits }: a burn from the fire. */
    this.burns = new Map();
    this.lastTiles = new Map();
    this.stopped = false;
    this.life = newLife();
    lives.set(npc, this.life);
    npc.__hydraFight = this;
  }

  get enraged() {
    return this.phase === 3;
  }

  // --- The attack count

  /** The attack the count says comes next: "special" or a basic style. */
  nextAttack() {
    const { specialAt, specialEvery, styleSwitchEvery } = Common.data.combat;
    const n = this.attacks + 1;
    if (n === specialAt || (n > specialAt && (n - specialAt) % specialEvery === 0)) return "special";
    if (this.enraged) return opposite(this.style);
    return this.basics >= styleSwitchEvery ? opposite(this.style) : this.style;
  }

  counted(kind) {
    this.attacks += 1;
    if (this.firstAttackTick === null) this.firstAttackTick = Common.worldTick();
    if (kind === "special") return;
    if (kind !== this.style) this.basics = 0;
    this.style = kind;
    this.basics += 1;
    const { styleSwitchEvery, switchAnimDelay } = Common.data.combat;
    if (!this.enraged && this.basics === styleSwitchEvery) Common.later(switchAnimDelay, () => this.swayHeads());
  }

  /** The heads sway back to show the next three are the other style (Wiki), 3 ticks after the third. */
  swayHeads() {
    if (this.stopped || this.transitioning() || this.enraged || this.fire?.stage === "walk") return;
    const seq = Common.ids.seqs.switch[this.phase];
    if (seq === undefined) return;
    this.npc.performAnimation(new Common.core.Animation(seq));
    Common.areaSound(this.lair.players(), "switch", this.centre());
  }

  transitioning() {
    return this.tickCount < this.transitionUntil;
  }

  /** Whether a special is holding its attacks (the fire's walk and breaths). */
  busy() {
    return this.fire !== null;
  }

  /** The tile at the middle of its footprint (its south-west tile + 3, 3 for its 6x6). */
  centre() {
    const half = Math.floor(Math.max(1, this.npc.getSize?.() ?? 6) / 2);
    return this.npc.getLocation().transform(half, half);
  }

  // --- Phases and vents

  /** Past this phase's threshold, a head falls and the next form comes (one a tick at most). */
  checkPhase() {
    if (this.enraged || this.stopped || this.transitioning()) return false;
    const below = PHASES()[this.phase].below;
    if (this.npc.getHitpoints() > below) return false;
    this.changePhase();
    return true;
  }

  changePhase() {
    const { ids } = Common;
    const transitions = [ids.npcs.toElectric, ids.npcs.toFlame, ids.npcs.toEnraged];
    const from = this.phase;
    this.npc.setNpcTransformationId(transitions[from]);
    this.npc.performAnimation(new Common.core.Animation(ids.seqs.phaseOut[from]));
    const ticks = PHASES()[from].transitionTicks;
    // It holds still while it changes (rsprox: no step in 872 transition ticks), and the player's
    // attack ends quietly: their next needs a click (425 of 426), the refusal answering only clicks.
    // A fire special it was in ends first: ending it releases the walk's hold.
    this.endFireSpecial();
    this.npc.getMovementQueue?.().reset?.();
    this.npc.setScriptedMovement?.(true);
    for (const player of this.lair.players()) {
      if (player.getCombat?.().getTarget?.() === this.npc) player.getCombat().reset?.();
    }
    this.transitionUntil = this.tickCount + ticks;
    // The Wiki: the lightning dissipates, and a fire special in progress ends; its fires stay.
    this.currents = [];
    this.waitingCurrents = [];
    this.lightningSpreadsAt = null;
    this.phase = from + 1;
    this.attacks = 0;
    this.shielded = this.phase < 3;
    this.empowered = false;
    Common.later(ticks, () => {
      if (this.stopped) return;
      if (!this.fire) this.npc.setScriptedMovement?.(false);
      this.npc.setNpcTransformationId(Common.phaseForms()[this.phase]);
      this.npc.performAnimation(new Common.core.Animation(ids.seqs.phaseIn[from]));
      const { firstAttackAfterSpawn, firstEnragedAttackAfterSpawn } = Common.data.combat;
      this.npc.getCombat?.().setAttackDelay?.(this.enraged ? firstEnragedAttackAfterSpawn : firstAttackAfterSpawn);
      if (this.enraged) for (const player of this.lair.players()) player.sendMessage(Common.message("enraged"));
    });
  }

  /**
   * Two ticks after the vents erupt: a vent of its phase's colour under its footprint takes its
   * shield (once a phase); any other vent under it empowers it, every eruption (rsprox, 934 of 934).
   */
  eruptVents(players) {
    if (this.stopped || this.npc.getHitpoints() <= 0 || this.npc.isDyingFunction?.()) return;
    const want = PHASES()[this.phase].vent;
    for (const colour of ["red", "green", "blue"]) {
      if (Common.distanceToFootprint(Common.toLocation(Common.data.vents[colour]), this.npc) !== 0) continue;
      if (colour === want) {
        if (!this.shielded) continue;
        this.shielded = false;
        this.empowered = false;
        this.npc.forceChat?.(Common.message("roar"));
        Common.areaSound(players, "roar", this.centre());
        for (const player of players) Common.spam(player, Common.message("weakened"));
      } else {
        this.empowered = true;
        this.life.empowered = true;
        for (const player of players) Common.spam(player, Common.message("empowered"));
      }
    }
  }

  /** This phase's max and hits for a style (data.combat.styles; the empowered max by the Wiki). */
  hitsOf(style) {
    const { styles, empoweredMax } = Common.data.combat;
    const row = styles[PHASES()[this.phase].name][style];
    return { max: this.empowered ? empoweredMax[row.max] ?? row.max : row.max, hits: row.hits };
  }

  /** onNpcHitModify: 75% less damage while shielded (the enraged form keeps no shield). */
  reduce(damage) {
    if (!this.shielded || this.enraged) return damage;
    return Math.floor(damage * Common.data.combat.shieldedDamage);
  }

  // --- A tick

  tick(players) {
    if (this.stopped) return;
    this.tickCount += 1;
    this.logHitpoints(players);
    if (this.npc.isDyingFunction?.() || this.npc.getHitpoints() <= 0) {
      this.clear();
      return;
    }
    this.checkPhase();
    this.tickPools(players);
    this.tickCurrents(players);
    this.tickFire(players);
  }

  /** Each player's hitpoints, logged as they change (No Pressure reads them). */
  logHitpoints(players) {
    const tick = now();
    for (const player of players) {
      const hp = Number(player.getHitpoints?.());
      if (!Number.isFinite(hp)) continue;
      const log = this.life.hitpoints.get(player) ?? [];
      if (log.at(-1)?.hp !== hp) log.push({ tick, hp });
      this.life.hitpoints.set(player, log);
      fightsByPlayer.set(player, this);
    }
  }

  // --- Poison

  /** Fires from the flame phase still burning (their blockers stand). */
  firesBurning() {
    return this.blockedUntil > this.tickCount;
  }

  spitPoison(target) {
    const { poison } = Common.data;
    const count = this.enraged && this.firesBurning() ? poison.enragedBlobsWhileFire : poison.blobs;
    const base = target.getLocation();
    const tiles = [base];
    for (let attempt = 0; tiles.length < count && attempt < 40; attempt++) {
      const tile = base.transform(Common.randomInt(-poison.spread, poison.spread), Common.randomInt(-poison.spread, poison.spread));
      if (!this.lair.contains(tile) || tiles.some((other) => sameTile(other, tile))) continue;
      tiles.push(tile);
    }
    const { Projectile } = Common.core;
    const players = this.lair.players();
    const [from] = launchTiles(this.npc, "ranged", base, 1);
    tiles.forEach((tile, index) => {
      const end = poison.endBase + poison.endPerTile * chebyshev(from, tile);
      const flight = new Projectile(from, tile, null, Common.ids.spotanims.poisonFlight, poison.start, end, poison.startHeight, poison.endHeight, this.npc.getPrivateArea?.() ?? null);
      flight.withAngle?.(0);
      flight.withProgress?.(0);
      flight.sendProjectile();
      Common.tileGraphic(players, tile, Common.ids.spotanims.poisonSplash, end);
      Common.areaSound(players, "poison", tile, end);
      Common.later(poison.landDelay, () => this.landPoison(tile, index === 0 ? target : null));
    });
  }

  landPoison(centre, aimedAt, angle = Common.randomInt(0, 7)) {
    if (this.stopped) return;
    const { poison } = Common.data;
    const { spotanims } = Common.ids;
    const players = this.lair.players();
    Common.tileGraphic(players, centre, spotanims.poisonLanding[angle]);
    if (aimedAt) Common.areaSound(players, "poisonLanding", centre);
    for (const player of players) {
      if (chebyshev(player.getLocation(), centre) > 1) continue;
      hurtBy(this.life, "acid", player, Common.randomInt(0, poison.splashMax), true);
      // Severity, hit x 5: the Wiki's hits are 6 on the target and 4 beside it (Alchemical Hydra/Strategies).
      Common.core.CombatFactory.poisonEntity(player, (player === aimedAt ? poison.poisonTargeted : poison.poisonNear) * 5);
      // Its poison ticks are damage the hit log never sees; an antipoison keeps them off.
      if (player.isPoisoned?.() || player.isVenomed?.()) this.life.poisoned.add(player);
    }
    // rsprox: the pool is the blob's own tile (stood beside, 363 of 376 ticks took nothing).
    if (this.lair.contains(centre)) this.pools.push({ tile: centre, from: this.tickCount + 1, until: this.tickCount + poison.poolTicks });
    Common.later(1, () => {
      if (!this.stopped) Common.tileGraphic(this.lair.players(), centre, spotanims.poisonLanded[angle]);
    });
  }

  tickPools(players) {
    if (this.pools.length === 0) return;
    const { poolMax } = Common.data.poison;
    for (const player of players) {
      if (this.pools.some((pool) => this.tickCount >= pool.from && sameTile(pool.tile, player.getLocation()))) {
        hurtBy(this.life, "acid", player, Common.randomInt(1, poolMax), true);
      }
    }
    this.pools = this.pools.filter((pool) => this.tickCount < pool.until);
  }

  // --- Lightning

  castLightning() {
    const { lightning } = Common.data;
    const { Projectile } = Common.core;
    const centre = Common.toLocation(Common.data.room.lightningCentre);
    const [from] = launchTiles(this.npc, "magic", centre, 1);
    const end = lightning.casterEndBase + lightning.casterEndPerTile * chebyshev(from, centre);
    const ball = new Projectile(from, centre, null, Common.ids.spotanims.lightningCaster, 30, end, 40, 63, this.npc.getPrivateArea?.() ?? null);
    ball.withAngle?.(0);
    ball.withProgress?.(0);
    ball.sendProjectile();
    Common.tileGraphic(this.lair.players(), centre, Common.ids.spotanims.lightningCaster, end, 255);
    this.lightningSpreadsAt = this.tickCount + lightning.spreadAfter;
  }

  /** Whether any current is out or on its way. */
  lightningActive() {
    return this.currents.length > 0 || this.waitingCurrents.length > 0 || this.lightningSpreadsAt !== null;
  }

  /** The ball splits: one current to a random tile of each quadrant's block, in a random order. */
  spreadLightning() {
    const { Projectile } = Common.core;
    const centre = Common.toLocation(Common.data.room.lightningCentre);
    const quadrants = [...Common.data.room.currentQuadrants].sort(() => this.random() - 0.5);
    quadrants.slice(0, Common.data.lightning.currents).forEach(([[minX, maxX], [minY, maxY]], index) => {
      const x = Common.randomInt(minX, maxX);
      const y = Common.randomInt(minY, maxY);
      const travel = new Projectile(centre, new Common.core.Location(x, y, centre.getZ()), null, Common.ids.spotanims.lightning, 15 + 30 * index, 30 + 30 * index, 63, 0, this.npc.getPrivateArea?.() ?? null);
      travel.withAngle?.(0);
      travel.withProgress?.(0);
      travel.sendProjectile();
      this.waitingCurrents.push({ x, y, at: this.tickCount + 1 + index, shown: 0 });
    });
  }

  tickCurrents(players) {
    if (this.lightningSpreadsAt !== null && this.tickCount >= this.lightningSpreadsAt) {
      this.lightningSpreadsAt = null;
      this.spreadLightning();
    }
    if (this.waitingCurrents.length > 0) {
      this.currents.push(...this.waitingCurrents.filter((current) => current.at <= this.tickCount));
      this.waitingCurrents = this.waitingCurrents.filter((current) => current.at > this.tickCount);
    }
    if (this.currents.length === 0) return;
    const target = players[0];
    const { lightning } = Common.data;
    const left = [];
    for (const current of this.currents) {
      if (target && current.shown > 0) {
        const at = target.getLocation();
        current.x += Math.sign(at.getX() - current.x);
        current.y += Math.sign(at.getY() - current.y);
      }
      current.shown += 1;
      const tile = new Common.core.Location(current.x, current.y, target?.getLocation().getZ() ?? 0);
      Common.tileGraphic(players, tile, Common.ids.spotanims.shock);
      Common.areaSound(players, "shock", tile);
      if (target && sameTile(tile, target.getLocation())) {
        hurtBy(this.life, "lightning", target, Common.randomInt(0, lightning.max));
        target.sendMessage(Common.message("paralysed"));
        bind(target, lightning.bindTicks);
        continue;
      }
      if (current.shown < lightning.lifetime) left.push(current);
    }
    this.currents = left;
  }

  // --- Fire

  /** The flame special: it walks to the centre first (Wiki), holding its attacks. */
  startFire(target) {
    this.fire = { stage: "walk", target, since: this.tickCount };
    this.npc.setScriptedMovement?.(true);
    // A player in its way doesn't stop it; one left under it is pushed out (Wiki).
    this.npc.setFlag?.(WALK_THROUGH_FLAG());
  }

  /** The special from the moment it stands in the centre (also run directly by the tests). */
  breatheFire(target) {
    if (!this.fire) this.npc.setScriptedMovement?.(true);
    this.fire = { stage: "breath", target, since: this.tickCount, diagonal: this.diagonalTo(target.getLocation()) };
    this.block();
  }

  /** Solid while its fires stand: blockers over its footprint, for this chamber only. */
  block() {
    const { fire } = Common.data;
    this.blockedUntil = this.tickCount + fire.fireTicks;
    this.npc.removeFlag?.(WALK_THROUGH_FLAG());
    this.npc.setFlag?.(BLOCKS_PLAYERS_FLAG());
    // The blockers stay on the tiles they went up on (rsprox: cleared there, wherever it is by then).
    this.blockedAt = this.npc.getLocation();
    this.showBlockers(Common.ids.locs.blocking);
    this.pushOut();
  }

  unblock() {
    this.blockedUntil = 0;
    this.flames = [];
    this.activeFlames.clear();
    Common.core.TaskManager.cancelTasks?.(this);
    this.npc.removeFlag?.(BLOCKS_PLAYERS_FLAG());
    this.showBlockers(Common.ids.locs.nonblocking);
    this.blockedAt = null;
  }

  showBlockers(id) {
    const players = this.lair.players();
    const base = this.blockedAt ?? this.npc.getLocation();
    const size = Math.max(1, this.npc.getSize?.() ?? 6);
    for (let dx = 0; dx < size; dx++) for (let dy = 0; dy < size; dy++) Common.showLoc(players, id, base.transform(dx, dy));
  }

  /** The Wiki: "If the player is underneath, they are forced out in a random direction". */
  pushOut() {
    const base = this.npc.getLocation();
    const size = Math.max(1, this.npc.getSize?.() ?? 6);
    for (const player of this.lair.players()) {
      const at = player.getLocation();
      if (Common.distanceToFootprint(at, this.npc) !== 0) continue;
      // Ours: straight out of the side picked, the nearest tile past its edge.
      const sides = [
        [at.getX(), base.getY() + size], [at.getX(), base.getY() - 1],
        [base.getX() + size, at.getY()], [base.getX() - 1, at.getY()],
      ].map(([x, y]) => new Common.core.Location(x, y, at.getZ())).filter((tile) => this.lair.contains(tile));
      if (sides.length === 0) continue;
      player.getMovementQueue?.().reset?.();
      player.moveTo(sides[Math.floor(this.random() * sides.length)]);
    }
  }

  /** A phase change ends the special at once; fires already breathed stay (Wiki). */
  endFireSpecial() {
    if (!this.fire) return;
    this.fire = null;
    this.trackers = [];
    this.npc.removeFlag?.(WALK_THROUGH_FLAG());
    this.npc.setScriptedMovement?.(false);
  }

  /** The player's diagonal from its footprint's centre, as NW, NE, SE or SW. */
  diagonalTo(location) {
    const base = this.npc.getLocation();
    const half = (Math.max(1, this.npc.getSize?.() ?? 6) - 1) / 2;
    const north = location.getY() >= base.getY() + half;
    const east = location.getX() >= base.getX() + half;
    return (north ? "N" : "S") + (east ? "E" : "W");
  }

  /** A wall of fire 4 wide and 8 long out of one side of its footprint. */
  breath(direction) {
    const { fire } = Common.data;
    const { Projectile } = Common.core;
    const players = this.lair.players();
    const base = this.npc.getLocation();
    const size = Math.max(1, this.npc.getSize?.() ?? 6);
    const [dx, dy] = STEPS[direction];
    this.npc.performAnimation(new Common.core.Animation(Common.ids.seqs.special[2]));
    this.npc.setPositionToFace?.(this.centre().transform(dx * 15, dy * 15));
    const from = base.transform(1, size - 2);
    for (let k = 0; k < fire.carpetLength; k++) {
      const row = [];
      for (let w = 1; w <= fire.carpetWidth; w++) {
        // Out of the north or south side: x runs across it; out of the east or west: y.
        const x = dx === 0 ? base.getX() + w : dx > 0 ? base.getX() + size + k : base.getX() - 1 - k;
        const y = dy === 0 ? base.getY() + w : dy > 0 ? base.getY() + size + k : base.getY() - 1 - k;
        const tile = new Common.core.Location(x, y, base.getZ());
        if (!this.lair.contains(tile)) continue;
        row.push(tile);
      }
      const delay = fire.firstDelay + fire.delayPerTile * k;
      row.forEach((tile) => {
        if (k === 0) {
          const flight = new Projectile(from, tile, null, Common.ids.spotanims.fireTravel, 30, fire.firstDelay, 35, 0, this.npc.getPrivateArea?.() ?? null);
          flight.withAngle?.(0);
          flight.withProgress?.(0);
          flight.sendProjectile();
        }
        this.flame(tile, delay);
      });
      if (row[0]) Common.areaSound(players, "fire", row[0], delay, k === 0 ? Common.data.sounds.fire.firstRange : undefined);
    }
  }

  /** The last breath: a fire down the diagonal that follows the player. */
  trackingFire(direction, target) {
    const { fire } = Common.data;
    const { Projectile } = Common.core;
    const players = this.lair.players();
    const base = this.npc.getLocation();
    const size = Math.max(1, this.npc.getSize?.() ?? 6);
    const [dx, dy] = STEPS[direction];
    this.npc.performAnimation(new Common.core.Animation(Common.ids.seqs.special[2]));
    this.npc.setPositionToFace?.(this.centre().transform(dx * 15, dy * 15));
    const start = new Common.core.Location(dx > 0 ? base.getX() + size : base.getX() - 1, dy > 0 ? base.getY() + size : base.getY() - 1, base.getZ());
    const flight = new Projectile(base.transform(1, size - 2), start, null, Common.ids.spotanims.fireTravel, 30, fire.firstDelay, 35, 0, this.npc.getPrivateArea?.() ?? null);
    flight.withAngle?.(0);
    flight.withProgress?.(0);
    flight.sendProjectile();
    this.flame(start, fire.firstDelay);
    Common.areaSound(players, "trackingFire", start, fire.firstDelay);
    const tracker = { x: start.getX(), y: start.getY(), until: this.tickCount + fire.trackTicks, target };
    this.trackers.push(tracker);
  }

  /** Activate on the graphic's arrival, before that tick's Player hit queue drains. */
  flame(tile, delay) {
    Common.tileGraphic(this.lair.players(), tile, Common.ids.spotanims.fire, delay);
    this.flames.push(tile);
    const fight = this;
    const { Task, TaskManager } = Common.core;
    TaskManager.submit(new (class extends Task {
      constructor() {
        super(Math.max(1, Math.ceil(delay / 30)), fight, false);
      }
      execute() {
        this.stop();
        if (fight.stopped || fight.npc.__hydraFight !== fight || fight.npc.isRegistered?.() === false || fight.npc.getHitpoints() <= 0 || fight.npc.isDyingFunction?.() || !fight.flames.includes(tile)) return;
        fight.activeFlames.add(tile);
        for (const player of fight.lair.players()) {
          const at = player.getLocation();
          if (player.isRegistered?.() === false || player.getHitpoints?.() <= 0 || !fight.lair.contains(at) || at.getZ() !== tile.getZ() || !sameTile(tile, at)) continue;
          // Keep the existing burn clock: later area damage drains on the following turn.
          fight.lastTiles.set(player, at);
          fight.scorch(player);
        }
      }
    })());
  }

  tickFire(players) {
    const { fire } = Common.data;
    this.tickSpecial(players);
    // The tracking fire: a tile a tick toward the player, two when they are further than two off
    // (Wiki: "faster the further away they are"); its delayed flame catches on arrival.
    const left = [];
    for (const tracker of this.trackers) {
      const target = tracker.target;
      if (this.tickCount > tracker.until || !target || target.isRegistered?.() === false) continue;
      const at = target.getLocation();
      const steps = chebyshev(at, new Common.core.Location(tracker.x, tracker.y, at.getZ())) > 2 ? 2 : 1;
      for (let s = 0; s < steps; s++) {
        if (tracker.x === at.getX() && tracker.y === at.getY()) break;
        tracker.x += Math.sign(at.getX() - tracker.x);
        tracker.y += Math.sign(at.getY() - tracker.y);
        const tile = new Common.core.Location(tracker.x, tracker.y, at.getZ());
        const delay = 60 + 15 * s;
        this.flame(tile, delay);
        Common.areaSound(players, "trackingFire", tile, delay);
      }
      left.push(tracker);
    }
    this.trackers = left;
    // Ours: stepping onto a burning tile scorches too (no recording isolates it).
    if (this.flames.length > 0) {
      for (const player of players) {
        const tile = player.getLocation();
        const before = this.lastTiles.get(player);
        this.lastTiles.set(player, tile);
        if (before && sameTile(before, tile)) continue;
        if (this.flames.some((flame) => this.activeFlames.has(flame) && sameTile(flame, tile)) && !this.trackers.some((t) => t.x === tile.getX() && t.y === tile.getY())) this.scorch(player);
      }
    }
    for (const [player, burn] of this.burns) {
      const since = this.tickCount - burn.since;
      if (since <= 0 || since % fire.burnEvery !== 0) continue;
      hurtBy(this.life, "fire", player, fire.burnDamage);
      burn.hits += 1;
      Common.spam(player, Common.message(burn.hits >= fire.burnHits ? "burnCleared" : "burning"));
      if (burn.hits >= fire.burnHits) this.burns.delete(player);
    }
    if (this.blockedUntil > 0 && this.tickCount >= this.blockedUntil) this.unblock();
  }

  /** The special's own clock: the walk, the stun, the three breaths and the attack after. */
  tickSpecial(players) {
    const special = this.fire;
    if (!special) return;
    const { fire } = Common.data;
    if (special.stage === "walk") {
      const centre = Common.toLocation(Common.data.room.centre);
      const at = this.npc.getLocation();
      const there = at.getX() === centre.getX() && at.getY() === centre.getY();
      // Ours: a walk that can't finish (a wall it can't round) breathes where it stands.
      if (!there && this.tickCount - special.since < fire.walkTicksMax) {
        this.npc.getMovementQueue?.().walkStep?.(Math.sign(centre.getX() - at.getX()), Math.sign(centre.getY() - at.getY()));
        return;
      }
      special.stage = "breath";
      special.since = this.tickCount;
      // rsprox: the walls go to the sides of the player's diagonal as it arrives.
      special.diagonal = this.diagonalTo((special.target ?? players[0])?.getLocation?.() ?? this.centre());
      this.block();
      return;
    }
    const k = this.tickCount - special.since;
    const { target, diagonal } = special;
    const [first, second] = SIDES[diagonal];
    if (k === 1) for (const player of players) stun(player);
    else if (k === fire.specialEvery) {
      // The Flame Skipper counts a wall breathed, not a walk a phase change cut short.
      this.life.fireBreaths += 1;
      this.breath(first);
    }
    else if (k === fire.specialEvery * 2) this.breath(second);
    else if (k === fire.specialEvery * 3) this.trackingFire(diagonal, target);
    // Combat swings the tick after it lets go, so it lets go a tick early.
    else if (k >= fire.specialEvery * 3 + fire.nextAttackAfter - 1) {
      this.fire = null;
      this.npc.setScriptedMovement?.(false);
      this.npc.getCombat?.().setAttackDelay?.(0);
    }
  }

  /** The fire's hit (up to 25), then its burn: 5 every 5 ticks, five times (Wiki). */
  scorch(player) {
    const { fire } = Common.data;
    hurtBy(this.life, "fire", player, Common.randomInt(0, fire.trackMax));
    Common.spam(player, Common.message("scorched"));
    this.burns.set(player, { since: this.tickCount, hits: 0 });
  }

  // --- The end

  clear() {
    Common.core.TaskManager.cancelTasks?.(this);
    this.flames = [];
    this.activeFlames.clear();
    this.pools = [];
    this.currents = [];
    this.waitingCurrents = [];
    this.lightningSpreadsAt = null;
    this.trackers = [];
    this.burns.clear();
    if (this.fire) this.endFireSpecial();
    if (this.blockedUntil > 0) this.unblock();
  }

  stop() {
    this.clear();
    this.stopped = true;
    if (this.npc.__hydraFight === this) this.npc.__hydraFight = null;
  }
}

function sameTile(a, b) {
  return a.getX() === b.getX() && a.getY() === b.getY();
}

function chebyshev(a, b) {
  return Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY()));
}

/** "The Alchemical Hydra temporarily stuns you.": held in place, still free to attack (Wiki). */
function stun(player) {
  player.sendMessage(Common.message("stunned"));
  bind(player, Common.data.fire.stunTicks);
}

/** Holds the player in place for a few ticks; a later hold extends it. */
function bind(player, ticks) {
  const queue = player.getMovementQueue?.();
  if (!queue) return;
  const until = (player.__hydraBoundUntil ?? 0) > Date.now() ? player.__hydraBoundUntil : 0;
  player.__hydraBoundUntil = Math.max(until, Date.now() + ticks * 600);
  queue.reset?.();
  queue.setBlockMovement?.(true);
  Common.later(ticks, () => {
    if ((player.__hydraBoundUntil ?? 0) > Date.now() + 1) return;
    if (player.getHitpoints?.() <= 0 || player.isDyingFunction?.()) return;
    player.__hydraBoundUntil = 0;
    queue.setBlockMovement?.(false);
  });
}

module.exports = { Fight, chebyshev, bind, stun, lifeOf, peakHitpointsSince, logHitpointsChange };
