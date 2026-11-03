"use strict";

/**
 * The arena itself: an Area on plane 3 so only players in it pay for the work. The obstacles
 * with no click option (floor spikes, pressure pads, spinning blades, the darts) are walked into:
 * a player who ends a tick on a trap span's tile is carried over the whole span in one go, the
 * way they were heading, and paid the obstacle's XP once (rsprox 1735, 1738, 4308, 75).
 */

const Shared = require("./Shared.BrimhavenAgilityArena");
const ObstacleRunner = require("../../skills/agility/ObstacleRunner.Agility");

/** The trap jump: anim 1115 with a 30-49 cycle exact move over the span (rsprox 1735, 4308). */
const TRAP_JUMP = { ANIM: 1115, DELAY: 20, SPEED: [30, 49] };
/** Sounds as captured: pad 1379, spikes 1381, blades 1377 then 2469 (rsprox 1735, 4308, 75). */
const JUMP_SOUND = { PRESSURE_PAD: 1379, FLOOR_SPIKES: 1381, SPINNING_BLADES: 1377 };
const BLADES_AFTER_SOUND = 2469;
/** Knocked back a tile: blades 1114 delay 11 (rsprox 4308), darts 1114 delay 25 (rsprox 1735). */
const KNOCKBACK = { ANIM: 1114, BLADES_DELAY: 11, DARTS_DELAY: 25, BLADES_SPEED: [30, 60], DARTS_SPEED: [44, 74] };
const BLADES_HIT_SOUND = 1376;
const DARTS_HIT_SOUND = 1382;
/** The dodge: sound 1378, then anim 1110 (delay 70) and five ticks' wait (rsprox 1735, 1738). */
const DART_DODGE = { SOUND: 1378, ANIM: 1110, DELAY: 70, HOLD: 5 };

function createArea() {
  const { Area, Boundary } = Shared.core();
  class BrimhavenAgilityArena extends Area {
    process(mobile) {
      processPlayer(mobile);
    }

    postEnter(mobile) {
      if (!mobile.isPlayer()) return;
      const player = mobile.getAsPlayer();
      const state = Shared.stateOf(player);
      state.lastTile = null;
      state.lastAt = null;
      Shared.sendArrow(player);
    }

    postLeave(mobile) {
      if (!mobile.isPlayer()) return;
      const player = mobile.getAsPlayer();
      // The tag lock outlives a visit: only logout clears it. The arrow does not.
      const state = Shared.stateOf(player);
      state.lastTile = null;
      state.lastAt = null;
      player.getPacketSender().clearHintArrow?.();
    }
  }
  return new BrimhavenAgilityArena([
    new Boundary(Shared.ARENA.minX, Shared.ARENA.maxX, Shared.ARENA.minY, Shared.ARENA.maxY, Shared.ARENA_PLANE),
  ]);
}

/** Checks the tile the player ended the tick on; a trap span sets off its obstacle once. */
function processPlayer(mobile) {
  if (!mobile.isPlayer()) return;
  const player = mobile.getAsPlayer();
  const at = player.getLocation();
  const key = Shared.tileKey(at.getX(), at.getY());
  const state = Shared.stateOf(player);
  if (state.lastTile === key) return;
  const previous = state.lastAt;
  state.lastTile = key;
  state.lastAt = { x: at.getX(), y: at.getY() };
  if (at.getZ() !== Shared.ARENA_PLANE || ObstacleRunner.isBusy(player)) return;
  const span = Shared.trapSpanAt(at.getX(), at.getY());
  if (span) stepTrap(player, span, previous);
}

/**
 * Which way along the span the player is going: from the tile they came from, or, entering it
 * from the side, away from the nearer end.
 */
function heading(span, at, previous) {
  const along = span.axis === "x" ? at.x : at.y;
  if (previous) {
    const before = span.axis === "x" ? previous.x : previous.y;
    if (before !== along) return Math.sign(along - before);
  }
  return along - span.from <= span.to - along ? 1 : -1;
}

function spanTile(span, along) {
  return span.axis === "x" ? [along, span.at] : [span.at, along];
}

