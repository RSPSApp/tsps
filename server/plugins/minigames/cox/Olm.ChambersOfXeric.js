"use strict";

/**
 * The Great Olm: past the mystical barrier the Olm rises from one side of its chamber, head
 * and two claws, with a power (acid, flame or crystal). Disabling both claws sends it under
 * and up on the other side with a new power; in its last phase the claws must fall together,
 * then the head makes a final stand. Its death opens the way to the ancient chest.
 *
 * Wiki (Great Olm):
 * - Basic attacks: magic orbs and ranged crystals, the same damage; prayer takes off ~75-80%.
 *   1 in 5 chance to switch style after each attack.
 * - Spheres (red / green / purple): half the target's hitpoints unless praying melee / ranged /
 *   magic; praying anything when it's launched turns prayers off and halves Prayer.
 * - Phase attacks, 1 in 3 instead of a standard attack (1 in 2 in the last phase), avoiding
 *   those already used this phase. Acid: Acid Spray (pools: 3-6 a tick, poison from 2) and Acid
 *   Drip. Flame: Deep Burn (5 every few ticks and -2 to stats, six times, spreading to those
 *   beside) and Fire Wall (8-10 leaping out; 50-65 if still between the walls after 5 seconds;
 *   water spells, ice spells, Humidify or a watering can douse it). Crystal: Falling Crystals
 *   (11 crystals, 15-20, on one player's tile) and Crystal Bombs (two, three in big groups; a
 *   4-tile radius, 15 at the edge and 15 more each tile closer).
 * - Claw specials, on the left claw: Crystal Burst (a crystal under everyone, then shunting
 *   whoever stays for heavy damage), Lightning (zaps, turns off overheads, binds) and Swap
 *   (pairs swap places, 5 a tile apart).
 * - The rotation: standard, empty, standard, Crystal Burst, standard, empty, standard,
 *   Lightning, standard, empty, standard, Swap; a skipped standard attack is caught up on the
 *   next step; specials are never caught up. It attacks the zone (south, middle, north) with
 *   most players, turning its head (and skipping a step) when its zone is empty.
 * - Before the last phase the head heals whatever is done to it. The left claw clenches when
 *   hit for at least 1/20 of its health at once. Phases: at least four, one more per 8 raiders.
 *   In the last claw phase the left claw sometimes heals from damage (the infinity sign) and
 *   both claws must fall close together or they come back.
 * - Mitigation (Wiki's DPS calculator): the head takes a third from Magic; the left (melee) claw
 *   a third from Magic and Ranged; the right (mage) claw a third from Ranged.
 * - Transition and final-stand falling crystals: 16-25 under, 10-16 beside.
 * - Life Siphon (last phase): two safe tiles; everyone else takes moderate damage and the Olm
 *   heals five times the total.
 * rsprox captures (recordings 820, 843, 3282, 3285, 3389):
 * - It rises 7 ticks after the first raider passes the barrier: "The Great Olm rises with the
 *   power of <col=00ff00>acid</col>." (flame ff0000, crystal ff00ff; none in the last phase)
 *   with the rising locs; their animations (7335, 7350, 7354) and sound 3405 a tick later; the
 *   risen head and claws 6 ticks in, and its first attack the tick after.
 * - Its head's projectiles leave 32 client cycles in, from height 340-360 to 160, angle 5,
 *   progress 0: magic 1339 (sound 3749), ranged 1340, spheres 1341 / 1343 / 1345 (sound
 *   1784), acid 1354 (sound 1784), the burn 1349 (sound 585), the fire walls 1347 (sound 3750).
 * - A claw falling: 7352 / 7370, its cave loc 2 ticks later, gone at 3. With the right claw
 *   down the left grips (7363, then the gripping set). The last claw down: the head falls
 *   (7348) 4 ticks later, its cave loc at 6, and it rises on the other side 38 ticks after
 *   the claw fell.
 * - Messages: "The Great Olm had no one to pair you with! The magical power will enact
 *   soon...", "Yourself and <name> have swapped places!", "The teleport attack has no
 *   effect!", "The falling crystal shatters into you.", "The Great Olm infects you with a
 *   burning overwhelming power.", "The Great Olm prepares to absorb energy from anyone
 *   unprotected...", "The Great Olm's left claw clenches to protect itself temporarily."; the
 *   burnt say "Burn with me!", "I will burn with you." and "It burns like an inferno!".
 * Not on the Wiki (to check against a capture): the chamber's tiles; attacks every 4 ticks;
 *   the transition's crystals; acid pools lasting 16 ticks; crystal clusters bursting 3 ticks
 *   after appearing for 10-40; lightning running 18 ticks for 15-25 and a 5-second bind; Swap
 *   waiting 8 ticks; deep burn every 7 ticks; the clench lasting 45 ticks; a fallen claw in the
 *   last phase rising again after 34 ticks; Life Siphon 1 in 16 in the final stand.
 * Not like OSRS: dousing a fire wall is its Douse option with a watering can or a water or ice
 *   spell set to autocast (casting spells on NPCs has no hook here).
 */

const Shared = require("./CoxShared");
const Raid = require("./CoxRaid");
const Monsters = require("./CoxMonsters");

const NPC = { HEAD: 7554, RIGHT_CLAW: 7553, LEFT_CLAW: 7555, FIRE: 7558 };
const OBJECT = {
  HOLE_RISING: 29880, HOLE_RISEN: 29881, HOLE: 29882, LEFT_RISING: 29883, LEFT_RISEN: 29884, LEFT_GONE: 29885,
  RIGHT_RISING: 29886, RIGHT_RISEN: 29887, RIGHT_GONE: 29888, BARRIER: 29879, ACID: 30032, CLUSTER: 30033,
  CLUSTER_GROWN: 30034, BOMB: 29766, EXIT_CRYSTAL: 30018, CHEST_CRYSTAL: 30027, CHEST: 30028,
};
const SIDE = { LEFT: 0, RIGHT: 1 };
const ZONE = { SOUTH: 0, MIDDLE: 1, NORTH: 2, ALL: 3 };
const POWER = { ACID: 0, FLAME: 1, CRYSTAL: 2 };
const POWER_NAMES = ["<col=00ff00>acid", "<col=ff0000>flame", "<col=ff00ff>crystal"];
/** Ticks: the barrier to rising, rising to risen, the last claw down to the next rise. */
const TIMING = { RISE_AFTER_BARRIER: 7, RISE_ANIM: 1, RISEN: 6, FIRST_ATTACK: 1, HEAD_FALL: 4, HEAD_GONE: 6, NEXT_RISE: 38, CLAW_CAVE: 2 };
/** [normal, final phase] animations. */
const ANIM = {
  HEAD_RISE: [7335, 7383], HEAD_FALL: [7348, 7348], HEAD_MIDDLE: [7336, 7374], HEAD_LEFT: [7338, 7375], HEAD_RIGHT: [7337, 7376],
  MIDDLE_TO_LEFT: [7341, 7377], LEFT_TO_MIDDLE: [7342, 7378], MIDDLE_TO_RIGHT: [7339, 7381], RIGHT_TO_MIDDLE: [7340, 7382],
  LEFT_TO_RIGHT: [7343, 7379], RIGHT_TO_LEFT: [7344, 7380], ATTACK_MIDDLE: [7345, 7371], ATTACK_LEFT: [7347, 7372], ATTACK_RIGHT: [7346, 7373],
  RIGHT_CLAW_RISE: 7350, RIGHT_CLAW_DEFAULT: 7351, RIGHT_CLAW_FALL: 7352, RIGHT_CLAW_INVISIBLE: 7349,
  LEFT_CLAW_RISE: 7354, LEFT_CLAW_DEFAULT: [7355, 7365], LEFT_CLAW_FALL: 7370, LEFT_CLAW_INVISIBLE: 7353,
  LEFT_CLAW_CRYSTAL: [7356, 7366], LEFT_CLAW_LIGHTNING: [7358, 7368], LEFT_CLAW_SWIRL: [7359, 7369], LEFT_CLAW_INFINITY: 7357,
  LEFT_CLAW_CLENCH: 7360, LEFT_CLAW_TWITCHING: 7361, LEFT_CLAW_UNCLENCH: 7362,
};
const SEQUENCE = ["auto", "skip", "auto", "burst", "auto", "skip", "auto", "lightning", "auto", "skip", "auto", "swap"];
const LAST_SEQUENCE = [...SEQUENCE, "auto", "skip", "auto", "protect"];
const SPECIALS = new Set(["burst", "lightning", "swap", "protect"]);
/** rsprox captures: spheres land 180 client cycles in; bombs go off 11 ticks after the throw. */
const SPHERE_END = 180;
const BOMB_FUSE = 11;
const BASE_MAX = 27;
const WATERING_CANS = [5333, 5334, 5335, 5336, 5337, 5338, 5339, 5340];
const WATER_OR_ICE = /water|ice (rush|burst|blitz|barrage)/i;

