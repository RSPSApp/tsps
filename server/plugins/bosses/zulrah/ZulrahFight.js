"use strict";

/**
 * One player's fight with Zulrah at its shrine.
 *
 * Wiki ("Zulrah", "Zulrah/Strategies"):
 * - Zulrah rises once the player continues the boat dialogue or does anything else.
 * - It attacks every 3 ticks, up to 41: green form with Ranged, blue form with Magic and
 *   sometimes Ranged (Magic much more often), and the "Jad" phase alternating the two. Damage
 *   is rolled as the attack starts, and an attack that lands envenoms even through prayer.
 * - The red form stares at the player's tile, then whips its tail there: 20-30 typeless damage
 *   and a stun, avoided by moving two tiles away. It does this twice.
 * - Between phases it dives and resurfaces, maybe in another form and place; it cannot be
 *   attacked while under.
 * Near-Reality (no capture here): the animations, projectiles and their timings; when each
 * step starts (3 ticks after the last); the dive (resurfacing 3 ticks after diving, acting 4
 * after that); the tail's two swings (aimed at ticks 0 and 9, striking at 5 and 15), the
 * tiles beside the pillars it cannot reach and the knock-back; 3 in 10 blue-form attacks
 * being Ranged.
 */

const Shared = require("./ZulrahShared");
const { PhaseCursor } = require("./ZulrahRotations");
const { Hazards, envenom } = require("./ZulrahHazards");

const MAX_HIT = 41;
const STEP_TICKS = 3;
const FIRST_STEP_TICKS = 9;
const INTERACT_AFTER_RISE = 4;
const DIVE_TICKS = 3;
/**
 * Resurfacing teleports Zulrah, and a teleported NPC is left out of every player's view for
 * that tick, so the rise is played on the next one, when it is back: 1 + 3 = 4 ticks to act.
 */
const RESURFACE_TICKS = 1;
const RISE_TO_ACT_TICKS = 3;
const BLUE_RANGED_CHANCE = 0.3;
const FORM_ID = { green: Shared.NPC.GREEN, red: Shared.NPC.RED, blue: Shared.NPC.BLUE };

const ANIM = { ATTACK: 5069, SPAWN: 5071, DIVE: 5072, RISE: 5073, TAIL_LEFT: 5806, TAIL_RIGHT: 5807, KNOCKBACK: 1157 };
/** endCycle = start + duration + perTile * distance (Near-Reality's projectile timings). */
const PROJECTILE = {
  ranged: { id: 1044, start: 40, duration: 18, perTile: 5 },
  magic: { id: 1046, start: 40, duration: 18, perTile: 5 },
  clouds: [{ id: 1045, start: 40, duration: 28, perTile: 5 }, { id: 1045, start: 40, duration: 58, perTile: 5 }],
  snakeling: { id: 1047, start: 40, duration: 90, perTile: 5 },
};
const PROJECTILE_HEIGHT = { from: 65, to: 10 };

const TAIL = {
  aimAt: [0, 9],
  strikeAt: [5, 15],
  endsAt: 18,
  damage: [20, 30],
  stunSeconds: 3,
  knockback: 4,
  /** Beside the pillars, where the tail cannot reach (Near-Reality; the Wiki's safespot). */
  safe: [[2273, 3072], [2272, 3072], [2264, 3072], [2263, 3072]],
  /** Near-Reality: in rotations 1 and 2 the first swing never reaches this tile on the north-east tip. */
  firstSwingSafe: [2274, 3077],
};

let StyleMethod = null;

/** A combat method only so a PendingHit knows its style; Zulrah's attacks are scripted here. */
function styleMethod(style) {
  if (!StyleMethod) {
    const { CombatMethod, CombatType } = Shared.core();
    StyleMethod = class extends CombatMethod {
      constructor(type) {
        super();
        this.stance = CombatType[type];
      }

      type() {
        return this.stance;
      }

      hits() {
        return [];
      }

      handleAfterHitEffects(hit) {
        envenom(hit);
      }
    };
    StyleMethod.ranged = new StyleMethod("RANGED");
    StyleMethod.magic = new StyleMethod("MAGIC");
  }
  return StyleMethod[style];
}

