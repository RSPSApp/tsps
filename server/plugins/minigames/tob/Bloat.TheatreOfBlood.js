"use strict";

/**
 * Wave 2: the Pestilent Bloat.
 *
 * Wiki ("Theatre of Blood/Strategies", Pestilent Bloat; Pestilent Bloat):
 * - It walks a fixed loop round the central tank. While it walks, flies hit everyone in its
 *   line of sight for up to 20 every tick (Protect from Missiles takes off 25%), and damage
 *   dealt to it is halved.
 * - It walks for 34-42 ticks (38-46 at first; four more if nobody hit it during the last
 *   rest; at least 5 after turning round), then shuts down for 32 ticks. On the 30th it
 *   stomps for 40-80 and its Defence comes back.
 * - It can turn round, at most once every 32 ticks of walking.
 * - Below 90%, hands fall from the ceiling while it walks, marked by shadows, for 30-50 and a
 *   stun. Between 40% and 60% it runs; below 40% it switches between walking and running each
 *   time it's hit.
 * Cache: the Bloat (8359, size 5) and the room. RuneLite (gameval): its animations (8082
 * asleep, 8083/8084 flies) and graphics (1568/1569 flies, 1570-1573 falling flesh, 1575 the
 * stun).
 * Captured: the flies (1568 at the player, 1569 the small ones) landing a tick after they
 * leave. Estimates: the loop's corners, the flies spreading to players next to the one hit,
 * sixteen hands a volley every five ticks landing three ticks after their shadows, the stun's
 * length and the odds of turning round.
 */

const Shared = require("./TobShared");
const Raid = require("./TobRaid");

const BLOAT = 8359;
/** The loop's corners (south-west tiles), walked NW -> SW -> SE -> NE (estimate). */
const CORNERS = [{ x: 3288, y: 4451 }, { x: 3288, y: 4440 }, { x: 3299, y: 4440 }, { x: 3299, y: 4451 }];
const START = { x: 3299, y: 4445, z: 0 };
/** The floor round the tank, where hands can fall. */
const FLOOR = { minX: 3288, maxX: 3303, minY: 4440, maxY: 4455, tank: { minX: 3293, maxX: 3298, minY: 4445, maxY: 4450 } };

const ANIMATION = { ASLEEP: 8082, FLIES: 8083 };
const GRAPHIC = { FLIES: 1568, FLY_IMPACT: 1569, FLESH: [1570, 1571, 1572, 1573], STUNNED: 1575 };
/** As captured: the flies land a tick after they leave, whatever the distance. */
const FLIES_PROJECTILE = { delay: 0, duration: 30, perTile: 0, startHeight: 0, endHeight: 0, angle: 0, progress: 12 };

const WALK = { first: [38, 46], later: [34, 42], unhit: 4, afterTurn: 5 };
const SLEEP = { ticks: 32, stomp: 30, min: 40, max: 80 };
const TURN = { cooldown: 32, chance: 0.05 };
const FLIES = { max: 20, protected: 0.75 };
const HANDS = { below: 0.9, count: 16, every: 5, landAfter: 3, min: 30, max: 50, stun: 5 };

function inFloor(tile) {
  const { tank } = FLOOR;
  return tile.x >= FLOOR.minX && tile.x <= FLOOR.maxX && tile.y >= FLOOR.minY && tile.y <= FLOOR.maxY
    && !(tile.x >= tank.minX && tile.x <= tank.maxX && tile.y >= tank.minY && tile.y <= tank.maxY);
}

class BloatRoom extends Raid.Room {
  onBuild() {
    this.bloat = this.spawn(BLOAT, START, { scripted: true });
    if (!this.bloat) return;
    this.state = { asleep: false, walkLeft: Shared.random(...WALK.first), sleepTicks: 0, turnCooldown: TURN.cooldown,
      sinceTurn: 99, corner: 3, reverse: false, hitWhileAsleep: true, running: false, handTicks: 0, hands: null };
    this.headTo(CORNERS[3]);
  }

  healthBar() {
    const bloat = this.bloat;
    return bloat ? { current: Math.max(0, bloat.getHitpoints()), maximum: bloat.getMaxHitpoints() } : null;
  }

  onComplete() {
    this.state = null;
  }

  /** Damage dealt to it while it walks is halved (Raid.* calls this from the hit hook). */
  modifyHit(npc, hit) {
    if (npc !== this.bloat || !this.state || this.state.asleep) return;
    for (const part of hit.getHits?.() ?? []) part.setDamage(Math.floor(part.getDamage() / 2));
    hit.updateTotalDamage?.();
    const share = npc.getHitpoints() / Math.max(1, npc.getMaxHitpoints());
    if (share < 0.4) this.state.running = !this.state.running;
  }

  onHitWhileAsleep() {
    if (this.state) this.state.hitWhileAsleep = true;
  }