/** Cache tiles. */
const T = {
  LEFT_CORNER: [3227, 5730], RIGHT_CORNER: [3237, 5748], SEPARATING_Y: 5740, SOUTH_MIDDLE_Y: 5734, NORTH_MIDDLE_Y: 5746,
  LEFT_HEAD_FACE: [3227, 5740], RIGHT_HEAD_FACE: [3238, 5740], FIRE_WEST_X: 3228, FIRE_EAST_X: 3237, FIRE_SOUTH_Y: 5731, FIRE_NORTH_Y: 5748,
  LIGHTNING_LOW: [3228, 5731], LIGHTNING_HIGH: [3228, 5748], EXIT_CRYSTAL: [3232, 5749], CHEST: [3233, 5751], BARRIER_Y: 5729,
  SIDES: [
    { head: [3220, 5738, 3], leftClaw: [3220, 5743, 3], rightClaw: [3220, 5733, 3], npcOffset: 3, headShift: -1 },
    { head: [3238, 5738, 1], leftClaw: [3238, 5733, 1], rightClaw: [3238, 5743, 1], npcOffset: 0, headShift: 1 },
  ],
};

class OlmRoom extends Raid.Room {
  constructor(raid, record) {
    super(raid, record);
    this.side = Shared.random(0, 1);
    this.phase = 1;
    this.power = -1;
    this.pools = new Map();
    this.objects = {};
    this.risen = false;
    this.direction = ZONE.MIDDLE;
    this.counter = 0;
    this.skippedBasic = false;
    this.ranging = false;
    this.usedThisPhase = new Set();
    this.busy = new Set();
    this.cycleScriptAt = 0;
    this.attackWait = 0;
  }

  t(x, y) {
    return this.map.olmTile(x, y, 0);
  }

  load() {
    this.pointsCap = Number.MAX_SAFE_INTEGER;
    this.totalPhases = 3 + Math.floor(this.raid.scale / 8);
    this.low = this.t(...T.LEFT_CORNER);
    this.high = this.t(...T.RIGHT_CORNER);
    this.offsetY = this.low.getY() - T.LEFT_CORNER[1];
    this.offsetX = this.low.getX() - T.LEFT_CORNER[0];
  }

  combatPoints() {
    return Number.MAX_SAFE_INTEGER;
  }

  y(cacheY) {
    return cacheY + this.offsetY;
  }

  x(cacheX) {
    return cacheX + this.offsetX;
  }

  inChamber(location) {
    const x = location.getX();
    const y = location.getY();
    return x >= this.low.getX() && x <= this.high.getX() && y >= this.low.getY() && y <= this.high.getY();
  }

  inZone(location, zone) {
    if (!this.inChamber(location)) return false;
    const y = location.getY();
    if (zone === ZONE.SOUTH) return y <= this.y(T.SEPARATING_Y);
    if (zone === ZONE.NORTH) return y >= this.y(T.SEPARATING_Y);
    if (zone === ZONE.MIDDLE) return y > this.y(T.SOUTH_MIDDLE_Y) && y < this.y(T.NORTH_MIDDLE_Y);
    return true;
  }

  raiders() {
    return [...this.raid.players].filter((player) => player.getHitpoints() > 0 && this.inChamber(player.getLocation()));
  }

  /** Everyone near enough to see the chamber's animations. */
  viewers() {
    return [...this.raid.players].filter((player) => this.map.inOlmChamber(player.getLocation()));
  }

  everyone(zone) {
    return this.raiders().filter((player) => this.inZone(player.getLocation(), zone));
  }

  randomTile(zone) {
    const { Location, RegionManager } = Shared.core();
    for (let tries = 0; tries < 50; tries++) {
      const tile = new Location(Shared.random(this.low.getX(), this.high.getX()), Shared.random(this.low.getY(), this.high.getY()), 0);
      if (!RegionManager.blocked(tile, this.map) && this.inZone(tile, zone)) return tile;
    }
    return null;
  }

  // ---------------------------------------------------------------- objects and animations

  animate(object, anim) {
    if (!object) return;
    const { Animation } = Shared.core();
    // The head's pairs are [normal, last phase]; the left claw's [normal, gripping without the right].
    const second = object === this.objects.leftClaw ? this.rightGone === true : this.isLastPhase();
    const id = Array.isArray(anim) ? anim[second ? 1 : 0] : anim;
    for (const player of this.viewers()) player.getPacketSender().sendObjectAnimation(object, new Animation(id));
  }

  placeObject(key, id, [x, y, face]) {
    const { GameObject, ObjectManager } = Shared.core();
    const previous = this.objects[key];
    const object = new GameObject(id, this.t(x, y), 10, face, this.map);
    if (previous) ObjectManager.deregister(previous, true);
    ObjectManager.register(object, true);
    this.objects[key] = object;
    return object;
  }

  isLastPhase() {
    return this.phase >= this.totalPhases;
  }

  finalStand() {
    return this.isLastPhase() && !this.leftClaw && !this.rightClaw;
  }

  // ---------------------------------------------------------------- the barrier and rising

  passBarrier(player, barrier, confirm) {
    const inside = player.getLocation().getY() > barrier.getLocation().getY();
    if (inside && !this.raid.completed) {
      Shared.statement(player, "A strange magic prevents you from passing through.<br><br>There's no way back now.");
      return;
    }
    const pass = () => {
      if (!this.raid.completed) player.sendMessage("As you pass through the barrier, a sense of dread washes over you.");
      const { Location } = Shared.core();
      const at = player.getLocation();
      Shared.balanceWalk(player, new Location(at.getX(), at.getY() + (inside ? -2 : 2), at.getZ()), -1, null);
      if (!this.risen && !this.raid.completed) {
        this.risen = true;
        Shared.later(this.raid, TIMING.RISE_AFTER_BARRIER, () => this.rise());
      }
    };
    if (!confirm || this.raid.completed) {
      pass();
      return;
    }
    Shared.statement(player, "You sense that strange magic will prevent you from coming back through. Make sure you are prepared for what is ahead.");
    Shared.later(player, 1, () => Shared.options(player, "Go through?", "Yes", pass, "No", () => {}));
  }

