"use strict";

/**
 * Wave 2: the Pestilent Bloat.
 *
 * Wiki ("Theatre of Blood/Strategies", Pestilent Bloat; Pestilent Bloat):
 * - It walks a fixed loop round the central tank, its first direction random. While it walks,
 *   flies hit everyone in its line of sight for 10-20 every tick (Protect from Missiles takes off
 *   25%) and spread to players those can see; damage dealt to it is halved.
 * - It walks for 34-42 ticks (38-46 at first; four more if nobody hit it during the last
 *   rest; at least 5 after turning round or changing speed), then shuts down for 32 ticks. On
 *   the 30th it stomps for 40-80 and its Defence comes back.
 * - It can turn round, at most once every 32 ticks of walking (16 in Hard Mode).
 * - Below 90%, hands fall from the ceiling while it walks, marked by shadows, for 30-50 and a
 *   stun; in Hard Mode they fall from the fight's start, even while it rests. Between 40% and
 *   60% it runs; below 40% it switches between walking and running each time it's hit.
 * - Entry Mode: flies up to 8, the stomp up to 40.
 * Cache: the Bloat by mode (BLOATS, size 5) and the room. RuneLite (gameval): its animations
 * (8082 asleep, 8085 dying) and graphics (1570-1573 falling flesh, 1575 the stun).
 * Captured (rsprox 1852, 1764, 101, 554): the loop's corners, its first walk counting from the
 * fight's start, the flies (1568 to those it sees, 1569 from them to the others, up to 6 tiles
 * apart), landing a tick after they leave with a sound of six at the victim, no animation of its
 * own; sixteen hands a volley, 3 ticks to landing (1576 and sound 3308 on each tile), a volley
 * every 6 ticks, the first on waking or at a Hard Mode fight's start; the stomp's sound 3752; the
 * stun graphic's height; its death (3 ticks, the wave ending as it vanishes).
 * Fits: volleys every 4 ticks below 30% (the change comes at a bar of 28-33% in 3 raids); the
 * odds of turning once able (1 in 10, 5 samples; 1 in 4 in Hard Mode, 6 samples). Estimates: the
 * stun's length, Entry Mode's lowest hits and hands (half of Normal's).
 */

const Shared = require("./Shared.TheatreOfBlood");
const Raid = require("./RaidState.TheatreOfBlood");

/** Per mode, from the cache and captures (101, 554 Entry; 1852 Hard). */
const BLOATS = { entry: 10812, normal: 8359, hard: 10813 };
const BLOAT = BLOATS.normal;
/** The loop's corners (south-west tiles), walked NW -> SW -> SE -> NE (captured). */
const CORNERS = [{ x: 3288, y: 4451 }, { x: 3288, y: 4440 }, { x: 3299, y: 4440 }, { x: 3299, y: 4451 }];
/** Halfway up the east side; the captures first see it there, walking either way. */
const START = { x: 3299, y: 4445, z: 0 };
const START_CORNER = { forward: 3, reverse: 2 };
/** The floor round the tank, where hands can fall. */
const FLOOR = { minX: 3288, maxX: 3303, minY: 4440, maxY: 4455, tank: { minX: 3293, maxX: 3298, minY: 4445, maxY: 4450 } };
/** Its size is 5: the stomp's sound comes from here (captured). */
const CENTRE_OFFSET = 2;

const ANIMATION = { ASLEEP: 8082, DYING: 8085 };
const GRAPHIC = { FLIES: 1568, FLIES_SPREAD: 1569, FLESH: [1570, 1571, 1572, 1573], HAND_LANDED: 1576, STUNNED: 1575 };
const SOUND = { FLIES: [3954, 3544, 3983, 3945, 4016, 3951], HAND_LANDED: 3308, STOMP: 3752 };
/** A hand's sound carries this far (captured radius). */
const HAND_SOUND_RADIUS = 6;
/** As captured: the flies land a tick after they leave, whatever the distance. */
const FLIES_PROJECTILE = { delay: 0, duration: 30, perTile: 0, startHeight: 0, endHeight: 0, angle: 0, progress: 12 };