  tick() {
    const bloat = this.bloat;
    if (!bloat) return;
    if (bloat.getHitpoints() <= 0) {
      if (this.isStarted()) this.complete();
      return;
    }
    const state = this.state;
    if (!state) return;
    if (state.asleep) {
      this.tickAsleep();
      return;
    }
    this.walk();
    if (!this.isStarted()) return;
    this.flies();
    this.tickHands();
    if (--state.walkLeft <= 0 && state.sinceTurn >= WALK.afterTurn) this.fallAsleep();
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
    bloat.setMovementSteps?.(runs ? 2 : 1);
    state.sinceTurn++;
    if (this.isStarted() && --state.turnCooldown <= 0 && Math.random() < TURN.chance) {
      state.turnCooldown = TURN.cooldown;
      state.sinceTurn = 0;
      state.reverse = !state.reverse;
      state.corner = (state.corner + (state.reverse ? 1 : 3)) % 4;
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

  /** Everyone it can see takes up to 20; those standing beside them are bitten too. */
  flies() {
    const bloat = this.bloat;
    const players = this.fighters();
    const seen = players.filter((player) => Shared.lineOfSight(bloat, player, this.area));
    if (seen.length === 0) return;
    const { Animation } = Shared.core();
    bloat.performAnimation(new Animation(ANIMATION.FLIES));
    const bitten = new Set(seen);
    for (const player of seen) {
      for (const other of players) {
        if (other !== player && Shared.distanceTo(player, other.getLocation()) <= 1) bitten.add(other);
      }
    }
    for (const player of bitten) {
      const ticks = Shared.projectile(this.area, bloat, player, GRAPHIC.FLIES, FLIES_PROJECTILE);
      const damage = Shared.random(1, FLIES.max);
      this.later(Math.max(0, ticks - 1), () => {
        if (player.getHitpoints() <= 0) return;
        player.performGraphic(Shared.gfx(GRAPHIC.FLY_IMPACT));
        Shared.damage(player, Shared.isProtected(player, "ranged") ? Math.floor(damage * FLIES.protected) : damage);
      });
    }
  }

  // -------------------------------------------------------------- sleeping

  fallAsleep() {
    const { Animation } = Shared.core();
    const state = this.state;
    state.asleep = true;
    state.sleepTicks = 0;
    state.hitWhileAsleep = false;
    state.hands = null;
    const bloat = this.bloat;
    bloat.getMovementQueue().reset();
    bloat.performAnimation(new Animation(ANIMATION.ASLEEP));
  }

  /** It lies still for 32 ticks; on the 30th it stomps everyone it can see. */
  tickAsleep() {
    const state = this.state;
    state.sleepTicks++;
    if (state.sleepTicks === SLEEP.stomp) {
      for (const player of this.fighters()) {
        if (Shared.lineOfSight(this.bloat, player, this.area)) Shared.damage(player, Shared.random(SLEEP.min, SLEEP.max));
      }
      Shared.restoreDefence(this.bloat);
    }
    if (state.sleepTicks < SLEEP.ticks) return;
    state.asleep = false;
    state.walkLeft = Shared.random(...WALK.later) + (state.hitWhileAsleep ? 0 : WALK.unhit);
    this.headTo(CORNERS[state.corner]);
  }

  // -------------------------------------------------------------- falling hands

  /** Below 90%, while it walks: shadows, then three ticks later the hands land. */
  tickHands() {
    const state = this.state;
    const bloat = this.bloat;
    if (bloat.getHitpoints() / Math.max(1, bloat.getMaxHitpoints()) >= HANDS.below) return;
    state.handTicks++;
    if (state.hands && state.handTicks === HANDS.landAfter) this.landHands(state.hands);
    if (state.handTicks < HANDS.every) return;
    state.handTicks = 0;
    const tiles = new Map();
    for (let tries = 0; tiles.size < HANDS.count && tries < HANDS.count * 20; tries++) {
      const tile = { x: Shared.random(FLOOR.minX, FLOOR.maxX), y: Shared.random(FLOOR.minY, FLOOR.maxY), z: 0 };
      if (inFloor(tile) && !(state.lastHands ?? []).some((last) => last.x === tile.x && last.y === tile.y)) tiles.set(`${tile.x},${tile.y}`, tile);
    }
    state.hands = [...tiles.values()];
    state.lastHands = state.hands;
    for (const tile of state.hands) Shared.graphicAt(this.area, Shared.randomOf(GRAPHIC.FLESH), tile);
  }

  landHands(tiles) {
    const { TimerKey } = Shared.core();
    for (const player of this.fighters()) {
      const at = Shared.tileOf(player);
      if (!tiles.some((tile) => tile.x === at.x && tile.y === at.y)) continue;
      Shared.damage(player, Shared.random(HANDS.min, HANDS.max));
      player.performGraphic(Shared.gfx(GRAPHIC.STUNNED, { height: 92 }));
      player.getTimers?.().registers?.(TimerKey.STUN, HANDS.stun);
      player.getMovementQueue().reset();
    }
  }
}

module.exports = function registerBloat(api) {
  Shared.bind(api);
  Raid.registerRoom("BLOAT", BloatRoom);
};

Object.assign(module.exports, { BloatRoom, CORNERS, inFloor });