  rise() {
    if (this.raid.destroyed) return;
    this.risen = true;
    this.rightGone = false;
    const side = T.SIDES[this.side];
    this.power = Shared.randomOf([POWER.ACID, POWER.FLAME, POWER.CRYSTAL].filter((power) => power !== this.power));
    if (!this.isLastPhase()) {
      for (const player of this.raiders()) player.sendMessage(`The Great Olm rises with the power of ${POWER_NAMES[this.power]}</col>.`);
    }
    this.placeObject("head", OBJECT.HOLE_RISING, side.head);
    this.placeObject("leftClaw", OBJECT.LEFT_RISING, side.leftClaw);
    this.placeObject("rightClaw", OBJECT.RIGHT_RISING, side.rightClaw);
    Shared.later(this.raid, TIMING.RISE_ANIM, () => {
      if (this.raid.destroyed) return;
      const { Location } = Shared.core();
      const at = this.objects.head.getLocation();
      Shared.areaSound(this.viewers(), 3405, new Location(at.getX() + 5, at.getY() + 2, 0), { delay: 15, range: 15 });
      this.animate(this.objects.head, ANIM.HEAD_RISE);
      this.animate(this.objects.leftClaw, ANIM.LEFT_CLAW_RISE);
      this.animate(this.objects.rightClaw, ANIM.RIGHT_CLAW_RISE);
    });
    Shared.later(this.raid, TIMING.RISEN, () => this.risenUp());
  }

  risenUp() {
    if (this.raid.destroyed) return;
    const side = T.SIDES[this.side];
    const { Location } = Shared.core();
    const head = this.placeObject("head", OBJECT.HOLE_RISEN, side.head);
    const leftObject = this.placeObject("leftClaw", OBJECT.LEFT_RISEN, side.leftClaw);
    const rightObject = this.placeObject("rightClaw", OBJECT.RIGHT_RISEN, side.rightClaw);
    const at = (object, shift = 0) => new Location(object.getLocation().getX() + side.npcOffset + shift, object.getLocation().getY(), 0);
    this.head = this.spawnPart(NPC.HEAD, at(head, side.headShift));
    this.leftClaw = this.spawnPart(NPC.LEFT_CLAW, at(leftObject));
    this.rightClaw = this.spawnPart(NPC.RIGHT_CLAW, at(rightObject));
    if (this.head) this.head.__coxPointsMultiplier = 0;
    this.usedThisPhase.clear();
    this.counter = 0;
    this.attackWait = TIMING.FIRST_ATTACK;
    this.direction = ZONE.MIDDLE;
    this.animate(this.objects.head, ANIM.HEAD_MIDDLE);
    this.animate(this.objects.leftClaw, ANIM.LEFT_CLAW_DEFAULT);
    this.animate(this.objects.rightClaw, ANIM.RIGHT_CLAW_DEFAULT);
  }

  spawnPart(id, location) {
    const npc = this.spawnNpc(id, location);
    if (!npc) return null;
    npc.getMovementQueue().setBlockMovement?.(true);
    npc.__coxOlm = true;
    return npc;
  }

  // ---------------------------------------------------------------- every tick

  tick() {
    this.tickPools();
    this.tickClusters();
    if (!this.head?.isRegistered() || this.dead) return;
    // Wiki: before the final stand the head heals whatever is done to it.
    if (!this.finalStand() && this.head.getHitpoints() < this.head.getMaxHitpoints() && this.raid.ticks % 5 === 0) {
      this.head.setHitpoints(this.head.getMaxHitpoints());
    }
    this.tickClaws();
    if (this.transitioning) return;
    if (--this.attackWait > 0) return;
    this.attackWait = 4;
    if (this.raiders().length === 0) return;
    this.attack();
  }

  tickClaws() {
    const left = this.leftClaw;
    if (!left?.isRegistered()) return;
    if (left.__coxClench > 0 && --left.__coxClench === 0) {
      left.__coxClenched = false;
      this.animate(this.objects.leftClaw, this.isLastPhase() ? ANIM.LEFT_CLAW_DEFAULT : ANIM.LEFT_CLAW_UNCLENCH);
      if (!this.isLastPhase()) Shared.later(this.raid, 1, () => this.animate(this.objects.leftClaw, ANIM.LEFT_CLAW_DEFAULT));
    }
  }

  // ---------------------------------------------------------------- the head's attack rotation

  zoneWithMostPlayers() {
    let south = 0;
    let middle = 0;
    let north = 0;
    const separating = this.y(T.SEPARATING_Y);
    for (const player of this.raiders()) {
      const y = player.getLocation().getY();
      if (this.inZone(player.getLocation(), ZONE.MIDDLE)) middle++;
      if (y > separating) north++;
      if (y < separating) south++;
    }
    if (middle >= south && middle >= north) return ZONE.MIDDLE;
    return north >= south ? ZONE.NORTH : ZONE.SOUTH;
  }

  attack() {
    const sequence = this.isLastPhase() ? LAST_SEQUENCE : SEQUENCE;
    const step = sequence[this.counter];
    this.counter = (this.counter + 1) % sequence.length;
    const zoneEmpty = this.everyone(this.direction).length === 0;
    if (zoneEmpty || (step !== "auto" && !this.skippedBasic)) {
      if (step === "auto") this.skippedBasic = true;
      const wanted = this.zoneWithMostPlayers();
      if (wanted !== this.direction) {
        if (SPECIALS.has(step) && !zoneEmpty) {
          const caughtUp = this.skippedBasic;
          this.skippedBasic = false;
          this.special(step, caughtUp);
        }
        this.turnHead(wanted);
        return;
      }
      if (step === "skip") return;
    }
    const caughtUp = this.skippedBasic;
    this.skippedBasic = false;
    if (step === "auto") this.autoAttack();
    else this.special(step, caughtUp);
  }

  turnHead(zone) {
    const left = this.side === SIDE.LEFT;
    const from = this.direction;
    let anim;
    if (zone === ZONE.SOUTH) anim = from === ZONE.NORTH ? (left ? ANIM.LEFT_TO_RIGHT : ANIM.RIGHT_TO_LEFT) : (left ? ANIM.MIDDLE_TO_RIGHT : ANIM.MIDDLE_TO_LEFT);
    else if (zone === ZONE.MIDDLE) anim = from === ZONE.SOUTH ? (left ? ANIM.RIGHT_TO_MIDDLE : ANIM.LEFT_TO_MIDDLE) : (left ? ANIM.LEFT_TO_MIDDLE : ANIM.RIGHT_TO_MIDDLE);
    else anim = from === ZONE.SOUTH ? (left ? ANIM.RIGHT_TO_LEFT : ANIM.LEFT_TO_RIGHT) : (left ? ANIM.MIDDLE_TO_LEFT : ANIM.MIDDLE_TO_RIGHT);
    this.animate(this.objects.head, anim);
    this.direction = zone;
    Shared.later(this.raid, 1, () => this.animate(this.objects.head, this.restingAnim()));
  }

  restingAnim() {
    const left = this.side === SIDE.LEFT;
    if (this.direction === ZONE.MIDDLE) return ANIM.HEAD_MIDDLE;
    if (this.direction === ZONE.SOUTH) return left ? ANIM.HEAD_RIGHT : ANIM.HEAD_LEFT;
    return left ? ANIM.HEAD_LEFT : ANIM.HEAD_RIGHT;
  }

  headAttackAnim() {
    const left = this.side === SIDE.LEFT;
    const anim = this.direction === ZONE.MIDDLE ? ANIM.ATTACK_MIDDLE
      : this.direction === ZONE.SOUTH ? (left ? ANIM.ATTACK_RIGHT : ANIM.ATTACK_LEFT)
        : (left ? ANIM.ATTACK_LEFT : ANIM.ATTACK_RIGHT);
    this.animate(this.objects.head, anim);
    Shared.later(this.raid, 1, () => this.animate(this.objects.head, this.restingAnim()));
  }