const WALK = { first: [38, 46], later: [34, 42], unhit: 4, afterTurn: 5 };
const SLEEP = { entry: { ticks: 32, stomp: 30, min: 20, max: 40 }, normal: { ticks: 32, stomp: 30, min: 40, max: 80 } };
const TURN = { entry: { cooldown: 32, chance: 0.1 }, normal: { cooldown: 32, chance: 0.1 }, hard: { cooldown: 16, chance: 0.25 } };
const FLIES = { entry: { min: 4, max: 8, protected: 0.75 }, normal: { min: 10, max: 20, protected: 0.75 } };
const HANDS = { below: 0.9, count: 16, every: 6, fasterBelow: 0.3, everyFaster: 4, landAfter: 3, stun: 5 };
const HAND_DAMAGE = { entry: { min: 15, max: 25 }, normal: { min: 30, max: 50 } };
const DEATH_TICKS = 3;
const STUN_GRAPHIC_HEIGHT = 124;
/** Personal Space's least team, Two-Down's third shutdown (Wiki). */
const PERSONAL_SPACE_PLAYERS = 3;
const TWO_DOWN_SHUTDOWNS = 3;
const SALVE = /salve amulet/i;
const CHALLY = /crystal halberd/i;
const TASK = { CHALLY: "Chally Time", TOOLS: "Appropriate Tools", EXPECT: "They Won't Expect This", PERFECT: "Perfect Bloat", TWO_DOWN: "Two-Down", SPACE: "Personal Space" };

function inFloor(tile) {
  const { tank } = FLOOR;
  return tile.x >= FLOOR.minX && tile.x <= FLOOR.maxX && tile.y >= FLOOR.minY && tile.y <= FLOOR.maxY
    && !(tile.x >= tank.minX && tile.x <= tank.maxX && tile.y >= tank.minY && tile.y <= tank.maxY);
}

class BloatRoom extends Raid.Room {
  onBuild() {
    this.killingBlow = null;
    const reverse = Math.random() < 0.5;
    const face = Shared.facing(reverse ? "SOUTH" : "NORTH");
    this.bloat = this.spawn(Shared.byMode(this.raid, BLOATS), START, { scripted: true, face });
    if (!this.bloat) return;
    const corner = reverse ? START_CORNER.reverse : START_CORNER.forward;
    this.state = { asleep: false, walkLeft: Shared.random(...WALK.first), sleepTicks: 0, turnCooldown: Shared.byMode(this.raid, TURN).cooldown,
      sinceTurn: 99, corner, reverse, hitWhileAsleep: true, running: false, runs: false, handTicks: 0, shutdowns: 0, dying: false };
    this.headTo(CORNERS[corner]);
  }

  healthBar() {
    const bloat = this.bloat;
    return bloat ? { current: Math.max(0, bloat.getHitpoints()), maximum: bloat.getMaxHitpoints() } : null;
  }

  /** Its hitpoints running out starts its death; the wave ends as it vanishes (captured). */
  holdsOn(npc) {
    return npc === this.bloat && this.isStarted();
  }

  /** Entering by the west barrier, the far side from the party's arrival. */
  enterFight(player, side) {
    super.enterFight(player, side);
    if (side.x < FLOOR.minX) this.raid.completeTask(TASK.EXPECT, [player]);
  }

  /** Raid.* calls this from the hit hook: damage is halved while it walks. */
  modifyHit(npc, hit) {
    const state = this.state;
    if (npc !== this.bloat || !state) return;
    if (state.asleep) {
      state.hitWhileAsleep = true;
    } else {
      for (const part of hit.getHits?.() ?? []) part.setDamage(Math.floor(part.getDamage() / 2));
      hit.updateTotalDamage?.();
      if (npc.getHitpoints() / Math.max(1, npc.getMaxHitpoints()) < 0.4) state.running = !state.running;
    }
    if (!this.killingBlow && npc.getHitpoints() > 0 && hit.getTotalDamage?.() >= npc.getHitpoints()) this.killingBlow = this.judgeBlow(hit);
  }

  /** Who landed the kill, and whether as a crystal halberd's special attack (a special's own method). */
  judgeBlow(hit) {
    const { Equipment, CombatFactory } = Shared.core();
    const attacker = hit.getAttacker?.();
    const weapon = attacker?.isPlayer?.() ? attacker.getEquipment().getItems()[Equipment.WEAPON_SLOT] : null;
    const halberd = CHALLY.test(weapon?.getDefinition?.()?.getName?.() ?? "");
    return { attacker, chally: halberd && hit.getCombatMethod?.() !== CombatFactory.MELEE_COMBAT };
  }

  tick() {
    const bloat = this.bloat;
    if (!bloat) return;
    const state = this.state;
    if (!state || state.dying) return;
    if (bloat.getHitpoints() <= 0) {
      if (this.isStarted()) this.die();
      return;
    }
    if (state.asleep) {
      this.tickAsleep();
    } else {
      this.walk();
      if (!this.isStarted()) return;
      this.flies();
    }
    this.tickHands();
    this.checkPersonalSpace();
    if (!state.asleep && --state.walkLeft <= 0 && state.sinceTurn >= WALK.afterTurn) this.fallAsleep();
  }