/** Zulrah's own combat: nothing. Its attacks are the fight's, never the engine's. */
function idleMethod() {
  const { CombatMethod, CombatType } = Shared.core();
  return class extends CombatMethod {
    type() {
      return CombatType.MAGIC;
    }

    canAttack() {
      return false;
    }

    attackDistance() {
      return 30;
    }

    hits() {
      return [];
    }
  };
}

let ArenaClass = null;

function arenaClass() {
  if (ArenaClass) return ArenaClass;
  const { PrivateArea, Boundary } = Shared.core();
  const { minX, maxX, minY, maxY } = Shared.SHRINE;
  ArenaClass = class ZulrahShrine extends PrivateArea {
    constructor() {
      super([new Boundary(minX, maxX, minY, maxY, 0)]);
      this.fight = null;
    }

    getName() {
      return "Zulrah's shrine";
    }

    isMulti() {
      return true;
    }

    /** Teleporting, dying or logging out ends the fight. */
    postLeave(mobile, logout) {
      if (mobile.isPlayer?.() && this.fight?.player === mobile.getAsPlayer()) this.fight.end({ fromArea: true });
      super.postLeave(mobile, logout);
    }
  };
  return ArenaClass;
}

const fights = new Map();

function centreOf(npc) {
  const at = npc.getLocation();
  const half = (npc.getSize() - 1) >> 1;
  return { x: at.getX() + half, y: at.getY() + half };
}

class ZulrahFight {
  /** `rotation` (0-3) forces the first rotation, for testing; later ones stay random. */
  constructor(player, { random = Math.random, rotation = null } = {}) {
    this.player = player;
    this.random = random;
    this.area = new (arenaClass())();
    this.area.fight = this;
    this.hazards = new Hazards(this);
    let forced = Number.isInteger(rotation) ? rotation : null;
    this.cursor = new PhaseCursor(() => {
      const pick = forced ?? Math.floor(this.random() * 4);
      forced = null;
      return pick;
    });
    this.zulrah = null;
    this.phase = null;
    this.actions = [];
    this.ticks = 0;
    this.nextAt = 0;
    this.interactAt = Infinity;
    this.startedAt = 0;
    this.teleport = null;
    this.stage = "waiting";
    this.task = null;
    fights.set(player, this);
  }

  // ---------------------------------------------------------------- arrival

  /** The boat has landed: the player is on the shrine and Zulrah waits to rise. */
  enter() {
    const player = this.player;
    this.area.enter(player);
    player.moveTo(Shared.loc(Shared.PLAYER_START));
    this.landedAt = player.getLocation().clone();
    this.task = Shared.repeat(this, 1, () => this.tick());
  }

  /** Rises once the dialogue is gone or the player acts (Wiki). */
  readyToRise() {
    const player = this.player;
    return !player.getDialogueManager().isActive() || !player.getLocation().equals(this.landedAt);
  }

  spawnNpc(id, tile) {
    const npc = Shared.api().spawnNpc({ id, x: tile.x, y: tile.y, z: 0, wanderRadius: 0 });
    if (!npc) return null;
    npc.__skipDefaultRespawn = true;
    npc.__zulrahFight = this;
    this.area.add(npc);
    return npc;
  }

  rise() {
    const { Animation } = Shared.core();
    const position = Shared.POSITION.middle;
    this.zulrah = this.spawnNpc(Shared.NPC.GREEN, position.spawn);
    if (!this.zulrah) {
      this.end();
      return;
    }
    const npc = this.zulrah;
    npc.setFlag?.("combat:no-retaliate");
    npc.setFlag?.("interaction:keep");
    npc.getMovementQueue().setBlockMovement(true);
    npc.performAnimation(new Animation(ANIM.SPAWN));
    this.facePlayer();
    this.stage = "fight";
    this.surfaced = true;
    this.startedAt = this.ticks;
    this.interactAt = this.ticks + INTERACT_AFTER_RISE;
    this.nextAt = this.ticks + FIRST_STEP_TICKS;
    this.beginPhase(this.cursor.next());
  }

  // ---------------------------------------------------------------- the loop