  /** Where its attacks leave its mouth. */
  face() {
    const { Location } = Shared.core();
    const [x, y] = this.side === SIDE.LEFT ? T.LEFT_HEAD_FACE : T.RIGHT_HEAD_FACE;
    const shift = this.direction === ZONE.SOUTH ? -1 : this.direction === ZONE.NORTH ? 1 : 0;
    return new Location(this.x(x), this.y(y) + shift, 0);
  }

  /**
   * A shot from the head (rsprox captures): leaving 32 client cycles in from height 340-360 to
   * 160 (0 on a tile), angle 5, progress 0; `end` defaults to 26 + 5 a tile. Returns the ticks
   * until it lands.
   */
  headShot(to, id, end = null) {
    const { Projectile } = Shared.core();
    const from = this.face();
    const tile = to.getLocation ? to.getLocation() : to;
    const finish = end ?? 26 + 5 * from.getDistance(tile);
    new Projectile(from, tile, to.getLocation ? to : null, id, 32, finish, 88, to.getLocation ? 40 : 0, this.map)
      .withAngle(5)
      .withProgress(0)
      .sendProjectile();
    return Math.max(1, Math.floor(finish / 30));
  }

  /** A head sound: from the head's face, range 13-15, 10-12 client cycles in. */
  headSound(id, { delay = 12, range = 15 } = {}) {
    Shared.areaSound(this.viewers(), id, this.face(), { delay, range });
  }

  leftClawUnavailable() {
    return !this.leftClaw?.isRegistered() || this.leftClaw.__coxClenched || this.leftClaw.__coxDown;
  }

  autoAttack() {
    const roll = Math.random();
    if (this.lastAttack !== "sphere" && Shared.random(0, 19) === 0) return this.run("sphere", () => this.sphere());
    if (this.finalStand() && Shared.random(0, 15) === 0) return this.run("siphon", () => this.lifeSiphon());
    const chance = this.isLastPhase() ? 1 / 2 : 1 / 3;
    if (!this.usedCycleScript && this.raid.ticks >= this.cycleScriptAt && roll < chance) {
      this.usedCycleScript = true;
      this.cycleScriptAt = this.raid.ticks + 17;
      return this.phaseAttack();
    }
    return this.run("standard", () => this.standard());
  }

  run(name, action) {
    action();
    this.lastAttack = name;
  }

  special(step, caughtUp) {
    this.usedCycleScript = false;
    if (caughtUp) this.autoAttack();
    if (this.leftClawUnavailable()) return;
    if (step === "burst") this.crystalBurst();
    else if (step === "lightning") this.lightning();
    else if (step === "swap") this.swap();
    else if (step === "protect") this.protectLeftClaw();
  }

  /** Wiki: a phase attack not used yet this phase, if there is one. */
  phaseAttack() {
    const power = this.isLastPhase() ? Shared.random(0, 2) : this.power;
    const pairs = [["acidDrip", "acidSpray"], ["deepBurn", "fireWall"], ["fallingCrystals", "crystalBombs"]][power];
    const fresh = pairs.filter((name) => !this.usedThisPhase.has(name) && !this.busy.has(name));
    const name = fresh.length ? Shared.randomOf(fresh) : Shared.randomOf(pairs.filter((other) => !this.busy.has(other))) ?? pairs[1];
    this.usedThisPhase.add(name);
    this.run(name, () => this[name]());
  }

  // ---------------------------------------------------------------- standard attacks

  maxHit() {
    const base = this.finalStand() ? BASE_MAX + 2 : this.isLastPhase() ? BASE_MAX + 1 : BASE_MAX;
    return Monsters.maxHitFor(this.head, base, Monsters.LEVELS.MAGIC);
  }

  standard() {
    // Wiki (Mod Ash): 1 in 5 to switch style.
    if (Shared.random(0, 4) === 0) this.ranging = !this.ranging;
    const targets = this.everyone(this.direction);
    if (targets.length === 0) return;
    this.headAttackAnim();
    const ranged = this.ranging;
    const face = this.face();
    this.headSound(ranged ? 1784 : 3749, { range: ranged ? 15 : 13 });
    for (const player of targets) {
      const delay = this.headShot(player, ranged ? 1340 : 1339);
      Shared.strike(this.head, player, ranged ? "ranged" : "magic", this.maxHit(), delay, { prayerMultiplier: 0.2 });
    }
  }

  sphere() {
    const targets = Shared.shuffle(this.everyone(this.direction)).slice(0, 3);
    if (targets.length === 0) return;
    this.headAttackAnim();
    const face = this.face();
    const types = Shared.shuffle([0, 1, 2]);
    this.headSound(1784, { delay: 10 });
    const { PrayerHandler, Skill } = Shared.core();
    targets.forEach((player, index) => {
      const type = types[index];
      const styles = ["melee", "ranged", "magic"];
      const praying = styles.some((style) => Shared.isProtected(player, style));
      if (praying) {
        PrayerHandler.deactivatePrayers(player);
        const skills = player.getSkillManager();
        skills.setCurrentLevel(Skill.PRAYER, Math.floor(skills.getCurrentLevel(Skill.PRAYER) / 2), true);
      }
      const text = ["<col=ff3045>The Great Olm fires a sphere of aggression your way.</col>",
        "<col=229628>The Great Olm fires a sphere of accuracy and dexterity your way.</col>",
        "<col=3366ff>The Great Olm fires a sphere of magical power your way.</col>"][type];
      player.sendMessage(text + (praying ? " Your prayers have been sapped." : ""));
      const lands = this.headShot(player, [1345, 1343, 1341][type], SPHERE_END);
      Shared.later(this.raid, lands, () => {
        if (player.getHitpoints() <= 0) return;
        player.performGraphic(Shared.gfx([1346, 1344, 1342][type], { height: 96 }));
        if (!Shared.isProtected(player, styles[type])) Shared.damage(player, Math.min(99, Math.floor(player.getHitpoints() / 2)));
      });
    });
  }

  lifeSiphon() {
    const first = this.randomTile(this.direction);
    if (!first) return;
    let second = null;
    for (let tries = 0; tries < 20 && (!second || second.equals(first)); tries++) second = this.randomTile(this.direction);
    if (!second || second.equals(first)) return;
    this.headAttackAnim();
    for (const player of this.raiders()) player.sendMessage("The Great Olm prepares to absorb energy from anyone unprotected...");
    for (const tile of [first, second]) this.headShot(tile, 1355, 120);
    Shared.later(this.raid, 3, () => {
      Shared.graphicAt(this.viewers(), 1363, first);
      Shared.graphicAt(this.viewers(), 1363, second);
    });
    Shared.later(this.raid, 8, () => {
      if (!this.head?.isRegistered()) return;
      let total = 0;
      for (const player of this.raiders()) {
        if (player.getLocation().equals(first) || player.getLocation().equals(second)) continue;
        const damage = Shared.random(15, 25);
        total += damage;
        Shared.damage(player, damage);
      }
      if (total > 0) this.head.heal(total * 5);
    });
  }

  // ---------------------------------------------------------------- acid

  addPool(tile) {
    const key = `${tile.getX()},${tile.getY()}`;
    if (this.pools.has(key)) return;
    const { GameObject, ObjectManager } = Shared.core();
    const object = new GameObject(OBJECT.ACID, tile.clone(), 10, 0, this.map);
    ObjectManager.register(object, true);
    this.pools.set(key, { object, ticks: 16, tile: tile.clone() });
  }