/** The jump, knock-back or dart dodge for a trap, as rsprox captured each. */
function trapSteps(player, span, outcome, dir) {
  const at = player.getLocation();
  const z = at.getZ();
  const along = span.axis === "x" ? at.getX() : at.getY();
  const past = spanTile(span, dir > 0 ? span.to + 1 : span.from - 1);
  const back = spanTile(span, along - dir);
  // Traps go off the tick after the player stops on them.
  const steps = [{ wait: 1 }];
  if (span.kind === "DARTS") {
    if (outcome === "pass") {
      const next = spanTile(span, dir > 0 ? span.to : span.from);
      const walk = next[0] === at.getX() && next[1] === at.getY() ? [past] : [next, past];
      steps.push(
        { sound: DART_DODGE.SOUND }, { wait: 1 },
        { anim: DART_DODGE.ANIM, delay: DART_DODGE.DELAY }, { wait: DART_DODGE.HOLD },
        { walk },
      );
    } else {
      steps.push(
        { sound: DARTS_HIT_SOUND },
        { move: [...back, z], anim: KNOCKBACK.ANIM, delay: KNOCKBACK.DARTS_DELAY, speed: KNOCKBACK.DARTS_SPEED, ticks: 1 },
        { wait: 1 },
        { msg: { spam: Shared.DARTS_FAIL_MESSAGE } },
        { run: () => {
          Shared.hit(player, Shared.trapDamage(player.getHitpoints()));
          Shared.drainAgility(player, 2);
        } },
      );
    }
    return steps;
  }
  if (outcome === "fail" && span.kind === "SPINNING_BLADES") {
    steps.push(
      { move: [...back, z], anim: KNOCKBACK.ANIM, delay: KNOCKBACK.BLADES_DELAY, speed: KNOCKBACK.BLADES_SPEED, ticks: 1 },
      { msg: { spam: Shared.BLADES_FAIL_MESSAGE } },
      { sound: BLADES_HIT_SOUND },
      { wait: 1 },
      { run: () => Shared.hit(player, Shared.trapDamage(player.getHitpoints())) },
    );
    return steps;
  }
  if (outcome === "fail") {
    // ponytail: no capture shows a spike or pad failing (the captured players were 73-77); the
    // hit is the Wiki's, the player stays put and walks on.
    steps.push({ run: () => Shared.hit(player, Shared.trapDamage(player.getHitpoints())) });
    return steps;
  }
  steps.push({ sound: JUMP_SOUND[span.kind], delay: 20 });
  if (span.kind === "SPINNING_BLADES") {
    // XP lands three ticks after the jump (rsprox 4308 2177 -> 2180).
    steps.push(
      { move: [...past, z], anim: TRAP_JUMP.ANIM, delay: TRAP_JUMP.DELAY, speed: TRAP_JUMP.SPEED, ticks: 1 },
      { sound: BLADES_AFTER_SOUND, delay: 30 },
      { wait: 2 },
    );
  } else {
    // Spikes and pads: XP two ticks after the jump (rsprox 1735 350 -> 352).
    steps.push({ move: [...past, z], anim: TRAP_JUMP.ANIM, delay: TRAP_JUMP.DELAY, speed: TRAP_JUMP.SPEED, ticks: 2 });
  }
  return steps;
}

/**
 * Rolls a trap and plays it. Below the obstacle's level the player is told and walks on. The
 * pressure pads pay twice in a row, then nothing for eight ticks (Wiki, 2024); they still jump.
 */
function stepTrap(player, span, previous = null) {
  const kind = span.kind;
  const state = Shared.stateOf(player);
  const requirement = Shared.OBSTACLE_LEVEL[kind];
  const level = Shared.agilityLevel(player);
  if (level < requirement) {
    player.sendMessage(Shared.levelRefusal(requirement));
    return null;
  }
  let pays = true;
  if (kind === "PRESSURE_PAD") {
    if (Shared.cycle.tick < state.padCooldownUntil) {
      pays = false;
    } else {
      state.padUses = (state.lastTrap === kind ? state.padUses : 0) + 1;
      if (state.padUses >= Shared.PRESSURE_PAD_USES) {
        state.padUses = 0;
        state.padCooldownUntil = Shared.cycle.tick + Shared.PRESSURE_PAD_COOLDOWN_TICKS;
      }
    }
  }
  state.lastTrap = kind;
  const outcome = rollTrap(kind, level) ? "pass" : "fail";
  const at = player.getLocation();
  const dir = heading(span, { x: at.getX(), y: at.getY() }, previous);
  const context = { player, core: Shared.core(), pos: { x: at.getX(), y: at.getY(), z: at.getZ() } };
  ObstacleRunner.run(context, trapSteps(player, span, outcome, dir), {
    onFinish: (completed) => {
      if (completed && outcome === "pass" && pays) Shared.addObstacleXp(player, kind);
    },
  });
  return outcome;
}

/**
 * The darts and blades use the Wiki's success charts. Floor spikes stop failing at 50 (Wiki);
 * `ponytail:` below that, and for the pads, the Wiki has no chart, so the darts chart stands in.
 */
function rollTrap(kind, level) {
  // No obstacle fails at 99 (Wiki, 23 February 2017).
  if (level >= 99) return true;
  if (kind === "SPINNING_BLADES") {
    return Shared.roll(Shared.successChance(Shared.BLADES_SUCCESS.low, Shared.BLADES_SUCCESS.high, level));
  }
  if (kind === "FLOOR_SPIKES" && level >= Shared.FLOOR_SPIKES_NEVER_FAIL) return true;
  return Shared.roll(Shared.successChance(Shared.DARTS_SUCCESS.low, Shared.DARTS_SUCCESS.high, level));
}

module.exports = (api) => {
  api.registerArea(createArea());
};
module.exports.createArea = createArea;
module.exports.processPlayer = processPlayer;
module.exports.stepTrap = stepTrap;
module.exports.trapSteps = trapSteps;
module.exports.heading = heading;
module.exports.rollTrap = rollTrap;