  tick() {
    if (this.stage === "ended") return false;
    const player = this.player;
    this.ticks++;
    if (this.stage === "waiting") {
      if (this.readyToRise()) this.rise();
      return true;
    }
    if (this.stage !== "fight") return true;
    this.hazards.tick(player);
    if (!this.zulrah || this.zulrah.getHitpoints() <= 0 || !this.zulrah.isRegistered()) return true;
    // Its attacks are scripted, so keep its health from regenerating as if out of combat.
    this.zulrah.getCombat().getLastAttack?.().reset?.();
    if (this.surfaced) this.facePlayer();
    if (player.getHitpoints() <= 0) return true;
    while (this.ticks >= this.nextAt && this.stage === "fight") {
      if (this.actions.length === 0) this.beginPhase(this.cursor.next(), true);
      const wait = this.actions.shift()();
      this.nextAt = this.ticks + wait;
    }
    return true;
  }

  get attackable() {
    return this.stage === "fight" && this.ticks >= this.interactAt;
  }

  /** Queues a phase's steps; `dive` puts the dive and resurfacing in front of them. */
  beginPhase(phase, dive = false) {
    this.phase = phase;
    this.actions = [];
    if (dive) {
      this.actions.push(() => this.dive());
      this.actions.push(() => this.resurface(phase));
      this.actions.push(() => this.surface());
    }
    for (const step of phase.steps) this.actions.push(...this.expand(step));
  }

  expand([kind, ...args]) {
    if (kind === "ranged") return Array.from({ length: args[0] }, () => () => this.attack("ranged"));
    if (kind === "magic") {
      return Array.from({ length: args[0] }, () => () => this.attack(this.random() < BLUE_RANGED_CHANCE ? "ranged" : "magic"));
    }
    if (kind === "jad") {
      const [first, count] = args;
      const other = first === "ranged" ? "magic" : "ranged";
      return Array.from({ length: count }, (_, index) => () => this.attack(index % 2 === 0 ? first : other));
    }
    if (kind === "clouds") return [() => this.spitClouds(args[0])];
    if (kind === "snakeling") return [() => this.spitSnakeling(args[0])];
    if (kind === "melee") return this.tail();
    throw new Error(`unknown Zulrah step ${kind}`);
  }

  // ---------------------------------------------------------------- attacks

  fire(projectile, to) {
    const { Projectile } = Shared.core();
    const npc = this.zulrah;
    const from = Projectile.centreOf(npc);
    const target = to.getLocation ? to.getLocation() : to;
    const end = projectile.start + projectile.duration + from.getDistance(target) * projectile.perTile;
    const shot = to.getLocation
      ? Projectile.createProjectile(npc, to, projectile.id, projectile.start, end, PROJECTILE_HEIGHT.from, PROJECTILE_HEIGHT.to)
      : new Projectile(from, target, null, projectile.id, projectile.start, end, PROJECTILE_HEIGHT.from, PROJECTILE_HEIGHT.to, this.area);
    shot.sendProjectile();
    this.lastFlight = end;
    return Math.max(1, Math.ceil(end / 30));
  }

  /** One Ranged or Magic attack, rolled (with the player's prayer) as it starts. */
  attack(style) {
    const { Animation, CombatFactory, PendingHit, RegionManager } = Shared.core();
    const npc = this.zulrah;
    const player = this.player;
    npc.performAnimation(new Animation(ANIM.ATTACK));
    if (!RegionManager.canProjectileAttackTarget(npc, player)) return STEP_TICKS;
    const delay = this.fire(PROJECTILE[style], player);
    const ranged = style === "ranged";
    Shared.sound(player, ranged ? Shared.SOUND.RANGED : Shared.SOUND.MAGIC);
    Shared.sound(player, ranged ? Shared.SOUND.RANGED_IMPACT : Shared.SOUND.MAGIC_IMPACT, this.lastFlight);
    const hit = new PendingHit(npc, player, styleMethod(style), delay);
    CombatFactory.applyStyleDamage(hit, MAX_HIT);
    CombatFactory.addPendingHit(hit);
    return STEP_TICKS;
  }

  /**
   * Zulrah keeps facing the player while it is up. Live, it turns to the tiles it spits clouds
   * and snakelings at and whips its tail toward; NPC updates here carry no face-tile, only
   * face-entity, so it stays on the player then too.
   */
  facePlayer() {
    if (this.zulrah?.getInteractingMobile?.() !== this.player) this.zulrah?.setMobileInteraction?.(this.player);
  }