  die() {
    const { Animation } = Shared.core();
    const bloat = this.bloat;
    this.state.dying = true;
    bloat.getMovementQueue().reset();
    bloat.getMovementQueue().setBlockMovement(true);
    bloat.performAnimation(new Animation(ANIMATION.DYING));
    this.later(DEATH_TICKS, () => {
      this.despawn(bloat);
      this.bloat = null;
      this.complete();
    });
  }

  /** The tasks judged at the kill; captured with the wave's completion. The jailed count as absent. */
  judgeKill() {
    const { Equipment } = Shared.core();
    const raid = this.raid;
    for (const player of this.fighters()) {
      const amulet = player.getEquipment().getItems()[Equipment.AMULET_SLOT];
      if (!SALVE.test(amulet?.getDefinition?.()?.getName?.() ?? "")) {
        raid.failTask(TASK.TOOLS, `${Shared.displayName(player)} did not have a salve amulet equipped.`);
      }
    }
    if (this.killingBlow?.chally) raid.completeTask(TASK.CHALLY, [this.killingBlow.attacker]);
    else raid.failTask(TASK.CHALLY, "The killing blow was not your crystal halberd special attack.");
    const team = raid.players.filter((player) => raid.member(player).roomStats(this.key).fought);
    if (team.length < PERSONAL_SPACE_PLAYERS) raid.failTask(TASK.SPACE, `There were fewer than ${PERSONAL_SPACE_PLAYERS} people in the room.`);
  }

  onComplete() {
    this.state = null;
    this.judgeKill();
    for (const task of [TASK.TOOLS, TASK.PERFECT, TASK.TWO_DOWN, TASK.SPACE]) {
      if (this.raid.taskLive(task)) this.raid.completeTask(task);
    }
  }

  /** Personal Space: nobody on another's tile at any point of the fight. */
  checkPersonalSpace() {
    const tiles = new Map();
    for (const player of this.fighters()) {
      const at = Shared.tileOf(player);
      const tile = `${at.x},${at.y}`;
      const other = tiles.get(tile);
      if (other) this.raid.failTask(TASK.SPACE, `${Shared.displayName(player)} stood on top of ${Shared.displayName(other)}.`);
      tiles.set(tile, player);
    }
  }

  // -------------------------------------------------------------- walking

  headTo(corner) {
    Shared.walkStraight(this.bloat, { ...corner, z: 0 });
  }

  /** Corner to corner round the tank; running doubles the steps; now and then it turns. */
  walk() {
    const state = this.state;
    const bloat = this.bloat;
    const share = bloat.getHitpoints() / Math.max(1, bloat.getMaxHitpoints());
    const runs = share < 0.6 && (share >= 0.4 || state.running);
    state.sinceTurn++;
    if (runs !== state.runs) {
      state.runs = runs;
      state.sinceTurn = 0;
    }
    bloat.setMovementSteps?.(runs ? 2 : 1);
    const turn = Shared.byMode(this.raid, TURN);
    if (--state.turnCooldown <= 0 && this.isStarted() && Math.random() < turn.chance) {
      state.turnCooldown = turn.cooldown;
      state.sinceTurn = 0;
      state.reverse = !state.reverse;
      // Back to the corner it last left: one the other way round the loop from where it's heading.
      state.corner = (state.corner + (state.reverse ? 3 : 1)) % 4;
      this.headTo(CORNERS[state.corner]);
      return;
    }
    const at = Shared.tileOf(bloat);
    const target = CORNERS[state.corner];
    if (at.x === target.x && at.y === target.y) {
      state.corner = (state.corner + (state.reverse ? 3 : 1)) % 4;
      this.headTo(CORNERS[state.corner]);
    } else if (!bloat.getMovementQueue().hasRoute?.()) {
      this.headTo(target);
    }
  }

  // -------------------------------------------------------------- flies

  /** Everyone it can see takes them; from those, they spread to anyone those can see. */
  flies() {
    const bloat = this.bloat;
    const players = this.fighters();
    const seen = players.filter((player) => Shared.lineOfSight(bloat, player, this.area));
    if (seen.length === 0) return;
    for (const player of seen) this.biteFrom(bloat, player, GRAPHIC.FLIES);
    for (const other of players) {
      if (seen.includes(other)) continue;
      const from = seen.find((player) => Shared.lineOfSight(player, other, this.area));
      if (from) this.biteFrom(from, other, GRAPHIC.FLIES_SPREAD);
    }
  }

  biteFrom(source, player, graphic) {
    const flies = Shared.byMode(this.raid, FLIES);
    const ticks = Shared.projectile(this.area, source, player, graphic, FLIES_PROJECTILE);
    const damage = Shared.random(flies.min, flies.max);
    Shared.areaSound(this.area, player, Shared.randomOf(SOUND.FLIES));
    this.later(Math.max(0, ticks - 1), () => {
      if (player.getHitpoints() <= 0) return;
      Shared.damage(player, Shared.isProtected(player, "ranged") ? Math.floor(damage * flies.protected) : damage);
      this.raid.failTask(TASK.PERFECT, `${Shared.displayName(player)} was attacked by some flies.`);
    });
  }

