"use strict";

/**
 * One player's fight with Zulrah at its shrine.
 *
 * Wiki ("Zulrah", "Zulrah/Strategies"):
 * - Zulrah rises once the player continues the boat dialogue or does anything else.
 * - It attacks every 3 ticks, up to 41: green form with Ranged, blue form with Magic and
 *   sometimes Ranged (Magic much more often), and the "Jad" phase alternating the two. Damage is
 *   rolled as the attack starts, and an attack that lands envenoms even through prayer. The Wiki
 *   adds that after 3 minutes the green form may switch unpredictably between the two; rsprox
 *   3276's two green phases past 3 minutes are all Ranged (10 of 10), so that is not modelled.
 * - The red form stares at the player's tile, then whips its tail there: 20-30 typeless damage
 *   and a stun, avoided by moving two tiles away. It does this twice.
 * - Between phases it dives and resurfaces, maybe in another form and place; it cannot be
 *   attacked while under.
 * rsprox 820/1161/3276/1157/3342 (77 fights) give the animations, the timings below, the
 * projectiles, the tail's ticks and knock-back, and the blue form's Ranged share (41 of 121
 * attacks; Near-Reality's 3 in 10 is kept). The tail's safe tiles are still Near-Reality's.
 */

const Shared = require("./Shared.Zulrah");
const CombatAchievements = require("./CombatAchievements.Zulrah");
const { PhaseCursor } = require("./Rotations.Zulrah");
const { Hazards, envenom } = require("./Hazards.Zulrah");

const MAX_HIT = 41;
const STEP_TICKS = 3;
/** rsprox: the first barrage 11 ticks after Zulrah first rises (75 of 77 fights; 13 in the others). */
const FIRST_STEP_TICKS = 11;
/** rsprox: the player's first attack lands 4 ticks after any rise, never sooner. */
const INTERACT_AFTER_RISE = 4;
/** rsprox: it resurfaces (moved, changed and rising, in one tick) 3 ticks after diving. */
const DIVE_TICKS = 3;
/** rsprox: then its next phase starts 3 ticks after rising (84 of 84 dives). */
const RISE_TO_ACT_TICKS = 3;
/** rsprox: hits already on their way when it dives land together 6 ticks after (63 of 63). */
const DIVE_HOLDS_HITS_TICKS = 6;
/** rsprox: a run of barrages or orbs takes a tick more before an attack or the dive. */
const SPIT_RUN_EXTRA_TICKS = 1;
const BLUE_RANGED_CHANCE = 0.3;
const FORM_ID = { green: Shared.NPC.GREEN, red: Shared.NPC.RED, blue: Shared.NPC.BLUE };
/** rsprox: the knock-back's exact move faces west (512), the way the player is thrown. */
const KNOCKBACK_FACING_WEST = 3;

const ANIM = { ATTACK: 5069, SPAWN: 5071, DIVE: 5072, RISE: 5073, TAIL_LEFT: 5806, TAIL_RIGHT: 5807, KNOCKBACK: 1157 };
/**
 * rsprox (map_projanim_v2, 1,045 of Zulrah's): every flight starts and ends on fixed client
 * cycles whatever the distance, at slope 0 from the start of its tile. Heights are the packet's
 * (rsprox prints them four times over: 370, 50 and 20). A barrage's second cloud is thrown 5
 * cycles after the first, at slope 10. Clouds are aimed at the cloud's south-west tile.
 */
const PROJECTILE = {
  ranged: { id: 1044, start: 40, end: 90, from: 92, to: 12, angle: 0 },
  magic: { id: 1046, start: 40, end: 90, from: 92, to: 12, angle: 0 },
  clouds: [{ id: 1045, start: 40, end: 90, from: 92, to: 5, angle: 0 }, { id: 1045, start: 45, end: 120, from: 92, to: 5, angle: 10 }],
  snakeling: { id: 1047, start: 40, end: 120, from: 92, to: 5, angle: 0 },
};