  tickPools() {
    const { CombatFactory, ObjectManager } = Shared.core();
    for (const [key, pool] of this.pools) {
      if (--pool.ticks <= 0) {
        ObjectManager.deregister(pool.object, true);
        this.pools.delete(key);
      }
    }
    for (const player of this.raid.players) {
      if (player.__coxAcidUntil > this.raid.ticks && this.inChamber(player.getLocation())) this.addPool(player.getLocation());
    }
    if (this.pools.size === 0) return;
    for (const player of this.raiders()) {
      const pool = this.pools.get(`${player.getLocation().getX()},${player.getLocation().getY()}`);
      if (!pool || pool.ticks > 15) continue;
      Shared.damage(player, Shared.random(3, 6));
      CombatFactory.poisonEntity(player, 2);
    }
  }

  acidDrip() {
    const target = Shared.randomOf(this.everyone(this.direction));
    if (!target) return;
    this.busy.add("acidDrip");
    this.headAttackAnim();
    this.headSound(1784);
    const delay = this.headShot(target, 1354);
    Shared.later(this.raid, delay, () => {
      target.__coxAcidUntil = this.raid.ticks + 21;
      target.sendMessage("<col=ff0000>The Great Olm has smothered you in acid. It starts to drip off slowly.");
      this.addPool(target.getLocation());
    });
    Shared.later(this.raid, delay + 21, () => this.busy.delete("acidDrip"));
  }

  acidSpray() {
    this.headAttackAnim();
    this.headSound(1784);
    for (let count = Shared.random(7, 12), tries = 100; count > 0 && tries > 0; tries--) {
      const tile = this.randomTile(this.direction);
      if (!tile || this.pools.has(`${tile.getX()},${tile.getY()}`)) continue;
      count--;
      const delay = this.headShot(tile, 1354, 26 + 7 * this.face().getDistance(tile));
      Shared.later(this.raid, delay, () => {
        this.addPool(tile);
        Shared.areaSound(this.viewers(), 3308, tile, { range: 3 });
      });
    }
  }

  // ---------------------------------------------------------------- flame

  /** Wiki: 5 damage and -2 to two stats, six times, spreading to whoever stands beside. */
  deepBurn() {
    const target = Shared.randomOf(this.everyone(this.direction));
    if (!target) return;
    this.busy.add("deepBurn");
    this.headAttackAnim();
    this.headSound(585, { delay: 0, range: 13 });
    const burning = new Map([[target, 6]]);
    const delay = this.headShot(target, 1349);
    Shared.later(this.raid, delay, () => target.sendMessage("The Great Olm infects you with a burning overwhelming power."));
    const { Skill } = Shared.core();
    const skills = [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.RANGED, Skill.MAGIC];
    const burn = (player, text) => {
      player.forceChat(text);
      Shared.damage(player, 5);
      Shared.sound(player, 740);
      const manager = player.getSkillManager();
      for (let i = 0; i < 2; i++) {
        const skill = Shared.randomOf(skills);
        manager.setCurrentLevel(skill, Math.max(1, manager.getCurrentLevel(skill) - 2), true);
      }
    };
    Shared.later(this.raid, delay, () => {
      Shared.repeat(this.raid, 7, () => {
        if (this.raid.destroyed || this.dead) {
          for (const player of burning.keys()) player.sendMessage("You feel the deep burning inside dissipate.");
          this.busy.delete("deepBurn");
          return false;
        }
        const chamber = this.raiders();
        const next = new Map();
        for (const [player, left] of burning) {
          if (!chamber.includes(player)) continue;
          burn(player, "Burn with me!");
          if (left > 1) next.set(player, left - 1);
          else player.sendMessage("You feel the deep burning inside dissipate.");
          for (const other of chamber) {
            if (burning.has(other) || next.has(other) || other.getLocation().getDistance(player.getLocation()) > 1) continue;
            next.set(other, 6);
            burn(other, "I will burn with you.");
          }
        }
        burning.clear();
        for (const [player, left] of next) burning.set(player, left);
        if (burning.size === 0) {
          this.busy.delete("deepBurn");
          return false;
        }
        return true;
      });
    });
  }

  /** Wiki: two walls of fire either side of the target; 50-65 for those still between them. */
  fireWall() {
    const target = Shared.randomOf(this.everyone(this.direction));
    if (!target) return;
    this.headAttackAnim();
    const y = target.getLocation().getY();
    if (!(y > this.y(T.FIRE_SOUTH_Y) + 1 && y < this.y(T.FIRE_NORTH_Y) - 1)) return;
    this.busy.add("fireWall");
    const { Location } = Shared.core();
    const left = this.side === SIDE.LEFT;
    const fromX = this.x(left ? T.FIRE_EAST_X : T.FIRE_WEST_X);
    const step = left ? -1 : 1;
    const north = new Location(fromX, y + 1, 0);
    const south = new Location(fromX, y - 1, 0);
    const face = this.face();
    for (const tile of [north, south]) this.headShot(tile, 1347, 60);
    this.headSound(3750, { range: 13 });
    const fires = [];
    Shared.later(this.raid, 2, () => {
      if (this.dead || this.raid.destroyed) return;
      for (let i = 0; i < 10; i++) {
        for (const [wall, dy] of [[north, 1], [south, -1]]) {
          const tile = new Location(wall.getX() + step * i, wall.getY(), 0);
          if (!this.inChamber(tile)) continue;
          Shared.projectile(this.map, wall, tile, 1348, { delay: 0, duration: 30 - i * 3, startHeight: 10, endHeight: 10 });
          for (const player of this.raiders()) {
            if (!player.getLocation().equals(tile)) continue;
            Shared.damage(player, Shared.random(8, 10));
            player.sendMessage("You leap away from the flame, getting slightly scorched in the process.");
            Shared.animate(player, 1114);
            player.moveTo(new Location(tile.getX(), tile.getY() + dy, 0));
          }
          const fire = this.spawnNpc(NPC.FIRE, tile, { scale: false });
          if (fire) {
            fire.__coxFireWall = true;
            fires.push(fire);
          }
        }
      }
    });
    Shared.later(this.raid, 10, () => {
      for (const fire of fires) this.removeNpc(fire);
      for (const player of this.raiders()) {
        if (player.getLocation().getY() === y) Shared.damage(player, Shared.random(50, 65));
      }
      this.busy.delete("fireWall");
    });
  }

  douse(player, fire) {
    const can = WATERING_CANS.find((id) => Shared.has(player, id));
    const spell = player.getCombat().getAutocastSpell?.();
    const spellName = spell?.constructor?.name ?? "";
    const water = spell && WATER_OR_ICE.test(spell.name ?? spell.getName?.() ?? spellName);
    if (!can && !water) {
      player.sendMessage("Only water, ice spells or humidify can douse this flame!");
      return;
    }
    if (can) {
      const { Item } = Shared.core();
      const slot = player.getInventory().getItems().findIndex((item) => item?.getId() === can);
      player.getInventory().setItem(slot, new Item(can === 5333 ? 5331 : can - 1, 1)).refreshItems();
    }
    player.setPositionToFace(fire.getLocation());
    Shared.later(player, 1, () => {
      player.sendMessage("You douse the flame.");
      this.removeNpc(fire);
    });
  }

  // ---------------------------------------------------------------- crystal