  spitClouds([x1, y1, x2, y2]) {
    const { Animation } = Shared.core();
    const tiles = [{ x: x1, y: y1 }, { x: x2, y: y2 }];
    this.zulrah.performAnimation(new Animation(ANIM.ATTACK));
    Shared.sound(this.player, Shared.SOUND.CLOUD_SPIT);
    tiles.forEach((tile, index) => {
      const ticks = this.fire(PROJECTILE.clouds[index], Shared.loc(tile));
      Shared.later(this, ticks, () => {
        if (this.stage === "fight" && this.zulrah?.getHitpoints() > 0) this.hazards.addCloud(tile);
      });
    });
    return STEP_TICKS;
  }

  spitSnakeling([x, y]) {
    const { Animation } = Shared.core();
    const tile = { x, y };
    this.zulrah.performAnimation(new Animation(ANIM.ATTACK));
    Shared.sound(this.player, Shared.SOUND.SNAKELING_SPIT);
    const ticks = this.fire(PROJECTILE.snakeling, Shared.loc(tile));
    Shared.later(this, ticks, () => {
      if (this.stage === "fight" && this.zulrah?.getHitpoints() > 0) this.hazards.addSnakeling(tile);
    });
    return STEP_TICKS;
  }

  // ---------------------------------------------------------------- the tail

  /** Two swings: aim at the player's tile, strike it 5 (then 6) ticks later. */
  tail() {
    const [aim1, aim2] = TAIL.aimAt;
    const [strike1, strike2] = TAIL.strikeAt;
    const then = (action, wait) => () => {
      action();
      return wait;
    };
    return [
      then(() => this.aimTail(), strike1 - aim1),
      then(() => this.strikeTail(true), aim2 - strike1),
      then(() => this.aimTail(), strike2 - aim2),
      then(() => this.strikeTail(false), TAIL.endsAt - strike2),
    ];
  }

  /** Near-Reality's choice of tail animation, by where the player stands. */
  aimTail() {
    const { Animation } = Shared.core();
    const tile = this.player.getLocation();
    const zul = this.zulrah.getLocation();
    const x = tile.getX();
    const y = tile.getY();
    const north = y >= 3074;
    this.tailTarget = tile.clone();
    let anim = null;
    if (y === 3078) {
      if (x < zul.getX() - 1) anim = north ? ANIM.TAIL_RIGHT : ANIM.TAIL_LEFT;
      else if (x > zul.getX() + 5) anim = north ? ANIM.TAIL_LEFT : ANIM.TAIL_RIGHT;
    } else if (x < zul.getX() - 1) {
      anim = north ? ANIM.TAIL_RIGHT : ANIM.TAIL_LEFT;
    } else if (x > zul.getX() + 5) {
      anim = north ? ANIM.TAIL_LEFT : ANIM.TAIL_RIGHT;
    } else {
      anim = x >= 2268 ? ANIM.TAIL_LEFT : ANIM.TAIL_RIGHT;
    }
    if (anim) this.zulrah.performAnimation(new Animation(anim));
  }

  strikeTail(first = false) {
    const { RegionManager } = Shared.core();
    const player = this.player;
    const here = player.getLocation();
    const target = this.tailTarget;
    if (!target || player.getHitpoints() <= 0) return;
    if (Math.abs(here.getX() - target.getX()) > 1 || Math.abs(here.getY() - target.getY()) > 1) return;
    if (TAIL.safe.some(([x, y]) => here.getX() === x && here.getY() === y)) return;
    const [sx, sy] = TAIL.firstSwingSafe;
    if (first && this.cursor.rotation <= 1 && here.getX() === sx && here.getY() === sy) return;
    const centre = centreOf(this.zulrah);
    if (!RegionManager.canProjectileMove(target.getX(), target.getY(), centre.x, centre.y, 0, 1, 1, this.area)) return;
    this.whip(player);
  }

  /** Thrown back from Zulrah, stunned, and hit for 20-30 with venom. */
  whip(player) {
    const { Animation, CombatFactory, ForceMovement, ForceMovementTask, HitDamage, HitMask, Location, TaskManager } = Shared.core();
    const destination = this.knockbackTile(player);
    const here = player.getLocation();
    if (!destination.equals(here)) {
      const offset = new Location(destination.getX() - here.getX(), destination.getY() - here.getY());
      const direction = this.facingZulrah(here);
      TaskManager.submit(new ForceMovementTask(player, 1, new ForceMovement(here.clone(), offset, 0, 30, direction, -1)));
    }
    player.performAnimation(new Animation(ANIM.KNOCKBACK));
    player.setMobileInteraction?.(this.zulrah);
    CombatFactory.stun(player, TAIL.stunSeconds, true);
    player.sendMessage("You have been stunned!");
    const damage = Shared.randomInt(this.random, ...TAIL.damage);
    player.getCombat().getHitQueue().addPendingDamage([new HitDamage(Math.min(damage, player.getHitpoints()), HitMask.RED)]);
    CombatFactory.poisonEntity(player, 6, 2);
  }