/**
 * rsprox (19 tail phases): the swings' animations 7 ticks apart (8 in 2), each striking 5 ticks
 * after it (the second 5 or 6; sound 2720 on the tile), and the dive or next step 8 ticks after
 * the second (9 in 5). Four recorded hits threw the player west, 2 tiles after anim 5806 and 1
 * after 5807, wherever they stood.
 */
const TAIL = {
  aimAt: [0, 7],
  strikeAt: [5, 12],
  endsAt: 15,
  damage: [20, 30],
  stunSeconds: 3,
  knockback: { [ANIM.TAIL_LEFT]: 2, [ANIM.TAIL_RIGHT]: 1 },
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
    if (this.surfaced && !this.facingTile) this.facePlayer();
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
    }
    const spit = (step) => step?.[0] === "clouds" || step?.[0] === "snakeling";
    phase.steps.forEach((step, index) => {
      this.actions.push(...this.expand(step));
      const next = phase.steps[index + 1];
      if (spit(step) && !spit(next) && next?.[0] !== "wait") this.actions.push(() => SPIT_RUN_EXTRA_TICKS);
    });
  }

  expand([kind, ...args]) {
    if (kind === "ranged") {
      return Array.from({ length: args[0] }, () => () => this.attack("ranged"));
    }
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
    if (kind === "wait") return [() => args[0]];
    throw new Error(`unknown Zulrah step ${kind}`);
  }

  // ---------------------------------------------------------------- attacks

  fire(projectile, to) {
    const { Projectile } = Shared.core();
    const npc = this.zulrah;
    const { id, start, end, from: high, to: low, angle } = projectile;
    const shot = to.getLocation
      ? Projectile.createProjectile(npc, to, id, start, end, high, low)
      : new Projectile(Projectile.centreOf(npc), to, null, id, start, end, high, low, this.area);
    shot.withAngle?.(angle);
    shot.withProgress?.(0);
    shot.sendProjectile();
    this.lastFlight = end;
    return Math.max(1, Math.ceil(end / 30));
  }

  /** One Ranged or Magic attack, rolled (with the player's prayer) as it starts. */
  attack(style) {
    const { Animation, CombatFactory, PendingHit, RegionManager } = Shared.core();
    const npc = this.zulrah;
    const player = this.player;
    this.facingTile = false;
    this.facePlayer();
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
   * Zulrah faces the player while it is up, except that it turns to the tile it spits a cloud or
   * orb at, or whips its tail toward, until its next attack (rsprox: a face-angle with the face
   * on the player cleared, then the player again when it next attacks).
   */
  facePlayer() {
    if (this.zulrah?.getInteractingMobile?.() !== this.player) this.zulrah?.setMobileInteraction?.(this.player);
  }

  faceTile(tile) {
    const npc = this.zulrah;
    this.facingTile = true;
    npc?.setMobileInteraction?.(null);
    npc?.setPositionToFace?.(Shared.loc(tile));
  }

  spitClouds([x1, y1, x2, y2]) {
    const { Animation } = Shared.core();
    const tiles = [{ x: x1, y: y1 }, { x: x2, y: y2 }];
    this.faceTile(tiles[0]);
    this.zulrah.performAnimation(new Animation(ANIM.ATTACK));
    Shared.sound(this.player, Shared.SOUND.CLOUD_SPIT);
    tiles.forEach((tile, index) => {
      // rsprox: aimed at the south-west tile of the 3x3 cloud, where its loc goes.
      const ticks = this.fire(PROJECTILE.clouds[index], Shared.loc({ x: tile.x - 1, y: tile.y - 1 }));
      Shared.later(this, ticks, () => {
        if (this.stage === "fight" && this.zulrah?.getHitpoints() > 0) this.hazards.addCloud(tile);
      });
    });
    return STEP_TICKS;
  }

  spitSnakeling([x, y]) {
    const { Animation } = Shared.core();
    const tile = { x, y };
    this.faceTile(tile);
    this.zulrah.performAnimation(new Animation(ANIM.ATTACK));
    Shared.sound(this.player, Shared.SOUND.SNAKELING_SPIT);
    const ticks = this.fire(PROJECTILE.snakeling, Shared.loc(tile));
    Shared.later(this, ticks, () => {
      if (this.stage === "fight" && this.zulrah?.getHitpoints() > 0) this.hazards.addSnakeling(tile);
    });
    return STEP_TICKS;
  }

  // ---------------------------------------------------------------- the tail

  /** Two swings 7 ticks apart: aim at the player's tile, strike it 5 ticks later. */
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
    this.faceTile({ x, y });
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
    this.tailAnim = anim ?? ANIM.TAIL_RIGHT;
  }

  strikeTail(first = false) {
    const { RegionManager } = Shared.core();
    const player = this.player;
    const here = player.getLocation();
    const target = this.tailTarget;
    if (!target || player.getHitpoints() <= 0) return;
    Shared.sound(player, Shared.SOUND.TAIL_STRIKE);
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
      const direction = KNOCKBACK_FACING_WEST;
      TaskManager.submit(new ForceMovementTask(player, 1, new ForceMovement(here.clone(), offset, 0, 30, direction, -1)));
    }
    player.performAnimation(new Animation(ANIM.KNOCKBACK));
    player.setMobileInteraction?.(this.zulrah);
    CombatFactory.stun(player, TAIL.stunSeconds, true);
    player.sendMessage("You're stunned!");
    const damage = Math.min(Shared.randomInt(this.random, ...TAIL.damage), player.getHitpoints());
    player.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, HitMask.RED)]);
    CombatAchievements.avoidableDamage(this, damage);
    CombatFactory.poisonEntity(player, 6, 2);
  }

  /** West, 2 tiles after anim 5806 or 1 after 5807 (rsprox), stopping at anything in the way. */
  knockbackTile(player) {
    const { RegionManager } = Shared.core();
    const here = player.getLocation();
    const tiles = TAIL.knockback[this.tailAnim] ?? 1;
    let at = here.clone();
    for (let step = 1; step <= tiles; step++) {
      const x = here.getX() - step;
      const y = here.getY();
      if (!RegionManager.canMove(at.getX(), at.getY(), x, y, 0, 1, 1, this.area)) break;
      at = Shared.loc({ x, y });
    }
    return at;
  }

  // ---------------------------------------------------------------- diving

  dive() {
    const { Animation } = Shared.core();
    const npc = this.zulrah;
    this.interactAt = Infinity;
    this.surfaced = false;
    npc.performAnimation(new Animation(ANIM.DIVE));
    npc.setMobileInteraction?.(null);
    // It cannot be attacked under the swamp: whoever is attacking it stops, and what is already
    // on its way lands together once it is back up (rsprox; the Wiki: "shortly after it resurfaces").
    if (this.player.getCombat().getTarget() === npc) this.player.getCombat().reset();
    npc.getCombat().getHitQueue?.().holdIncomingFor?.(DIVE_HOLDS_HITS_TICKS);
    return DIVE_TICKS;
  }

  /**
   * To its next place, in its next form, rising, all in one tick: rsprox sends the move with the
   * jump flag and anim 5073 together, so it is a telejump, not a teleport out of view.
   */
  resurface(phase) {
    const { Animation } = Shared.core();
    const npc = this.zulrah;
    const to = Shared.loc(Shared.POSITION[phase.at].spawn);
    if (npc.telejump) npc.telejump(to);
    else npc.moveTo(to);
    npc.setNpcTransformationId(FORM_ID[phase.form] === Shared.NPC.GREEN ? -1 : FORM_ID[phase.form]);
    npc.performAnimation(new Animation(ANIM.RISE));
    Shared.sound(this.player, Shared.SOUND.RISE);
    this.surfaced = true;
    this.facingTile = false;
    this.facePlayer();
    this.interactAt = this.ticks + INTERACT_AFTER_RISE;
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