  fallingCrystals() {
    const target = Shared.randomOf(this.everyone(this.direction));
    if (!target) return;
    this.busy.add("fallingCrystals");
    this.headSound(324);
    for (const player of this.raiders()) player.sendMessage("The Great Olm sounds a cry...");
    target.sendMessage("<col=ff0000>The Great Olm has chosen you as its target - watch out!</col>");
    this.headAttackAnim();
    let left = 11;
    const drop = () => {
      if (this.raid.destroyed || this.dead || left-- <= 0 || target.getHitpoints() <= 0 || !this.inChamber(target.getLocation())) {
        this.busy.delete("fallingCrystals");
        return false;
      }
      const tile = target.getLocation().clone();
      const { Projectile } = Shared.core();
      // rsprox captures: one every 2 ticks from high above, shattering 2 ticks later (gfx 1353).
      new Projectile(tile, tile, null, 1352, 0, 60, 250, 0, this.map).withAngle(10).withProgress(64).sendProjectile();
      Shared.later(this.raid, 2, () => {
        Shared.graphicAt(this.viewers(), 1353, tile, { height: 10 });
        Shared.areaSound(this.viewers(), 3821, tile, { range: 3 });
        for (const player of this.raiders()) {
          if (!player.getLocation().equals(tile)) continue;
          Shared.damage(player, Shared.random(15, 20));
          player.sendMessage("The falling crystal shatters into you.");
        }
      });
      return true;
    };
    Shared.later(this.raid, 2, () => drop() && Shared.repeat(this.raid, 2, drop));
  }

  /** Wiki: two bombs, three in big groups; 15 at 4 tiles, 15 more each tile closer. */
  crystalBombs() {
    this.busy.add("crystalBombs");
    this.headAttackAnim();
    const count = this.raid.scale >= 8 ? 3 : 2;
    const face = this.face();
    const bombs = [];
    for (let made = 0, tries = 0; made < count && tries < 50; tries++) {
      const tile = this.randomTile(ZONE.ALL);
      if (!tile || bombs.some((bomb) => bomb.getDistance(tile) <= 2)) continue;
      bombs.push(tile);
      made++;
    }
    this.headSound(1784);
    const { GameObject, ObjectManager } = Shared.core();
    const objects = [];
    // rsprox captures: each bomb sits where it lands; all explode 11 ticks after the throw.
    for (const tile of bombs) {
      const lands = this.headShot(tile, 1357, 26 + 7 * face.getDistance(tile));
      Shared.later(this.raid, lands, () => {
        const object = new GameObject(OBJECT.BOMB, tile, 10, 0, this.map);
        ObjectManager.register(object, true);
        objects.push(object);
      });
    }
    Shared.later(this.raid, BOMB_FUSE, () => {
      for (const object of objects) {
        Shared.graphicAt(this.viewers(), 40, object.getLocation(), { height: 40 });
        Shared.areaSound(this.viewers(), 1021, object.getLocation(), { range: 10 });
        ObjectManager.deregister(object, true);
      }
    });
    Shared.later(this.raid, BOMB_FUSE, () => {
      for (const tile of bombs) {
        for (const player of this.raiders()) {
          const distance = player.getLocation().getDistance(tile);
          if (distance <= 4) Shared.damage(player, 15 * (5 - distance));
        }
      }
      this.busy.delete("crystalBombs");
    });
  }

  // ---------------------------------------------------------------- claw specials

  leftSign(anim) {
    for (const player of this.viewers()) Shared.sound(player, 1551);
    this.animate(this.objects.leftClaw, anim);
    if (anim !== ANIM.LEFT_CLAW_INFINITY) Shared.later(this.raid, 3, () => this.animate(this.objects.leftClaw, ANIM.LEFT_CLAW_DEFAULT));
  }

  crystalBurst() {
    this.leftSign(ANIM.LEFT_CLAW_CRYSTAL);
    this.clusters ??= new Map();
    const { GameObject, ObjectManager } = Shared.core();
    for (const player of this.raiders()) {
      const tile = player.getLocation().clone();
      const key = `${tile.getX()},${tile.getY()}`;
      if (this.clusters.has(key)) continue;
      const object = new GameObject(OBJECT.CLUSTER, tile, 10, 0, this.map);
      ObjectManager.register(object, true);
      Shared.sound(player, 1551);
      this.clusters.set(key, { object, ticks: 6, tile });
    }
  }