  /** Up to four tiles straight away from Zulrah, stopping at anything in the way. */
  knockbackTile(player) {
    const { RegionManager } = Shared.core();
    const centre = centreOf(this.zulrah);
    const here = player.getLocation();
    const dx = here.getX() - centre.x;
    const dy = here.getY() - centre.y;
    const length = Math.hypot(dx, dy) || 1;
    let at = here.clone();
    for (let step = 1; step <= TAIL.knockback; step++) {
      const x = Math.round(here.getX() + (dx / length) * step);
      const y = Math.round(here.getY() + (dy / length) * step);
      if (x === at.getX() && y === at.getY()) continue;
      if (!RegionManager.canMove(at.getX(), at.getY(), x, y, 0, 1, 1, this.area)) break;
      at = Shared.loc({ x, y });
    }
    return at;
  }

  /** The force-movement direction (0 north, 1 east, 2 south, 3 west) facing Zulrah. */
  facingZulrah(here) {
    const centre = centreOf(this.zulrah);
    const dx = centre.x - here.getX();
    const dy = centre.y - here.getY();
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 1 : 3;
    return dy >= 0 ? 0 : 2;
  }

  // ---------------------------------------------------------------- diving

  dive() {
    const { Animation } = Shared.core();
    const npc = this.zulrah;
    this.interactAt = Infinity;
    this.surfaced = false;
    npc.performAnimation(new Animation(ANIM.DIVE));
    // It cannot be attacked under the swamp: whoever is attacking it stops.
    if (this.player.getCombat().getTarget() === npc) this.player.getCombat().reset();
    return DIVE_TICKS;
  }

  /** Under the swamp: to its next place, in its next form. */
  resurface(phase) {
    const npc = this.zulrah;
    npc.moveTo(Shared.loc(Shared.POSITION[phase.at].spawn));
    npc.setNpcTransformationId(FORM_ID[phase.form] === Shared.NPC.GREEN ? -1 : FORM_ID[phase.form]);
    return RESURFACE_TICKS;
  }

  /** Back in view the tick after its teleport: it rises, facing the player. */
  surface() {
    const { Animation } = Shared.core();
    this.zulrah.performAnimation(new Animation(ANIM.RISE));
    this.surfaced = true;
    this.facePlayer();
    this.interactAt = this.ticks + RISE_TO_ACT_TICKS;
    return RISE_TO_ACT_TICKS;
  }

  form() {
    const id = this.zulrah?.getId();
    return Object.keys(FORM_ID).find((form) => FORM_ID[form] === id) ?? null;
  }

  // ---------------------------------------------------------------- the end

  /** Zulrah is dead: its snakelings and clouds go with it (Wiki). */
  onZulrahDeath() {
    this.hazards.clearOnDeath();
    this.stage = "won";
  }

  /** The kill's ticks, from Zulrah rising to its death. */
  duration() {
    return this.ticks - this.startedAt;
  }

  end({ fromArea = false } = {}) {
    if (this.stage === "ended") return;
    this.stage = "ended";
    this.task?.stop?.();
    fights.delete(this.player);
    this.hazards.remove();
    if (this.zulrah && this.zulrah.isRegistered?.()) Shared.api().removeNpc(this.zulrah);
    if (this.teleport) Shared.core().ObjectManager.deregister(this.teleport, true);
    if (!fromArea && this.player.getArea?.() === this.area) this.area.leave(this.player, false);
    if (!this.area.isDestroyed()) this.area.destroy();
  }
}

function fightOf(player) {
  return fights.get(player) ?? null;
}

function start(player, options) {
  fightOf(player)?.end();
  const fight = new ZulrahFight(player, options);
  fight.enter();
  return fight;
}

module.exports = { ZulrahFight, fightOf, start, idleMethod, TAIL, PROJECTILE, ANIM, MAX_HIT, FORM_ID };