  // -------------------------------------------------------------- sleeping

  fallAsleep() {
    const { Animation } = Shared.core();
    const state = this.state;
    state.asleep = true;
    state.sleepTicks = 0;
    state.hitWhileAsleep = false;
    const bloat = this.bloat;
    bloat.getMovementQueue().reset();
    bloat.performAnimation(new Animation(ANIMATION.ASLEEP));
    if (++state.shutdowns === TWO_DOWN_SHUTDOWNS) this.raid.failTask(TASK.TWO_DOWN, "The Pestilent Bloat shut down for the third time.");
  }

  /** It lies still for 32 ticks; on the 30th it stomps everyone it can see. */
  tickAsleep() {
    const state = this.state;
    const sleep = Shared.byMode(this.raid, SLEEP);
    state.sleepTicks++;
    if (state.sleepTicks === sleep.stomp) {
      const at = Shared.tileOf(this.bloat);
      Shared.areaSound(this.area, { x: at.x + CENTRE_OFFSET, y: at.y + CENTRE_OFFSET, z: at.z }, SOUND.STOMP);
      for (const player of this.fighters()) {
        if (!Shared.lineOfSight(this.bloat, player, this.area)) continue;
        Shared.damage(player, Shared.random(sleep.min, sleep.max));
        this.raid.failTask(TASK.PERFECT, `${Shared.displayName(player)} was hit by The Pestilent Bloat's stomp attack.`);
      }
      Shared.restoreDefence(this.bloat);
    }
    if (state.sleepTicks < sleep.ticks) return;
    state.asleep = false;
    state.walkLeft = Shared.random(...WALK.later) + (state.hitWhileAsleep ? 0 : WALK.unhit);
    // Outside Hard Mode, the first volley comes with the first step after waking (captured).
    if (!this.raid.isHard) state.handTicks = 2;
    this.headTo(CORNERS[state.corner]);
  }

  // -------------------------------------------------------------- falling hands

  /** Below 90% while it walks (Hard Mode: always): shadows, then three ticks later the hands. */
  tickHands() {
    const state = this.state;
    if (!this.isStarted()) return;
    const bloat = this.bloat;
    const share = bloat.getHitpoints() / Math.max(1, bloat.getMaxHitpoints());
    if (!this.raid.isHard && (state.asleep || share >= HANDS.below)) return;
    if (--state.handTicks > 0) return;
    state.handTicks = share < HANDS.fasterBelow ? HANDS.everyFaster : HANDS.every;
    const tiles = new Map();
    for (let tries = 0; tiles.size < HANDS.count && tries < HANDS.count * 20; tries++) {
      const tile = { x: Shared.random(FLOOR.minX, FLOOR.maxX), y: Shared.random(FLOOR.minY, FLOOR.maxY), z: 0 };
      if (inFloor(tile)) tiles.set(`${tile.x},${tile.y}`, tile);
    }
    const volley = [...tiles.values()];
    for (const tile of volley) Shared.graphicAt(this.area, Shared.randomOf(GRAPHIC.FLESH), tile);
    this.later(HANDS.landAfter, () => this.landHands(volley));
  }

  landHands(tiles) {
    if (!this.isStarted()) return;
    const { TimerKey } = Shared.core();
    for (const tile of tiles) Shared.graphicAt(this.area, GRAPHIC.HAND_LANDED, tile);
    const damage = Shared.byMode(this.raid, HAND_DAMAGE);
    for (const player of this.fighters()) {
      const at = Shared.tileOf(player);
      if (tiles.some((tile) => Math.max(Math.abs(tile.x - at.x), Math.abs(tile.y - at.y)) <= HAND_SOUND_RADIUS)) Shared.sound(player, SOUND.HAND_LANDED);
      if (!tiles.some((tile) => tile.x === at.x && tile.y === at.y)) continue;
      Shared.damage(player, Shared.random(damage.min, damage.max));
      player.performGraphic(Shared.gfx(GRAPHIC.STUNNED, { height: STUN_GRAPHIC_HEIGHT }));
      player.getTimers?.().registers?.(TimerKey.STUN, HANDS.stun);
      player.getMovementQueue().reset();
      this.raid.failTask(TASK.PERFECT, `${Shared.displayName(player)} was hit by a falling body part.`);
    }
  }
}

module.exports = function registerBloat(api) {
  Shared.bind(api);
  Raid.registerRoom("BLOAT", BloatRoom);
};

Object.assign(module.exports, { BloatRoom, BLOAT, BLOATS, CORNERS, inFloor });