  tickClusters() {
    if (!this.clusters?.size) return;
    const { Location, RegionManager, ObjectManager } = Shared.core();
    for (const [key, cluster] of this.clusters) {
      const tick = --cluster.ticks;
      if (tick === 3) {
        cluster.object = Shared.replaceObject(this.map, cluster.object, OBJECT.CLUSTER_GROWN);
        for (const player of this.raiders()) {
          Shared.sound(player, 3821);
          if (!player.getLocation().equals(cluster.tile)) continue;
          const around = [];
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              const tile = new Location(cluster.tile.getX() + dx, cluster.tile.getY() + dy, 0);
              if ((dx || dy) && !RegionManager.blocked(tile, this.map)) around.push(tile);
            }
          }
          Shared.damage(player, Shared.random(10, 40));
          player.sendMessage("The crystal beneath your feet grows rapidly and shunts you to the side.");
          Shared.animate(player, 1114);
          if (around.length) player.moveTo(Shared.randomOf(around));
        }
      } else if (tick <= 0) {
        Shared.graphicAt(this.viewers(), 1338, cluster.tile);
        ObjectManager.deregister(cluster.object, true);
        this.clusters.delete(key);
      }
    }
  }

  /** Bolts run north and south across the chamber for 18 ticks. */
  lightning() {
    this.leftSign(ANIM.LEFT_CLAW_LIGHTNING);
    const { Location, PrayerHandler } = Shared.core();
    const count = this.raiders().length >= 6 ? 5 : 4;
    const columns = Shared.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]).slice(0, count);
    const bolts = columns.map((column, index) => {
      const north = index % 2 === 0;
      const [x, y] = north ? T.LIGHTNING_LOW : T.LIGHTNING_HIGH;
      return { tile: new Location(this.x(x) + column, this.y(y), 0), north };
    });
    let ticks = 18;
    Shared.repeat(this.raid, 1, () => {
      if (this.raid.destroyed || --ticks <= 0) return false;
      for (const bolt of bolts) {
        Shared.graphicAt(this.viewers(), 1356, bolt.tile);
        for (const player of this.raiders()) {
          if (!player.getLocation().equals(bolt.tile)) continue;
          Shared.damage(player, Shared.random(15, 25));
          player.sendMessage("<col=ff0000>You've been electrocuted to the spot!</col>");
          for (const prayer of [PrayerHandler.PROTECT_FROM_MAGIC, PrayerHandler.PROTECT_FROM_MELEE, PrayerHandler.PROTECT_FROM_MISSILES]) {
            if (PrayerHandler.isActivated(player, prayer)) PrayerHandler.deactivatePrayer(player, prayer);
          }
          Shared.animate(player, 3170);
          Shared.core().CombatFactory.freeze(player, 5);
        }
        bolt.tile = new Location(bolt.tile.getX(), bolt.tile.getY() + (bolt.north ? 1 : -1), 0);
      }
      return true;
    });
  }

  /** Pairs swap places 8 ticks later, 5 damage a tile apart (at most 95). */
  swap() {
    const everyone = Shared.shuffle(this.raiders());
    if (everyone.length === 0) return;
    const colours = [1359, 1360, 1361, 1362];
    const pairs = [];
    let count = Math.min(4, Math.max(1, Math.floor(everyone.length / 2)));
    while (count-- > 0 && everyone.length) {
      const primary = everyone.shift();
      const secondary = everyone.shift() ?? null;
      let tile = null;
      if (!secondary) {
        for (let tries = 0; tries < 50 && !tile; tries++) {
          const candidate = this.randomTile(ZONE.ALL);
          if (candidate && candidate.getDistance(primary.getLocation()) <= 5) tile = candidate;
        }
        if (!tile) continue;
        primary.sendMessage("The Great Olm had no one to pair you with! The magical power will enact soon...");
      } else {
        primary.sendMessage(`You have been paired with <col=ff0000>${Shared.displayName(secondary)}</col>! The magical power will enact soon...`);
        secondary.sendMessage(`You have been paired with <col=ff0000>${Shared.displayName(primary)}</col>! The magical power will enact soon...`);
      }
      pairs.push({ primary, secondary, tile, colour: colours[pairs.length] });
    }
    if (pairs.length === 0) return;
    this.leftSign(ANIM.LEFT_CLAW_SWIRL);
    for (const delay of [0, 2, 4, 6]) {
      Shared.later(this.raid, delay, () => {
        for (const pair of pairs) {
          pair.primary.performGraphic(Shared.gfx(pair.colour));
          if (pair.secondary) pair.secondary.performGraphic(Shared.gfx(pair.colour));
          else Shared.graphicAt(this.viewers(), pair.colour, pair.tile);
        }
      });
    }
    Shared.later(this.raid, 8, () => {
      for (const pair of pairs) {
        const { primary, secondary } = pair;
        if (primary.getHitpoints() <= 0 || !this.inChamber(primary.getLocation())) continue;
        if (secondary && (secondary.getHitpoints() <= 0 || !this.inChamber(secondary.getLocation()))) continue;
        const destination = secondary ? secondary.getLocation().clone() : pair.tile;
        const distance = primary.getLocation().getDistance(destination);
        if (distance === 0) {
          primary.sendMessage("The teleport attack has no effect!");
          secondary?.sendMessage("The teleport attack has no effect!");
          continue;
        }
        const damage = Math.min(95, 5 * distance);
        const from = primary.getLocation().clone();
        Shared.graphicAt(this.viewers(), 436, from);
        Shared.graphicAt(this.viewers(), 436, destination);
        Shared.damage(primary, damage);
        Shared.sound(primary, 200);
        primary.moveTo(destination);
        if (secondary) {
          Shared.damage(secondary, damage);
          Shared.sound(secondary, 200);
          secondary.moveTo(from);
          primary.sendMessage(`Yourself and ${Shared.displayName(secondary)} have swapped places!`);
          secondary.sendMessage(`Yourself and ${Shared.displayName(primary)} have swapped places!`);
        }
      }
    });
  }

  /** The last phase's infinity sign: the left claw heals from damage for 16 ticks. */
  protectLeftClaw() {
    const left = this.leftClaw;
    if (!left?.isRegistered() || left.__coxClench > 0 || !this.rightClaw?.isRegistered()) return;
    left.__coxClenched = true;
    left.__coxClench = 16;
    this.leftSign(ANIM.LEFT_CLAW_INFINITY);
  }

  // ---------------------------------------------------------------- damage and the claws

  modifyHit(npc, hit) {
    if (!npc.__coxOlm) return;
    const { CombatType } = Shared.core();
    const type = hit.getCombatType?.();
    const attacker = hit.getAttacker?.()?.isPlayer?.() ? hit.getAttacker().getAsPlayer() : null;
    let factor = 1;
    if (npc === this.head) factor = type === CombatType.MAGIC ? 1 / 3 : 1;
    else if (npc === this.leftClaw) {
      if (npc.__coxClenched) {
        if (this.isLastPhase()) {
          // The infinity sign: the damage heals it.
          const healed = hit.getTotalDamage();
          for (const part of hit.getHits()) part.setDamage(0);
          hit.updateTotalDamage();
          npc.heal(healed);
          return;
        }
        factor = 0;
        attacker?.sendMessage("The Great Olm is currently protecting its left claw! You cannot see a way to attack it successfully.");
      } else if (type === CombatType.MAGIC || type === CombatType.RANGED) factor = 1 / 3;
    } else if (npc === this.rightClaw) factor = type === CombatType.RANGED ? 1 / 3 : 1;
    if (factor !== 1) {
      for (const part of hit.getHits()) part.setDamage(Math.floor(part.getDamage() * factor));
      hit.updateTotalDamage();
    }
    if (npc === this.leftClaw && !npc.__coxClenched) this.checkClench(npc, hit.getTotalDamage());
  }

  /** Wiki (Mod Ash): a hit of at least 1/20 of its base health makes it clench. */
  checkClench(claw, damage) {
    if (this.isLastPhase() || !this.rightClaw?.isRegistered()) return;
    const threshold = Math.ceil(claw.getMaxHitpoints() / 20);
    if (damage < threshold) return;
    claw.__coxClenched = true;
    claw.__coxClench = 45;
    for (const player of this.raiders()) player.sendMessage("The Great Olm's left claw clenches to protect itself temporarily.");
    Shared.later(this.raid, 1, () => {
      this.animate(this.objects.leftClaw, ANIM.LEFT_CLAW_CLENCH);
      Shared.later(this.raid, 1, () => this.animate(this.objects.leftClaw, ANIM.LEFT_CLAW_TWITCHING));
    });
  }

  beforeNpcDeath(npc) {
    if (!npc.__coxOlm) return false;
    if (npc === this.head) {
      if (!this.finalStand()) {
        npc.setHitpoints(1);
        return true;
      }
      return false;
    }
    // In the last phase a fallen claw comes back unless the other falls within 34 ticks.
    if (this.isLastPhase() && !npc.__coxDown) {
      const other = npc === this.leftClaw ? this.rightClaw : this.leftClaw;
      if (other?.isRegistered() && !other.__coxDown) {
        npc.__coxDown = true;
        npc.setHitpoints(1);
        npc.getCombat().reset();
        this.animate(npc === this.leftClaw ? this.objects.leftClaw : this.objects.rightClaw, npc === this.leftClaw ? ANIM.LEFT_CLAW_FALL : ANIM.RIGHT_CLAW_FALL);
        Shared.later(this.raid, 34, () => this.regrowClaw(npc));
        return true;
      }
    }
    return false;
  }

  regrowClaw(claw) {
    if (!claw.__coxDown || !claw.isRegistered() || this.dead) return;
    claw.__coxDown = false;
    claw.__coxPointsMultiplier = 0;
    claw.setHitpoints(claw.getMaxHitpoints());
    this.animate(claw === this.leftClaw ? this.objects.leftClaw : this.objects.rightClaw, claw === this.leftClaw ? ANIM.LEFT_CLAW_RISE : ANIM.RIGHT_CLAW_RISE);
  }

  onNpcDeath(npc) {
    if (npc === this.head) return this.defeated();
    if (npc !== this.leftClaw && npc !== this.rightClaw) return undefined;
    const left = npc === this.leftClaw;
    this.animate(left ? this.objects.leftClaw : this.objects.rightClaw, left ? ANIM.LEFT_CLAW_FALL : ANIM.RIGHT_CLAW_FALL);
    const side = T.SIDES[this.side];
    Shared.later(this.raid, TIMING.CLAW_CAVE, () => this.placeObject(left ? "leftClaw" : "rightClaw", left ? OBJECT.LEFT_GONE : OBJECT.RIGHT_GONE, left ? side.leftClaw : side.rightClaw));
    if (left) this.leftClaw = null;
    else {
      this.rightClaw = null;
      this.rightGone = true;
      // rsprox captures: the left claw takes a grip (7363) and idles gripping.
      Shared.later(this.raid, 4, () => {
        if (!this.leftClaw?.isRegistered()) return;
        this.animate(this.objects.leftClaw, 7363);
        Shared.later(this.raid, 2, () => this.leftClaw?.isRegistered() && this.animate(this.objects.leftClaw, ANIM.LEFT_CLAW_DEFAULT));
      });
    }
    const other = left ? this.rightClaw : this.leftClaw;
    if (!left && this.leftClaw?.__coxClench > 2) this.leftClaw.__coxClench = 2;
    if (other?.isRegistered() && !other.__coxDown) return undefined;
    if (other?.__coxDown) {
      // Both down together in the last phase: the final stand.
      other.__coxDown = false;
      this.removeNpc(other);
      if (left) this.rightClaw = null;
      else this.leftClaw = null;
      const otherSide = left ? "rightClaw" : "leftClaw";
      Shared.later(this.raid, TIMING.CLAW_CAVE, () => this.placeObject(otherSide, left ? OBJECT.RIGHT_GONE : OBJECT.LEFT_GONE, left ? side.rightClaw : side.leftClaw));
    }
    if (this.isLastPhase()) return this.beginFinalStand();
    return this.switchSides();
  }

  beginFinalStand() {
    for (const player of this.raiders()) player.sendMessage("The Great Olm is giving its all. This is its final stand.");
    if (this.head) this.head.__coxPointsMultiplier = 1;
    this.fallingCrystals$ = this.transitionCrystals(Infinity);
  }

  /** The last claw down: the head falls 4 ticks later, goes at 6, and rises across the chamber at 38. */
  switchSides() {
    this.transitioning = true;
    this.transitionCrystals(33);
    Shared.later(this.raid, TIMING.HEAD_FALL, () => this.animate(this.objects.head, ANIM.HEAD_FALL));
    Shared.later(this.raid, TIMING.HEAD_GONE, () => {
      const head = this.head;
      this.head = null;
      if (head) this.removeNpc(head);
      const side = T.SIDES[this.side];
      this.placeObject("head", OBJECT.HOLE, side.head);
      this.side = this.side === SIDE.LEFT ? SIDE.RIGHT : SIDE.LEFT;
    });
    Shared.later(this.raid, TIMING.NEXT_RISE, () => {
      if (this.raid.destroyed) return;
      this.phase++;
      this.transitioning = false;
      this.rise();
    });
  }

  /** Crystals fall around the chamber (one on a player every 5 ticks): 16-25 under, 10-16 beside. */
  transitionCrystals(duration) {
    const cap = this.raiders().length >= 6 ? 5 : 4;
    const falling = new Map();
    let ticks = 0;
    let onPlayer = 5;
    const state = { stopped: false };
    const { Location } = Shared.core();
    Shared.repeat(this.raid, 1, () => {
      if (this.raid.destroyed || state.stopped || this.dead) return false;
      for (const [key, crystal] of falling) {
        if (--crystal.ticks === 1) Shared.graphicAt(this.viewers(), 1358, crystal.tile);
        if (crystal.ticks > 0) continue;
        falling.delete(key);
        for (const player of this.raiders()) {
          const distance = player.getLocation().getDistance(crystal.tile);
          if (distance === 0) Shared.damage(player, Shared.random(16, 25));
          else if (distance === 1) Shared.damage(player, Shared.random(10, 16));
        }
        for (const player of this.viewers()) Shared.sound(player, 1021);
      }
      if (ticks++ >= duration) return falling.size > 0;
      let amount = Math.min(cap - falling.size, Shared.random(0, cap - 1));
      let aimAtPlayer = --onPlayer <= 0;
      while (amount-- > 0) {
        let tile = null;
        if (aimAtPlayer) {
          aimAtPlayer = false;
          onPlayer = 5;
          tile = Shared.randomOf(this.raiders())?.getLocation().clone() ?? null;
        } else {
          for (let tries = 0; tries < 10 && (!tile || falling.has(`${tile.getX()},${tile.getY()}`)); tries++) tile = this.randomTile(ZONE.ALL);
        }
        if (!tile) continue;
        const from = new Location(tile.getX() + Shared.randomOf([-1, 1]), tile.getY() + Shared.randomOf([-1, 0, 1]), 0);
        Shared.projectile(this.map, from, tile, 1357, { delay: 0, duration: 120, startHeight: 255, endHeight: 0 });
        Shared.graphicAt(this.viewers(), 1446, tile, { delay: 30 });
        if (!this.finalStand()) for (const player of this.viewers()) Shared.sound(player, 3834);
        falling.set(`${tile.getX()},${tile.getY()}`, { tile, ticks: 3 });
      }
      return true;
    });
    return state;
  }

  /** The Olm is slain: the exit's crystal shatters, the ancient chest appears, the raid is done. */
  defeated() {
    if (this.dead) return;
    this.dead = true;
    if (this.fallingCrystals$) this.fallingCrystals$.stopped = true;
    this.animate(this.objects.head, ANIM.HEAD_FALL);
    const { Animation, ObjectManager } = Shared.core();
    const exit = this.map.getTemplateObjects(this.t(...T.EXIT_CRYSTAL)).find((object) => object.getId() === OBJECT.EXIT_CRYSTAL);
    for (const player of this.raid.players) {
      player.getPacketSender().sendVarbit(Shared.VARBIT.STAGE, 5);
      player.sendMessage("As the Great Olm collapses, the crystal blocking your exit has been shattered.");
      player.getPacketSender().sendJingle?.(152, 0);
      if (exit) player.getPacketSender().sendObjectAnimation(exit, new Animation(7506));
    }
    if (exit) Shared.later(this.raid, 2, () => ObjectManager.deregister(exit, true));
    Shared.later(this.raid, 1, () => {
      const side = T.SIDES[this.side];
      this.placeObject("head", OBJECT.HOLE, side.head);
      const chest = this.map.getTemplateObjects(this.t(...T.CHEST)).find((object) => object.getId() === OBJECT.CHEST_CRYSTAL);
      if (chest) Shared.replaceObject(this.map, chest, OBJECT.CHEST);
    });
    this.raid.complete?.();
  }
}

