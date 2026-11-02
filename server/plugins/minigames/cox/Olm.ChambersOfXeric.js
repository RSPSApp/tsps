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
 *   Drip. Flame: Deep Burn (5 every few ticks and -2 to all combat stats, six times, spreading to
 *   those beside and resetting the host's) and Fire Wall (8-10 leaping out; 50-65 if still between
 *   the walls after 5 seconds; water spells, ice spells, Humidify or vessels of water douse a
 *   segment). Crystal: Falling Crystals (11 crystals, 15-20, on one player's tile) and Crystal Bombs
 *   (a 4-tile radius, 15 at the edge and 15 more each tile closer, 60 on top; no bursting crystal
 *   spawns on a bomb).
 * - Powers: all are used before any comes again (Strategies).
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
 *   heals five times the total; a 10-attack cooldown (2023). Swap's lone tile is within 10 tiles,
 *   a tile apart costs 5, at most 50 (Strategies).
 * - A claw damaged in the last 4 ticks draws the head its way (Strategies; recording 3389 turns at
 *   a tie, as here).
 * rsprox captures (recordings 820, 843, 3282, 3285, 3389; offsets from the chamber's cache tiles):
 * - The chamber: Olm tiles below are the cache's, the walkable floor 3228-3237 x 5731-5748 (the
 *   barrier's gap reaching 5730). Head locs (3220, 5738) rotation 3 and (3238, 5738) rotation 1, the
 *   claws 5 north and south; NPCs at +2/+3/+2 (head, left, right) west and +1/+0/+1 east.
 * - It rises 7 ticks after the first raider passes the barrier: "The Great Olm rises with the
 *   power of <col=00ff00>acid</col>." (flame ff0000, crystal ff00ff; none in the last phase)
 *   with the rising locs; their animations (7335, 7350, 7354) and sound 3405 a tick later; the
 *   risen head and claws 6 ticks in. Its first attack is the tick after the first time, 4 after
 *   every later time (10 ticks after the message). Each step of its rotation is 4 ticks.
 * - The head rests 2 ticks after turning or attacking. It leaves 32 client cycles in, from height
 *   340 ahead, 360 to its right and 355 to its left, 2 tiles aside, to 160 (0 on a tile), angle 5,
 *   progress 0, landing at 46 + 5 a tile (46 + 10 on a tile): magic 1339 (sound 3749), ranged 1340,
 *   spheres 1341 / 1343 / 1345 at 180 (sound 1784, gfx 1342 / 1344 / 1346 at height 64), acid 1354
 *   (sound 1784), the burn 1349 at angle 0 (sound 585), the fire walls 1347 at 60 (sound 3750).
 * - Acid pools go after 14-15 ticks; a spray is 7-10 pools solo, 7-15 in a scaled-up raid (820).
 * - Deep burn: on landing and every 8 ticks: "Burn with me!", gfx 1351, sound 740, -2 to all five
 *   combat stats, the 5 damage a tick later; "You feel the deep burning inside dissipate." on the
 *   sixth. Fire walls: the two walls either side of the target, from the far side to the head:
 *   projectiles 1348 thrown at once (60-90), then nameless blocking locs 26209 and the leap at 2
 *   ticks, the Fire NPCs at 4, all gone at 10. Dousing is the Fire NPC's own option (7558, op1
 *   "Douse", in the cache and all 8 captured douses): the player's spell plays from where they stand
 *   (ice rush, ice burst, water bolt and Humidify's 6294 + projectile 1669 are all seen), sound 1876
 *   60 cycles in, "You douse the flame." The loc goes a tick later, the NPC 2. No XP or inventory
 *   change in any of them.
 * - Falling crystals: every 2 ticks gfx 246 on the target and projectile 1352 from a tile beside,
 *   from height 1000; 2 ticks on gfx 1353, sound 3821. Bombs: projectile 1357, sound 3120 on landing,
 *   11 ticks to gfx 40, sound 1021; as many as raiders, sometimes one more (1 or 2 solo, 4 or 5 with
 *   four raiders, against the Wiki's "up to three").
 * - Claw signs: sound 1551 from the claw, default again 3 ticks later. Crystal Burst: crystals
 *   30033, grown (30034) with the shunt and "The crystal beneath your feet grows..." 3-4 ticks
 *   later (17-34 seen), gone a tick after (gfx 1338, sound 3821). Lightning: 4 bolts solo, 6 with
 *   four raiders, one more in the last phase, any mix of directions on columns 3228-3237, gfx 1356
 *   and sound 3887 per tile, wall to wall a tile a tick; a hit is 5-13 (seen), anim 3170, "You've been
 *   electrocuted to the spot!" and "You've been injured and can't use protection prayers!". Swap:
 *   the sign and messages, the gfx on the players every 2 ticks and on a lone tile from 2 ticks;
 *   at 8, gfx 1039 and sound 200 from both tiles, the hit a tick later; "As you had no pairing...
 *   you are taken to a random spot.". The infinity sign lasts 16 ticks (its step in a 16-step
 *   rotation, every 64 ticks).
 * - A claw falling: 7352 / 7370, its cave loc 2 ticks later, gone at 3. With the right claw
 *   down the left grips at 4 (3 in the last phase; 7363, then the gripping set). The last claw
 *   down: the head falls (7348, sound 3405) 4 ticks later, its cave loc at 6, crystals from 10
 *   and it rises on the other side at 38. Those crystals come every 2 ticks: one on a raider, then
 *   one in each third of the chamber (two each with four raiders): projectile 1357 from height 1000,
 *   shadow gfx 1447, landing 3 ticks on with gfx 1358 and sound 1021 (and sound 3834 from the
 *   middle at each, not in the final stand).
 * - The clench: on the hit, 7360 then 7361 at 3, 7362 at 44, default at 47. In the last phase a
 *   fallen claw is replaced at 3 ticks by a nameless NPC (7556, surely 7557 for the left) with
 *   headbar 8 filling over 900 cycles; the final stand's message and crystals come 4 ticks after
 *   the second claw.
 * - Life Siphon: "...absorb energy...", projectile 1355 landing at 46 + 10 a tile, gfx 1363 there and
 *   again at 2 and 5 ticks; at 8 "Your health is sapped!" (gfx 147, anim 424) with sound 124 at the
 *   head. Its death: 7348, sound 3405; at 2 the cave, the exit crystal's 7506 and "As the Great Olm
 *   collapses..."; at 3 the raid completes; at 6 the chest and the exit's 2x2 locs 29733.
 * - Messages: "The Great Olm had no one to pair you with! The magical power will enact
 *   soon...", "Yourself and <name> have swapped places!", "The teleport attack has no
 *   effect!", "The falling crystal shatters into you.", "The Great Olm infects you with a
 *   burning overwhelming power.", "The Great Olm prepares to absorb energy from anyone
 *   unprotected...", "The Great Olm's left claw clenches to protect itself temporarily."; the
 *   burnt say "Burn with me!", "I will burn with you." and "It burns like an inferno!".
 * Not on the Wiki, and not settled by a capture: the bind's and the prayer block's length (block
 *   seen for up to 7 ticks); how a regrown claw looks (no capture lets one regrow; it rises as at
 *   the start, 33 ticks after it fell, the headbar's end); bolts and crystal volleys between solo and
 *   four raiders (derived from those two); Life Siphon 1 in 16 in the final stand; the sphere's 1 in
 *   20 (2-30 a raid, close to it); the message without anything to douse with.
 */

const Shared = require("./Shared.ChambersOfXeric");
const Raid = require("./RaidState.ChambersOfXeric");
const Monsters = require("./Monsters.ChambersOfXeric");

const Achievements = require("./CombatAchievements.ChambersOfXeric");

const NPC = { HEAD: 7554, RIGHT_CLAW: 7553, LEFT_CLAW: 7555, RIGHT_CLAW_DOWN: 7556, LEFT_CLAW_DOWN: 7557, FIRE: 7558 };
const OBJECT = {
  HOLE_RISING: 29880, HOLE_RISEN: 29881, HOLE: 29882, LEFT_RISING: 29883, LEFT_RISEN: 29884, LEFT_GONE: 29885,
  RIGHT_RISING: 29886, RIGHT_RISEN: 29887, RIGHT_GONE: 29888, BARRIER: 29879, ACID: 30032, CLUSTER: 30033,
  CLUSTER_GROWN: 30034, BOMB: 29766, EXIT_CRYSTAL: 30018, EXIT_OPEN: 29733, CHEST_CRYSTAL: 30027, CHEST: 30028, FIRE: 26209,
};
const SIDE = { LEFT: 0, RIGHT: 1 };
const ZONE = { SOUTH: 0, MIDDLE: 1, NORTH: 2, ALL: 3 };
const POWER = { ACID: 0, FLAME: 1, CRYSTAL: 2 };
const POWER_NAMES = ["<col=00ff00>acid", "<col=ff0000>flame", "<col=ff00ff>crystal"];
/** Ticks: the barrier to rising, rising to risen and attacking, the last claw down to the next rise. */
const TIMING = {
  RISE_AFTER_BARRIER: 7, RISE_ANIM: 1, RISEN: 6, FIRST_ATTACK: 1, NEXT_ATTACK: 4, HEAD_REST: 2, HEAD_FALL: 4, HEAD_GONE: 6, CRYSTALS: 10, NEXT_RISE: 38,
  CLAW_CAVE: 2, CLAW_DOWN: 3, CLAW_BACK: 33, FINAL_STAND: 4, CLENCH: 44, TWITCH: 3, UNCLENCHED: 3,
};
/** [normal, final phase] animations. */
const ANIM = {
  HEAD_RISE: [7335, 7383], HEAD_FALL: [7348, 7348], HEAD_MIDDLE: [7336, 7374], HEAD_LEFT: [7338, 7375], HEAD_RIGHT: [7337, 7376],
  MIDDLE_TO_LEFT: [7341, 7377], LEFT_TO_MIDDLE: [7342, 7378], MIDDLE_TO_RIGHT: [7339, 7381], RIGHT_TO_MIDDLE: [7340, 7382],
  LEFT_TO_RIGHT: [7343, 7379], RIGHT_TO_LEFT: [7344, 7380], ATTACK_MIDDLE: [7345, 7371], ATTACK_LEFT: [7347, 7372], ATTACK_RIGHT: [7346, 7373],
  RIGHT_CLAW_RISE: 7350, RIGHT_CLAW_DEFAULT: 7351, RIGHT_CLAW_FALL: 7352, RIGHT_CLAW_INVISIBLE: 7349,
  LEFT_CLAW_RISE: 7354, LEFT_CLAW_DEFAULT: [7355, 7365], LEFT_CLAW_FALL: 7370, LEFT_CLAW_INVISIBLE: 7353,
  LEFT_CLAW_CRYSTAL: [7356, 7366], LEFT_CLAW_LIGHTNING: [7358, 7368], LEFT_CLAW_SWIRL: [7359, 7369], LEFT_CLAW_INFINITY: 7357,
  LEFT_CLAW_CLENCH: 7360, LEFT_CLAW_TWITCHING: 7361, LEFT_CLAW_UNCLENCH: 7362, LEFT_CLAW_GRIP: 7363, LEFT_CLAW_GRIP_CLENCHED: 7364,
};
const SEQUENCE = ["auto", "skip", "auto", "burst", "auto", "skip", "auto", "lightning", "auto", "skip", "auto", "swap"];
const LAST_SEQUENCE = [...SEQUENCE, "auto", "skip", "auto", "protect"];
const SPECIALS = new Set(["burst", "lightning", "swap", "protect"]);
/** rsprox captures: spheres land 180 client cycles in; bombs go off 11 ticks after the throw. */
const SPHERE_END = 180;
const BOMB_FUSE = 11;
const BASE_MAX = 27;
/** rsprox captures: the head's height for shots ahead, to its right and to its left. */
const HEAD_HEIGHT = { AHEAD: 85, RIGHT: 90, LEFT: 88.75 };
const FIRE_WALL_ANGLES = [50, 44, 38, 33, 27, 22, 16, 11, 5];
const ACID_POOL_TICKS = 14;
/** Wiki (2023): attacks before Life Siphon can come again. */
const SIPHON_COOLDOWN = 10;
const WATERING_CANS = [5333, 5334, 5335, 5336, 5337, 5338, 5339, 5340];
const EMPTY_WATERING_CAN = 5331;
const WATER_GOURD = 20801;
const EMPTY_GOURD = 20800;
/** Wiki: the spells that douse, by their names in CombatSpells; autocast first when it is one. */
const DOUSING_SPELLS = ["Water Surge", "Water Wave", "Water Blast", "Water Bolt", "Water Strike", "Ice Barrage", "Ice Blitz", "Ice Burst", "Ice Rush"];
/** Humidify's level and runes (astral, 3 water, law), which LunarSpells keeps to itself. */
const HUMIDIFY = { LEVEL: 68, RUNES: [[9075, 1], [555, 3], [563, 1]], ANIMATION: 6294, PROJECTILE: 1669 };
const DOUSE_REACH = 10;

/** Cache tiles. */
const T = {
  LEFT_CORNER: [3227, 5730], RIGHT_CORNER: [3237, 5748], SEPARATING_Y: 5740, SOUTH_MIDDLE_Y: 5734, NORTH_MIDDLE_Y: 5746,
  LEFT_HEAD_FACE: [3227, 5740], RIGHT_HEAD_FACE: [3238, 5740], FIRE_WEST_X: 3228, FIRE_EAST_X: 3237, FIRE_SOUTH_Y: 5731, FIRE_NORTH_Y: 5748,
  LIGHTNING_LOW: [3228, 5730], LIGHTNING_HIGH: [3228, 5748], LIGHTNING_COLUMNS: 10, CENTRE: [3233, 5739], EXIT_CRYSTAL: [3232, 5749], CHEST: [3233, 5751], BARRIER_Y: 5729,
  SIDES: [
    { head: [3220, 5738, 3], leftClaw: [3220, 5743, 3], rightClaw: [3220, 5733, 3], npcShift: { head: 2, left: 3, right: 2 }, soundShift: 5 },
    { head: [3238, 5738, 1], leftClaw: [3238, 5733, 1], rightClaw: [3238, 5743, 1], npcShift: { head: 1, left: 0, right: 1 }, soundShift: 0 },
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
    this.powers = [];
    this.bombTiles = new Set();
    this.clawHitAt = { left: -Infinity, right: -Infinity };
    this.siphonWait = 0;
    // Combat Achievements: Perfect Olm, and A Not So Special Lizard's specials in the last claw phase.
    this.perfect = true;
    this.noLastPhaseSpecials = true;
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
    this.power = this.drawPower();
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
      Shared.areaSound(this.viewers(), 3405, new Location(at.getX() + side.soundShift, at.getY() + 2, 0), { delay: 15, range: 15 });
      this.animate(this.objects.head, ANIM.HEAD_RISE);
      this.animate(this.objects.leftClaw, ANIM.LEFT_CLAW_RISE);
      this.animate(this.objects.rightClaw, ANIM.RIGHT_CLAW_RISE);
    });
    Shared.later(this.raid, TIMING.RISEN, () => this.risenUp());
  }

  /** Wiki (Strategies): every power goes before any comes again; recording 820 fits it. */
  drawPower() {
    if (this.powers.length === 0) this.powers = [POWER.ACID, POWER.FLAME, POWER.CRYSTAL];
    const fresh = this.powers.filter((power) => power !== this.power);
    const power = Shared.randomOf(fresh.length ? fresh : this.powers);
    this.powers = this.powers.filter((other) => other !== power);
    return power;
  }

  risenUp() {
    if (this.raid.destroyed) return;
    const side = T.SIDES[this.side];
    const { Location } = Shared.core();
    const head = this.placeObject("head", OBJECT.HOLE_RISEN, side.head);
    const leftObject = this.placeObject("leftClaw", OBJECT.LEFT_RISEN, side.leftClaw);
    const rightObject = this.placeObject("rightClaw", OBJECT.RIGHT_RISEN, side.rightClaw);
    const at = (object, shift) => new Location(object.getLocation().getX() + shift, object.getLocation().getY(), 0);
    this.head = this.spawnPart(NPC.HEAD, at(head, side.npcShift.head));
    this.leftClaw = this.spawnPart(NPC.LEFT_CLAW, at(leftObject, side.npcShift.left));
    this.rightClaw = this.spawnPart(NPC.RIGHT_CLAW, at(rightObject, side.npcShift.right));
    if (this.head) this.head.__coxPointsMultiplier = 0;
    this.usedThisPhase.clear();
    this.counter = 0;
    this.attackWait = this.roseBefore ? TIMING.NEXT_ATTACK : TIMING.FIRST_ATTACK;
    this.roseBefore = true;
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
    // Its parts sit in the 5x8 locs of the chamber's wall.
    npc.setFlag("combat:built-into-scenery");
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
      if (!this.isLastPhase()) Shared.later(this.raid, TIMING.UNCLENCHED, () => this.animate(this.objects.leftClaw, ANIM.LEFT_CLAW_DEFAULT));
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
    const count = { [ZONE.SOUTH]: south, [ZONE.MIDDLE]: middle, [ZONE.NORTH]: north };
    const most = middle >= south && middle >= north ? ZONE.MIDDLE : north >= south ? ZONE.NORTH : ZONE.SOUTH;
    // Wiki (Strategies): a claw damaged in the last 4 ticks draws the head, unless others outnumber it.
    const west = this.side === SIDE.LEFT;
    for (const [hitAt, zone] of [[this.clawHitAt.right, west ? ZONE.SOUTH : ZONE.NORTH], [this.clawHitAt.left, west ? ZONE.NORTH : ZONE.SOUTH]]) {
      if (this.raid.ticks - hitAt <= 4 && count[zone] >= count[most]) return zone;
    }
    return most;
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
    Shared.later(this.raid, TIMING.HEAD_REST, () => this.animate(this.objects.head, this.restingAnim()));
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
    Shared.later(this.raid, TIMING.HEAD_REST, () => this.animate(this.objects.head, this.restingAnim()));
  }

  /** Where its attacks leave its mouth. */
  face() {
    const { Location } = Shared.core();
    const [x, y] = this.side === SIDE.LEFT ? T.LEFT_HEAD_FACE : T.RIGHT_HEAD_FACE;
    const shift = this.direction === ZONE.SOUTH ? -2 : this.direction === ZONE.NORTH ? 2 : 0;
    return new Location(this.x(x), this.y(y) + shift, 0);
  }

  /** The height its shots leave from: the head's own right is south on the west side. */
  headHeight() {
    if (this.direction === ZONE.MIDDLE) return HEAD_HEIGHT.AHEAD;
    return (this.direction === ZONE.SOUTH) === (this.side === SIDE.LEFT) ? HEAD_HEIGHT.RIGHT : HEAD_HEIGHT.LEFT;
  }

  /**
   * A shot from the head (rsprox captures): leaving 32 client cycles in to 160 (0 on a tile), angle
   * 5, progress 0; `end` defaults to 46 + 5 a tile, 46 + 10 on a tile. Returns the ticks until it
   * lands.
   */
  headShot(to, id, end = null, angle = 5) {
    const { Projectile } = Shared.core();
    const from = this.face();
    const tile = to.getLocation ? to.getLocation() : to;
    const finish = end ?? 46 + (to.getLocation ? 5 : 10) * from.getDistance(tile);
    new Projectile(from, tile, to.getLocation ? to : null, id, 32, finish, this.headHeight(), to.getLocation ? 40 : 0, this.map)
      .withAngle(angle)
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
    if (--this.siphonWait <= 0 && this.finalStand() && Shared.random(0, 15) === 0) return this.run("siphon", () => this.lifeSiphon());
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
    // A Not So Special Lizard: the infinity sign needs the right claw up (protectLeftClaw).
    if (this.isLastPhase() && (step !== "protect" || this.rightClaw?.isRegistered())) this.noLastPhaseSpecials = false;
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
        player.performGraphic(Shared.gfx([1346, 1344, 1342][type], { height: 64 }));
        if (Shared.isProtected(player, styles[type])) return;
        this.perfect = false;
        Shared.damage(player, Math.min(99, Math.floor(player.getHitpoints() / 2)));
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
    this.siphonWait = SIPHON_COOLDOWN;
    this.headSound(1784);
    for (const player of this.raiders()) player.sendMessage("The Great Olm prepares to absorb energy from anyone unprotected...");
    for (const tile of [first, second]) {
      const end = 46 + 10 * this.face().getDistance(tile);
      this.headShot(tile, 1355, end);
      Shared.graphicAt(this.viewers(), 1363, tile, { delay: end });
    }
    for (const delay of [2, 5]) {
      Shared.later(this.raid, delay, () => {
        Shared.graphicAt(this.viewers(), 1363, first);
        Shared.graphicAt(this.viewers(), 1363, second);
      });
    }
    Shared.later(this.raid, 8, () => {
      if (!this.head?.isRegistered()) return;
      let total = 0;
      for (const player of this.raiders()) {
        if (player.getLocation().equals(first) || player.getLocation().equals(second)) continue;
        const damage = Shared.random(15, 25);
        total += damage;
        this.perfect = false;
        Shared.damage(player, damage);
        player.sendMessage("Your health is sapped!");
        player.performGraphic(Shared.gfx(147, { height: 124 }));
        Shared.animate(player, 424);
      }
      Shared.areaSound(this.viewers(), 124, this.head.getLocation());
      if (total > 0) Shared.healSplat(this.head, total * 5);
    });
  }

  // ---------------------------------------------------------------- acid

  addPool(tile) {
    const key = `${tile.getX()},${tile.getY()}`;
    if (this.pools.has(key)) return;
    const { GameObject, ObjectManager } = Shared.core();
    const object = new GameObject(OBJECT.ACID, tile.clone(), 10, 0, this.map);
    ObjectManager.register(object, true);
    this.pools.set(key, { object, ticks: ACID_POOL_TICKS, tile: tile.clone() });
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
      const key = `${player.getLocation().getX()},${player.getLocation().getY()}`;
      const pool = this.pools.get(key);
      if (!pool || pool.ticks >= ACID_POOL_TICKS) continue;
      // Perfect Olm: never hurt by the same pool on consecutive ticks.
      if (player.__coxOlmPoolKey === key && player.__coxOlmPoolTick === this.raid.ticks - 1) this.perfect = false;
      player.__coxOlmPoolKey = key;
      player.__coxOlmPoolTick = this.raid.ticks;
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
    target.sendMessage("<col=ff0000>The Great Olm has smothered you in acid. It starts to drip off slowly.");
    Shared.later(this.raid, delay, () => {
      target.__coxAcidUntil = this.raid.ticks + 21;
      this.addPool(target.getLocation());
    });
    Shared.later(this.raid, delay + 21, () => this.busy.delete("acidDrip"));
  }

  acidSpray() {
    this.headAttackAnim();
    this.headSound(1784);
    for (let count = Shared.random(7, this.raid.scale >= 8 ? 15 : 10), tries = 100; count > 0 && tries > 0; tries--) {
      const tile = this.randomTile(this.direction);
      if (!tile || this.pools.has(`${tile.getX()},${tile.getY()}`)) continue;
      count--;
      const delay = this.headShot(tile, 1354);
      Shared.later(this.raid, delay, () => {
        this.addPool(tile);
        Shared.areaSound(this.viewers(), 3308, tile, { range: 3 });
      });
    }
  }

  // ---------------------------------------------------------------- flame

  /**
   * Wiki: 5 damage and -2 to all combat stats, six times, on landing and every 8 ticks (rsprox
   * captures). Whoever stands beside takes a fresh burn and resets the host's (Strategies).
   */
  deepBurn() {
    const target = Shared.randomOf(this.everyone(this.direction));
    if (!target) return;
    this.busy.add("deepBurn");
    this.headAttackAnim();
    this.headSound(585, { delay: 0, range: 13 });
    const burning = new Map([[target, 6]]);
    const delay = this.headShot(target, 1349, null, 0);
    const { Skill } = Shared.core();
    const skills = [Skill.ATTACK, Skill.DEFENCE, Skill.STRENGTH, Skill.RANGED, Skill.MAGIC];
    const burn = (player, text) => {
      player.forceChat(text);
      player.performGraphic(Shared.gfx(1351, { height: 110 }));
      Shared.sound(player, 740);
      const manager = player.getSkillManager();
      for (const skill of skills) manager.setCurrentLevel(skill, Math.max(1, manager.getCurrentLevel(skill) - 2), true);
      Shared.later(this.raid, 1, () => Shared.damage(player, 5));
    };
    const pulse = () => {
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
        let spread = false;
        for (const other of chamber) {
          if (burning.has(other) || next.has(other) || other.getLocation().getDistance(player.getLocation()) > 1) continue;
          next.set(other, 6);
          burn(other, "I will burn with you.");
          spread = true;
        }
        if (spread) next.set(player, 6);
        else if (left > 1) next.set(player, left - 1);
        else player.sendMessage("You feel the deep burning inside dissipate.");
      }
      burning.clear();
      for (const [player, left] of next) burning.set(player, left);
      if (burning.size === 0) {
        this.busy.delete("deepBurn");
        return false;
      }
      return true;
    };
    Shared.later(this.raid, delay, () => {
      target.sendMessage("The Great Olm infects you with a burning overwhelming power.");
      if (pulse()) Shared.repeat(this.raid, 8, pulse);
    });
  }

  /**
   * Wiki: two walls of fire either side of the target; 50-65 for those still between them. rsprox
   * captures: the walls run from the far side to the head; blocking locs and the leap at 2 ticks,
   * the Fire NPCs players douse at 4, everything gone at 10.
   */
  fireWall() {
    const target = Shared.randomOf(this.everyone(this.direction));
    if (!target) return;
    this.headAttackAnim();
    const y = target.getLocation().getY();
    if (!(y > this.y(T.FIRE_SOUTH_Y) + 1 && y < this.y(T.FIRE_NORTH_Y) - 1)) return;
    this.busy.add("fireWall");
    const { GameObject, Location, ObjectManager, Projectile } = Shared.core();
    const left = this.side === SIDE.LEFT;
    const fromX = this.x(left ? T.FIRE_EAST_X : T.FIRE_WEST_X);
    const step = left ? -1 : 1;
    const north = new Location(fromX, y + 1, 0);
    const south = new Location(fromX, y - 1, 0);
    const walls = [[north, 1], [south, -1]];
    for (const [wall] of walls) {
      this.headShot(wall, 1347, 60);
      FIRE_WALL_ANGLES.forEach((angle, index) => {
        const tile = new Location(wall.getX() + step * (index + 1), wall.getY(), 0);
        new Projectile(wall, tile, null, 1348, 60, 90, 0, 0, this.map).withAngle(angle).withProgress(0).sendProjectile();
      });
    }
    this.headSound(3750, { range: 13 });
    const locs = new Map();
    const fires = [];
    Shared.later(this.raid, 2, () => {
      if (this.dead || this.raid.destroyed) return;
      for (const [wall, dy] of walls) {
        for (let i = 0; i < T.LIGHTNING_COLUMNS; i++) {
          const tile = new Location(wall.getX() + step * i, wall.getY(), 0);
          if (!this.inChamber(tile)) continue;
          for (const player of this.raiders()) {
            if (!player.getLocation().equals(tile)) continue;
            this.perfect = false;
            Shared.damage(player, Shared.random(8, 10));
            player.sendMessage("You leap away from the flame, getting slightly scorched in the process.");
            Shared.animate(player, 1114);
            player.moveTo(new Location(tile.getX(), tile.getY() + dy, 0));
          }
          const loc = new GameObject(OBJECT.FIRE, tile, 10, 0, this.map);
          ObjectManager.register(loc, true);
          locs.set(`${tile.getX()},${tile.getY()}`, loc);
        }
      }
    });
    Shared.later(this.raid, 4, () => {
      if (this.dead || this.raid.destroyed) return;
      for (const [key, loc] of locs) {
        const fire = this.spawnNpc(NPC.FIRE, loc.getLocation(), { scale: false });
        if (!fire) continue;
        fire.__coxFireWall = true;
        fire.__coxFireLoc = () => {
          locs.delete(key);
          ObjectManager.deregister(loc, true);
        };
        fires.push(fire);
      }
    });
    Shared.later(this.raid, 10, () => {
      for (const fire of fires) {
        fire.__coxFireWall = false;
        this.removeNpc(fire);
      }
      for (const loc of locs.values()) ObjectManager.deregister(loc, true);
      locs.clear();
      for (const player of this.raiders()) {
        if (player.getLocation().getY() !== y) continue;
        this.perfect = false;
        Shared.damage(player, Shared.random(50, 65));
      }
      this.busy.delete("fireWall");
    });
  }

  /** The water or ice spell a player would douse with (their autocast first), or null. Sends nothing. */
  dousingSpell(player) {
    const { CombatSpells, PluginManager } = Shared.core();
    const spells = DOUSING_SPELLS.map((name) => CombatSpells.getCombatSpellByName(name)).filter(Boolean);
    const autocast = player.getCombat().getAutocastSpell?.();
    if (spells.includes(autocast)) spells.unshift(autocast);
    return spells.find((spell) => {
      if (spell.getSpellbook() !== player.getSpellbook() || Shared.level(player, "MAGIC") < spell.levelRequired()) return false;
      const needed = spell.itemsToConsume(player, spell.itemsRequired(player) ?? []);
      const short = spell.constructor.inventoryShortfall(player, needed);
      return short.length === 0 || PluginManager.checkSpellRuneSource(player, short);
    }) ?? null;
  }

  canHumidify(player) {
    const { Item, MagicSpellbook, PluginManager } = Shared.core();
    if (player.getSpellbook() !== MagicSpellbook.LUNAR || Shared.level(player, "MAGIC") < HUMIDIFY.LEVEL) return false;
    const short = HUMIDIFY.RUNES.filter(([id, amount]) => !Shared.has(player, id, amount))
      .map(([id, amount]) => new Item(id, amount - player.getInventory().getAmount(id)));
    return short.length === 0 || PluginManager.checkSpellRuneSource(player, short);
  }

  /** A vessel of water is left a dose emptier (Wiki). */
  useVessel(player, id) {
    const { Item } = Shared.core();
    const slot = player.getInventory().getItems().findIndex((item) => item?.getId() === id);
    if (slot < 0) return;
    const emptied = id === WATER_GOURD ? EMPTY_GOURD : id === WATERING_CANS[0] ? EMPTY_WATERING_CAN : id - 1;
    player.getInventory().setItem(slot, new Item(emptied, 1)).refreshItems();
  }

  /**
   * The Fire's Douse option: what the player can cast plays out on the flame, at no cost (rsprox
   * captures: no XP or inventory change), or failing that a vessel of water (Wiki) is used.
   */
  douse(player, fire, vessel = null) {
    const { Animation, Projectile } = Shared.core();
    const tile = fire.getLocation();
    const spell = vessel ? null : this.dousingSpell(player);
    const humidify = !vessel && !spell && this.canHumidify(player);
    const item = vessel ?? (spell || humidify ? null : [WATER_GOURD, ...WATERING_CANS].find((id) => Shared.has(player, id)));
    if (!spell && !humidify && !item) {
      player.sendMessage("Only water, ice spells or humidify can douse this flame!");
      return;
    }
    player.setPositionToFace(tile);
    if (spell) {
      spell.startCast(player, fire);
      const impact = spell.endGraphic?.()?.getId?.();
      if (impact) Shared.graphicAt(this.viewers(), impact, tile, { delay: 60 });
    } else if (humidify) {
      player.performAnimation(new Animation(HUMIDIFY.ANIMATION));
      new Projectile(player.getLocation(), tile, null, HUMIDIFY.PROJECTILE, 0, 60, 2.5, 0, this.map).withAngle(0).withProgress(32).sendProjectile();
    } else {
      this.useVessel(player, item);
    }
    Shared.areaSound(this.viewers(), 1876, tile, { delay: 60 });
    this.extinguish(player, fire);
  }

  /** rsprox captures: the message at once, the fire's loc a tick later, the NPC a tick after that. */
  extinguish(player, fire) {
    if (!fire.__coxFireWall) return;
    fire.__coxFireWall = false;
    player.sendMessage("You douse the flame.");
    Shared.later(this.raid, 1, () => fire.__coxFireLoc?.());
    Shared.later(this.raid, 2, () => this.removeNpc(fire));
  }

  // ---------------------------------------------------------------- crystal

  fallingCrystals() {
    const target = Shared.randomOf(this.everyone(this.direction));
    if (!target) return;
    this.busy.add("fallingCrystals");
    this.headSound(324);
    for (const player of this.raiders()) player.sendMessage("The Great Olm sounds a cry...");
    target.sendMessage("<col=ff0000>The Great Olm has chosen you as its target - watch out!</col>");
    target.performGraphic(Shared.gfx(246));
    this.headAttackAnim();
    let left = 11;
    const drop = () => {
      if (this.raid.destroyed || this.dead || left-- <= 0 || target.getHitpoints() <= 0 || !this.inChamber(target.getLocation())) {
        this.busy.delete("fallingCrystals");
        return false;
      }
      const tile = target.getLocation().clone();
      const { Location, Projectile } = Shared.core();
      // rsprox captures: one every 2 ticks from high above a tile beside, shattering 2 ticks later (gfx 1353).
      const from = new Location(tile.getX() + Shared.randomOf([-1, 0, 1]), tile.getY() + Shared.randomOf([-1, 1]), 0);
      target.performGraphic(Shared.gfx(246));
      new Projectile(from, tile, null, 1352, 0, 60, 250, 0, this.map).withAngle(10).withProgress(64).sendProjectile();
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

  /**
   * rsprox captures: one a raider, sometimes one more (the Wiki says at most three, recording 820
   * throws 4-5). Wiki: 15 at 4 tiles, 15 more each tile closer; Strategies: 60 on top.
   */
  crystalBombs() {
    this.busy.add("crystalBombs");
    this.headAttackAnim();
    const count = Math.max(1, this.raiders().length) + Shared.random(0, 1);
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
      const end = 46 + 10 * this.face().getDistance(tile);
      this.headShot(tile, 1357, end);
      Shared.areaSound(this.viewers(), 3120, tile, { delay: end });
      Shared.later(this.raid, Math.ceil(end / 30), () => {
        const object = new GameObject(OBJECT.BOMB, tile, 10, 0, this.map);
        ObjectManager.register(object, true);
        objects.push(object);
        this.bombTiles.add(`${tile.getX()},${tile.getY()}`);
      });
    }
    Shared.later(this.raid, BOMB_FUSE, () => {
      for (const object of objects) {
        const at = object.getLocation();
        Shared.graphicAt(this.viewers(), 40, at, { height: 40 });
        Shared.areaSound(this.viewers(), 1021, at, { range: 10 });
        ObjectManager.deregister(object, true);
        this.bombTiles.delete(`${at.getX()},${at.getY()}`);
      }
      for (const tile of bombs) {
        for (const player of this.raiders()) {
          const distance = player.getLocation().getDistance(tile);
          if (distance > 4) continue;
          this.perfect = false;
          Shared.damage(player, Math.min(60, 15 * (5 - distance)));
        }
      }
      this.busy.delete("crystalBombs");
    });
  }

  // ---------------------------------------------------------------- claw specials

  leftSign(anim) {
    const { Location } = Shared.core();
    const at = this.objects.leftClaw.getLocation();
    Shared.areaSound(this.viewers(), 1551, new Location(at.getX() + T.SIDES[this.side].soundShift, at.getY() + 1, 0), { range: 15 });
    this.animate(this.objects.leftClaw, anim);
    if (anim !== ANIM.LEFT_CLAW_INFINITY) Shared.later(this.raid, 3, () => this.animate(this.objects.leftClaw, ANIM.LEFT_CLAW_DEFAULT));
  }

  /** rsprox captures: the crystals grow and shunt 3-4 ticks later and go a tick after. Wiki: none on a bomb. */
  crystalBurst() {
    this.leftSign(ANIM.LEFT_CLAW_CRYSTAL);
    this.clusters ??= new Map();
    const { GameObject, ObjectManager } = Shared.core();
    for (const player of this.raiders()) {
      const tile = player.getLocation().clone();
      const key = `${tile.getX()},${tile.getY()}`;
      if (this.clusters.has(key) || this.bombTiles.has(key)) continue;
      const object = new GameObject(OBJECT.CLUSTER, tile, 10, 0, this.map);
      ObjectManager.register(object, true);
      this.clusters.set(key, { object, ticks: 5, tile });
    }
  }

  tickClusters() {
    if (!this.clusters?.size) return;
    const { Location, RegionManager, ObjectManager } = Shared.core();
    for (const [key, cluster] of this.clusters) {
      const tick = --cluster.ticks;
      if (tick === 1) {
        cluster.object = Shared.replaceObject(this.map, cluster.object, OBJECT.CLUSTER_GROWN);
        for (const player of this.raiders()) {
          if (!player.getLocation().equals(cluster.tile)) continue;
          const around = [];
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              const tile = new Location(cluster.tile.getX() + dx, cluster.tile.getY() + dy, 0);
              if ((dx || dy) && !RegionManager.blocked(tile, this.map)) around.push(tile);
            }
          }
          this.perfect = false;
          Shared.damage(player, Shared.random(17, 34));
          player.sendMessage("The crystal beneath your feet grows rapidly and shunts you to the side.");
          Shared.animate(player, 1114);
          if (around.length) player.moveTo(Shared.randomOf(around));
        }
      } else if (tick <= 0) {
        Shared.graphicAt(this.viewers(), 1338, cluster.tile);
        Shared.areaSound(this.viewers(), 3821, cluster.tile, { range: 2 });
        ObjectManager.deregister(cluster.object, true);
        this.clusters.delete(key);
      }
    }
  }

  /** rsprox captures: bolts run north or south, wall to wall, a tile a tick (4 solo, 6 with four raiders; one more in the last phase). */
  lightning() {
    this.leftSign(ANIM.LEFT_CLAW_LIGHTNING);
    const { CombatFactory, Location, PrayerHandler, RegionManager } = Shared.core();
    const count = 4 + Math.floor(this.raiders().length / 2) + (this.isLastPhase() ? 1 : 0);
    const columns = Shared.shuffle([...Array(T.LIGHTNING_COLUMNS).keys()]).slice(0, count);
    const bolts = columns.map((column) => {
      const north = Shared.random(0, 1) === 0;
      const [x, y] = north ? T.LIGHTNING_LOW : T.LIGHTNING_HIGH;
      const tile = new Location(this.x(x) + column, this.y(y), 0);
      // The barrier's gap reaches a tile further south than the rest of the floor.
      return { tile: RegionManager.blocked(tile, this.map) ? new Location(tile.getX(), tile.getY() + 1, 0) : tile, north };
    });
    const strike = () => {
      if (this.raid.destroyed || bolts.length === 0) return false;
      for (const bolt of [...bolts]) {
        if (RegionManager.blocked(bolt.tile, this.map) || !this.map.inOlmChamber(bolt.tile)) {
          bolts.splice(bolts.indexOf(bolt), 1);
          continue;
        }
        Shared.graphicAt(this.viewers(), 1356, bolt.tile);
        Shared.areaSound(this.viewers(), 3887, bolt.tile, { range: 3 });
        for (const player of this.raiders()) {
          if (!player.getLocation().equals(bolt.tile)) continue;
          Shared.damage(player, Shared.random(5, 13));
          player.sendMessage("<col=ff0000>You've been electrocuted to the spot!</col>");
          player.sendMessage("You've been injured and can't use protection prayers!");
          for (const prayer of [PrayerHandler.PROTECT_FROM_MAGIC, PrayerHandler.PROTECT_FROM_MELEE, PrayerHandler.PROTECT_FROM_MISSILES]) {
            if (PrayerHandler.isActivated(player, prayer)) PrayerHandler.deactivatePrayer(player, prayer);
          }
          player.getCombat().getPrayerBlockTimer().start(5);
          Shared.animate(player, 3170);
          CombatFactory.freeze(player, 5, null);
        }
        bolt.tile = new Location(bolt.tile.getX(), bolt.tile.getY() + (bolt.north ? 1 : -1), 0);
      }
      return true;
    };
    if (strike()) Shared.repeat(this.raid, 1, strike);
  }

  /**
   * Pairs (up to six players, Strategies) swap places 8 ticks later; alone, the player goes to a
   * tile within 10 (Wiki, 2023). 5 a tile apart, at most 50 (Strategies), landing a tick after.
   */
  swap() {
    const everyone = Shared.shuffle(this.raiders());
    if (everyone.length === 0) return;
    const colours = [1359, 1360, 1361];
    const pairs = [];
    let count = Math.min(colours.length, Math.max(1, Math.floor(everyone.length / 2)));
    while (count-- > 0 && everyone.length) {
      const primary = everyone.shift();
      const secondary = everyone.shift() ?? null;
      let tile = null;
      if (!secondary) {
        for (let tries = 0; tries < 50 && !tile; tries++) {
          const candidate = this.randomTile(ZONE.ALL);
          if (candidate && candidate.getDistance(primary.getLocation()) <= 10) tile = candidate;
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
    for (const delay of [0, 2, 4, 6, 8]) {
      Shared.later(this.raid, delay, () => {
        for (const pair of pairs) {
          pair.primary.performGraphic(Shared.gfx(pair.colour));
          if (pair.secondary) pair.secondary.performGraphic(Shared.gfx(pair.colour));
          else if (delay > 0) Shared.graphicAt(this.viewers(), pair.colour, pair.tile);
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
        const damage = Math.min(50, 5 * distance);
        const from = primary.getLocation().clone();
        this.perfect = false;
        Shared.areaSound(this.viewers(), 200, from, { range: 3 });
        primary.moveTo(destination);
        Shared.later(this.raid, 1, () => Shared.damage(primary, damage));
        if (secondary) {
          Shared.areaSound(this.viewers(), 200, destination, { range: 3 });
          secondary.moveTo(from);
          primary.performGraphic(Shared.gfx(1039));
          secondary.performGraphic(Shared.gfx(1039));
          Shared.later(this.raid, 1, () => Shared.damage(secondary, damage));
          primary.sendMessage(`Yourself and ${Shared.displayName(secondary)} have swapped places!`);
          secondary.sendMessage(`Yourself and ${Shared.displayName(primary)} have swapped places!`);
        } else {
          primary.sendMessage("As you had no pairing... you are taken to a random spot.");
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
    if (npc.__coxDown) {
      for (const part of hit.getHits()) part.setDamage(0);
      hit.updateTotalDamage();
      return;
    }
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
    if (hit.getTotalDamage() > 0) {
      if (npc === this.leftClaw) this.clawHitAt.left = this.raid.ticks;
      else if (npc === this.rightClaw) this.clawHitAt.right = this.raid.ticks;
    }
    if (npc === this.leftClaw && !npc.__coxClenched) this.checkClench(npc, hit.getTotalDamage());
  }

  /** Wiki (Mod Ash): a hit of at least 1/20 of its base health makes it clench. */
  checkClench(claw, damage) {
    if (this.isLastPhase() || !this.rightClaw?.isRegistered()) return;
    const threshold = Math.ceil(claw.getMaxHitpoints() / 20);
    if (damage < threshold) return;
    claw.__coxClenched = true;
    claw.__coxClench = TIMING.CLENCH;
    for (const player of this.raiders()) player.sendMessage("The Great Olm's left claw clenches to protect itself temporarily.");
    this.animate(this.objects.leftClaw, ANIM.LEFT_CLAW_CLENCH);
    Shared.later(this.raid, TIMING.TWITCH, () => {
      if (claw.__coxClenched) this.animate(this.objects.leftClaw, ANIM.LEFT_CLAW_TWITCHING);
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
    // In the last phase a fallen claw comes back unless the other falls first.
    if (this.isLastPhase() && !npc.__coxDown) {
      const other = npc === this.leftClaw ? this.rightClaw : this.leftClaw;
      if (other?.isRegistered() && !other.__coxDown) {
        this.fallClaw(npc);
        return true;
      }
    }
    return false;
  }

  clawParts(left) {
    const side = T.SIDES[this.side];
    return left
      ? { key: "leftClaw", tile: side.leftClaw, shift: side.npcShift.left, npc: NPC.LEFT_CLAW, down: NPC.LEFT_CLAW_DOWN, rising: OBJECT.LEFT_RISING, risen: OBJECT.LEFT_RISEN, gone: OBJECT.LEFT_GONE, rise: ANIM.LEFT_CLAW_RISE, idle: ANIM.LEFT_CLAW_DEFAULT, fall: ANIM.LEFT_CLAW_FALL }
      : { key: "rightClaw", tile: side.rightClaw, shift: side.npcShift.right, npc: NPC.RIGHT_CLAW, down: NPC.RIGHT_CLAW_DOWN, rising: OBJECT.RIGHT_RISING, risen: OBJECT.RIGHT_RISEN, gone: OBJECT.RIGHT_GONE, rise: ANIM.RIGHT_CLAW_RISE, idle: ANIM.RIGHT_CLAW_DEFAULT, fall: ANIM.RIGHT_CLAW_FALL };
  }

  /**
   * rsprox captures (last phase, the other claw up): the fall and its cave as ever, and at 3 ticks
   * the claw's NPC makes way for a nameless one whose headbar fills for 30 ticks, the time left.
   */
  fallClaw(npc) {
    const left = npc === this.leftClaw;
    const parts = this.clawParts(left);
    npc.__coxDown = true;
    npc.setHitpoints(1);
    npc.getCombat().reset();
    this.fallen = { npc, left, marker: null };
    this.animate(this.objects[parts.key], parts.fall);
    Shared.later(this.raid, TIMING.CLAW_CAVE, () => this.placeObject(parts.key, parts.gone, parts.tile));
    if (!left) {
      this.rightGone = true;
      Shared.later(this.raid, TIMING.CLAW_DOWN, () => this.gripLeftClaw());
    }
    Shared.later(this.raid, TIMING.CLAW_DOWN, () => {
      if (this.fallen?.npc !== npc) return;
      const location = npc.getLocation().clone();
      this.removeNpc(npc);
      this.fallen.marker = this.spawnNpc(parts.down, location, { scale: false });
      this.fallen.marker?.showHeadbar(8, { fill: 0, endFill: 120, duration: 900 });
    });
    Shared.later(this.raid, TIMING.CLAW_BACK, () => this.regrowClaw(npc));
  }

  /** Not in any capture: it comes back at full health, rising as it did at the start of the phase. */
  regrowClaw(npc) {
    if (this.fallen?.npc !== npc || this.dead || this.raid.destroyed) return;
    const { left, marker } = this.fallen;
    this.fallen = null;
    this.perfect = false;
    if (marker) this.removeNpc(marker);
    this.removeNpc(npc);
    const parts = this.clawParts(left);
    const object = this.placeObject(parts.key, parts.rising, parts.tile);
    if (!left) this.rightGone = false;
    const { Location } = Shared.core();
    const claw = this.spawnPart(parts.npc, new Location(object.getLocation().getX() + parts.shift, object.getLocation().getY(), 0));
    if (claw) claw.__coxPointsMultiplier = 0;
    if (left) this.leftClaw = claw;
    else this.rightClaw = claw;
    Shared.later(this.raid, TIMING.RISE_ANIM, () => this.animate(this.objects[parts.key], parts.rise));
    Shared.later(this.raid, TIMING.RISEN, () => {
      if (this.dead || this.raid.destroyed) return;
      this.placeObject(parts.key, parts.risen, parts.tile);
      this.animate(this.objects[parts.key], parts.idle);
    });
  }

  /** rsprox captures: the left claw takes a grip (7363, 7364 when it was clenched) and idles gripping. */
  gripLeftClaw() {
    if (!this.leftClaw?.isRegistered()) return;
    this.animate(this.objects.leftClaw, this.leftClaw.__coxClench > 0 || this.leftClaw.__coxUnclenching ? ANIM.LEFT_CLAW_GRIP_CLENCHED : ANIM.LEFT_CLAW_GRIP);
    Shared.later(this.raid, 2, () => this.leftClaw?.isRegistered() && this.animate(this.objects.leftClaw, ANIM.LEFT_CLAW_DEFAULT));
  }

  onNpcDeath(npc) {
    if (npc === this.head) return this.defeated();
    if (npc !== this.leftClaw && npc !== this.rightClaw) return undefined;
    const left = npc === this.leftClaw;
    const parts = this.clawParts(left);
    this.animate(this.objects[parts.key], parts.fall);
    Shared.later(this.raid, TIMING.CLAW_CAVE, () => this.placeObject(parts.key, parts.gone, parts.tile));
    if (left) this.leftClaw = null;
    else {
      this.rightClaw = null;
      this.rightGone = true;
      if (this.leftClaw?.__coxClench > 2) {
        this.leftClaw.__coxClench = 2;
        this.leftClaw.__coxUnclenching = true;
      }
      Shared.later(this.raid, 4, () => this.gripLeftClaw());
    }
    const other = left ? this.rightClaw : this.leftClaw;
    if (other?.isRegistered() && !other.__coxDown) return undefined;
    if (this.fallen) {
      // Both down together in the last phase: the final stand.
      if (this.fallen.marker) this.removeNpc(this.fallen.marker);
      this.removeNpc(this.fallen.npc);
      this.fallen = null;
      if (left) this.rightClaw = null;
      else this.leftClaw = null;
    }
    if (this.isLastPhase()) return this.beginFinalStand();
    return this.switchSides();
  }

  /** rsprox captures: the message and the crystals 4 ticks after the second claw falls. */
  beginFinalStand() {
    if (this.head) this.head.__coxPointsMultiplier = 1;
    Shared.later(this.raid, TIMING.FINAL_STAND, () => {
      if (this.dead || this.raid.destroyed) return;
      for (const player of this.raiders()) player.sendMessage("The Great Olm is giving its all. This is its final stand.");
      this.fallingCrystals$ = this.transitionCrystals(Infinity, true);
    });
  }

  /** Where the sound of the head falling and rising comes from. */
  headSoundTile() {
    const { Location } = Shared.core();
    const at = this.objects.head.getLocation();
    return new Location(at.getX() + T.SIDES[this.side].soundShift, at.getY() + 2, 0);
  }

  /** The last claw down: the head falls 4 ticks later, goes at 6, crystals from 10, and it rises across the chamber at 38. */
  switchSides() {
    this.transitioning = true;
    Shared.later(this.raid, TIMING.HEAD_FALL, () => {
      this.animate(this.objects.head, ANIM.HEAD_FALL);
      Shared.areaSound(this.viewers(), 3405, this.headSoundTile(), { range: 15 });
    });
    Shared.later(this.raid, TIMING.HEAD_GONE, () => {
      const head = this.head;
      this.head = null;
      if (head) this.removeNpc(head);
      const side = T.SIDES[this.side];
      this.placeObject("head", OBJECT.HOLE, side.head);
      this.side = this.side === SIDE.LEFT ? SIDE.RIGHT : SIDE.LEFT;
    });
    Shared.later(this.raid, TIMING.CRYSTALS, () => this.transitionCrystals(TIMING.NEXT_RISE - TIMING.CRYSTALS, false));
    Shared.later(this.raid, TIMING.NEXT_RISE, () => {
      if (this.raid.destroyed) return;
      this.phase++;
      this.transitioning = false;
      this.rise();
    });
  }

  /**
   * Wiki: crystals fall around the chamber, 16-25 under, 10-16 beside, one always at a raider.
   * rsprox captures: every 2 ticks, one at a raider then one in each third of the chamber (two each
   * with four raiders; recording 820), landing 3 ticks later.
   */
  transitionCrystals(duration, finalStand) {
    const each = this.raiders().length >= 4 ? 2 : 1;
    const state = { stopped: false };
    const { Location, Projectile, RegionManager } = Shared.core();
    const centre = new Location(this.x(T.CENTRE[0]), this.y(T.CENTRE[1]), 0);
    const fall = (tile) => {
      const from = new Location(tile.getX() + Shared.randomOf([-1, 0, 1]), tile.getY() + Shared.randomOf([-1, 1]), 0);
      new Projectile(from, tile, null, 1357, 0, 120, 250, 0, this.map).withAngle(10).withProgress(64).sendProjectile();
      Shared.graphicAt(this.viewers(), 1447, tile);
      Shared.later(this.raid, 3, () => {
        if (this.raid.destroyed || this.dead) return;
        Shared.graphicAt(this.viewers(), 1358, tile, { height: 20 });
        Shared.areaSound(this.viewers(), 1021, tile, { range: 4 });
        for (const player of this.raiders()) {
          const distance = player.getLocation().getDistance(tile);
          if (distance === 0) Shared.damage(player, Shared.random(16, 25));
          else if (distance === 1) Shared.damage(player, Shared.random(10, 16));
        }
      });
    };
    const inThird = (third) => {
      const floor = this.y(T.FIRE_SOUTH_Y);
      for (let tries = 0; tries < 20; tries++) {
        const tile = new Location(Shared.random(this.x(T.FIRE_WEST_X), this.x(T.FIRE_EAST_X)), floor + third * 6 + Shared.random(0, 5), 0);
        if (!RegionManager.blocked(tile, this.map)) return tile;
      }
      return null;
    };
    let ticks = 0;
    let atRaider = finalStand;
    const volley = () => {
      if (this.raid.destroyed || state.stopped || this.dead || ticks > duration) return false;
      ticks += 2;
      if (!finalStand) Shared.areaSound(this.viewers(), 3834, centre, { range: 15 });
      if (atRaider) {
        const raider = Shared.randomOf(this.raiders());
        if (raider) fall(raider.getLocation().clone());
      } else {
        for (let third = 0; third < 3; third++) {
          for (let i = 0; i < each; i++) {
            const tile = inThird(third);
            if (tile) fall(tile);
          }
        }
      }
      atRaider = !atRaider;
      return true;
    };
    if (volley()) Shared.repeat(this.raid, 2, volley);
    return state;
  }

  /** rsprox captures: it falls at once; at 2 the exit's crystal shatters, at 3 the raid completes, at 6 the chest and the open exit. */
  defeated() {
    if (this.dead) return;
    this.dead = true;
    if (this.fallingCrystals$) this.fallingCrystals$.stopped = true;
    this.animate(this.objects.head, ANIM.HEAD_FALL);
    Shared.areaSound(this.viewers(), 3405, this.headSoundTile(), { range: 15 });
    this.completeAchievements();
    const { Animation, GameObject, Location, ObjectManager } = Shared.core();
    const exit = this.map.getTemplateObjects(this.t(...T.EXIT_CRYSTAL)).find((object) => object.getId() === OBJECT.EXIT_CRYSTAL);
    Shared.later(this.raid, 2, () => {
      this.placeObject("head", OBJECT.HOLE, T.SIDES[this.side].head);
      for (const player of this.raid.players) {
        player.sendMessage("As the Great Olm collapses, the crystal blocking your exit has been shattered.");
        if (exit) player.getPacketSender().sendObjectAnimation(exit, new Animation(7506));
      }
      if (!exit) return;
      const at = exit.getLocation();
      Shared.areaSound(this.viewers(), 1021, at);
      Shared.areaSound(this.viewers(), 3821, at, { delay: 5 });
      Shared.graphicAt(this.viewers(), 1337, new Location(at.getX() + 1, at.getY() + 2, 0), { delay: 5 });
    });
    Shared.later(this.raid, 3, () => {
      for (const player of this.raid.players) player.getPacketSender().sendJingle?.(152, 0);
      this.raid.complete?.();
    });
    Shared.later(this.raid, 6, () => {
      const chest = this.map.getTemplateObjects(this.t(...T.CHEST)).find((object) => object.getId() === OBJECT.CHEST_CRYSTAL);
      if (chest) Shared.replaceObject(this.map, chest, OBJECT.CHEST);
      if (!exit) return;
      const at = exit.getLocation();
      ObjectManager.deregister(exit, true);
      for (let dx = 0; dx < 2; dx++) {
        for (let dy = 0; dy < 2; dy++) ObjectManager.register(new GameObject(OBJECT.EXIT_OPEN, new Location(at.getX() + dx, at.getY() + dy, at.getZ()), 10, 0, this.map), true);
      }
    });
  }

  /** The Combat Achievements its death decides; a solo or trio raid is by the raid's scale. */
  completeAchievements() {
    const { players, scale } = this.raid;
    if (this.perfect && scale === 1) Achievements.complete([...players], "Perfect Olm (Solo)");
    if (this.perfect && scale === 3) Achievements.complete([...players], "Perfect Olm (Trio)");
    if (this.noLastPhaseSpecials && scale === 1) Achievements.complete([...players], "A Not So Special Lizard");
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

/** The Olm's room when this NPC is a burning fire wall; false when the player is out of the chamber. */
function fireRoomOf(npc, player) {
  const room = npc?.__coxRoom;
  if (!(room instanceof OlmRoom) || !npc.__coxFireWall) return null;
  if (room.inChamber(player.getLocation())) return room;
  player.sendMessage("You can't reach that.");
  return false;
}

/** The Fire's own op1, Douse (cache; how all 8 captured douses are done). Its cache name has a colour, so it is found by its flag. */
function douseFire(event) {
  const room = fireRoomOf(event.npc, event.player);
  if (room === null) return;
  event.handled = true;
  if (room) room.douse(event.player, event.npc);
}

/** Wiki: vessels of water douse too, here by using them on the flame as well as by its option. */
function vesselOnFire(event) {
  if (event.itemId !== WATER_GOURD && !WATERING_CANS.includes(event.itemId)) return;
  const room = fireRoomOf(event.target, event.player);
  if (room === null) return;
  event.handled = true;
  if (room) room.douse(event.player, event.target, event.itemId);
}

/** Wiki: water and ice spells douse, so one aimed straight at the flame does too, as a normal cast. */
function spellOnFire(event) {
  const room = fireRoomOf(event.npc, event.player);
  if (room === null) return;
  event.handled = true;
  if (!room) return;
  const { CombatSpells } = Shared.core();
  if (!DOUSING_SPELLS.some((name) => CombatSpells.getCombatSpellByName(name) === event.spell)) {
    event.player.sendMessage("Only water, ice spells or humidify can douse this flame!");
    return;
  }
  if (!event.consumeRunes()) return;
  Shared.areaSound(room.viewers(), 1876, event.npc.getLocation(), { delay: 60 });
  room.extinguish(event.player, event.npc);
}

/** Wiki (2019): the flames can be reached from a distance. */
function reachFire(event) {
  if (event.npc?.__coxFireWall && event.clickType === 1) event.range = DOUSE_REACH;
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
  api.onNpcInteraction(douseFire);
  api.onNpcRoute(reachFire);
  api.onItemOnNpc(vesselOnFire);
  api.onSpellOnNpc(spellOnFire);
  Raid.onRaidArea("canAttack", outOfReach);
  api.registerNpcCombatMethodProvider([NPC.HEAD, NPC.LEFT_CLAW, NPC.RIGHT_CLAW, NPC.FIRE], olmCombat(api));
};

Object.assign(module.exports, { OlmRoom, SEQUENCE, LAST_SEQUENCE });