Raid.registerRoom("OLM", OlmRoom);

function olmRoomOf(player) {
  const room = Raid.raidOf(player)?.olmRoom;
  return room && room.map?.inOlmChamber(player.getLocation()) ? room : null;
}

function useBarrier(event) {
  const room = olmRoomOf(event.player);
  if (!room) return false;
  room.passBarrier(event.player, event.object, event.option === "Pass");
  return true;
}

function douseFire(event) {
  const npc = event.npc;
  const room = npc?.__coxRoom;
  if (!(room instanceof OlmRoom) || !npc.__coxFireWall) return false;
  if (!room.inChamber(event.player.getLocation())) {
    event.player.sendMessage("You can't reach that.");
    return true;
  }
  room.douse(event.player, npc);
  return true;
}

/** Its head and right claw are out of melee reach; nothing is reached from outside the chamber. */
function outOfReach(event) {
  const target = event.target;
  const room = target?.__coxRoom;
  if (!(room instanceof OlmRoom) || !event.attacker?.isPlayer?.()) return;
  const player = event.attacker.getAsPlayer();
  const { CombatType } = Shared.core();
  const melee = event.method?.type?.() === CombatType.MELEE;
  if (!room.inChamber(player.getLocation()) || (melee && (target === room.head || target === room.rightClaw))) {
    event.allow = false;
    player.sendMessage("I can't reach that!");
  }
}

function olmCombat(api) {
  const { CombatMethod, CombatType } = api.core;
  return class OlmPartCombat extends CombatMethod {
    type() {
      return CombatType.MAGIC;
    }

    canAttack() {
      return false;
    }

    hits() {
      return [];
    }
  };
}

module.exports = function registerCoxOlm(api) {
  Shared.bind(api);
  Shared.onObjectIds(api, [OBJECT.BARRIER], useBarrier);
  api.onNpcInteraction("Fire", { Douse: douseFire });
  Raid.onRaidArea("canAttack", outOfReach);
  api.registerNpcCombatMethodProvider([NPC.HEAD, NPC.LEFT_CLAW, NPC.RIGHT_CLAW, NPC.FIRE], olmCombat(api));
};

Object.assign(module.exports, { OlmRoom, SEQUENCE, LAST_SEQUENCE });
