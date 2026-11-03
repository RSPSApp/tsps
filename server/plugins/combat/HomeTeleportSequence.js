"use strict";

/**
 * The home teleport cast, shared by the home teleports and the minigame teleports, as in OSRS
 * captures (docs/minigame-teleports.md). Tick 0 is the choice (the spell, or the minigame):
 *
 *   0  animation and graphic reset
 *   1  chalk circle: graphic 800, animation 4847, area sound 193
 *   7  sitting down: animation 4850, sound 196
 *  13  getting the book: graphic 802, animation 4853, sound 194
 *  17  reciting: graphic 803 (height -10), animation 4855, sound 195
 *  21  varbit busy 1; teleporting: graphic 804, animation 4857
 *  24  varbit busy 0; the teleport; animation and graphic reset
 *  25  animation reset again
 *
 * Until tick 21 the cast is interrupted by most actions (Wiki): walking or combat ends it,
 * and no cooldown starts. The cast never starts from a moving player in the first place.
 */

const BUSY_VARBIT = 12393;
const SOUND_RANGE = 4;
const LOCK_TICK = 21;
const LAND_TICK = 24;
const STEPS = new Map([
  [1, { graphic: 800, animation: 4847, sound: 193 }],
  [7, { animation: 4850, sound: 196 }],
  [13, { graphic: 802, animation: 4853, sound: 194 }],
  [17, { graphic: 803, height: -10, animation: 4855, sound: 195 }],
  [LOCK_TICK, { graphic: 804, animation: 4857 }],
]);

function graphic(core, id, height = 0) {
  const result = new core.Graphic(id);
  result.height = height;
  return result;
}

function reset(core, player) {
  player.performAnimation(core.Animation.DEFAULT_RESET_ANIMATION);
  player.performGraphic(graphic(core, -1));
}

function playStep(core, player, step) {
  if (step.graphic !== undefined) player.performGraphic(graphic(core, step.graphic, step.height ?? 0));
  // A graphic on the caster's tile rather than on the caster (map_anim), as Demonic Pacts' cast sends its own.
  if (step.mapGraphic !== undefined) core.World.sendLocalGraphics(step.mapGraphic, player.getLocation());
  player.performAnimation(new core.Animation(step.animation));
  if (step.sound !== undefined) {
    const at = player.getLocation();
    core.Sounds.playAreaSound({
      soundId: step.sound,
      x: at.getX(),
      y: at.getY(),
      level: at.getZ(),
      radius: SOUND_RANGE,
    });
  }
}

/** Walking, or fighting, interrupts the cast before its last ticks. */
function interrupted(core, player, start) {
  return (
    !player.getLocation().equals(start) ||
    player.getMovementQueue().size() > 0 ||
    core.CombatFactory.inCombat(player)
  );
}

/** The standard cast; a league's own animation set (LeagueAreaUnlocks) passes another. */
const DEFAULT_CAST = { steps: STEPS, lockTick: LOCK_TICK, landTick: LAND_TICK };

/** Enabled home teleport animations, a bitmask in the picker's bit order (varp 4560); bit 0 is the default. */
const TOGGLES_ATTRIBUTE = "home-teleport:animation-toggles";

/**
 * The unlockable animations by picker bit (CS2 7758) as { steps: [{ tick, animation, graphic? }], lockTick,
 * landTick }, chained from the cache's per-part sequences (each starts as the last ends); not from a capture.
 * Twisted (bit 4) has no per-part sequences in the cache, so it plays the standard cast.
 */
const COSMETIC_CASTS = new Map([
  [5, { // Trailblazer: league_trailblazer_home_teleport_human_1..6 and spotanim_2..6
    steps: [[1, 8798], [4, 8799, 1819], [7, 8801, 1820], [12, 8803, 1821], [17, 8805, 1822], [22, 8807, 1823]],
    lockTick: 22,
    landTick: 24,
  }],
  [6, { // Shattered Relics: league03_home_teleport_human_1..6 and spotanim_1..6
    steps: [[1, 9209, 2025], [4, 9210, 2026], [7, 9211, 2027], [10, 9212, 2028], [13, 9213, 2029], [16, 9214, 2030]],
    lockTick: 16,
    landTick: 19,
  }],
]);

/** A random one of the player's enabled animations (the standard cast for the default and for Twisted). */
function chosenCast(player) {
  const mask = Number(player.getAttribute?.(TOGGLES_ATTRIBUTE) ?? 1);
  const enabled = [...Array(11).keys()].filter((bit) => mask & (1 << bit));
  const bit = enabled[Math.floor(Math.random() * enabled.length)];
  return castOf(COSMETIC_CASTS.get(bit));
}

/** The long cast only starts while the player stands still; a moving click never begins it. */
function standingStill(player) {
  return (player.getMovementQueue?.()?.size?.() ?? 0) === 0;
}

/** { steps: [{ tick, animation, graphic?, height?, sound? }], lockTick, landTick } as a cast. */
function castOf(definition) {
  if (!definition) return DEFAULT_CAST;
  const steps = new Map();
  for (const step of definition.steps ?? []) {
    const own = Array.isArray(step) ? { tick: step[0], animation: step[1], graphic: step[2] } : step;
    steps.set(own.tick, own);
  }
  return { steps, lockTick: definition.lockTick ?? LOCK_TICK, landTick: definition.landTick ?? LAND_TICK };
}

/**
 * Starts the cast toward `destination`; `onArrival` runs on landing (where the spell starts its
 * cooldown). Returns the task, which is stopped early if the cast is interrupted, or null when
 * the player is moving (the long cast only starts from a standstill). `cast` is the animation set
 * to play, the standard one unless given (see castOf).
 */
function startHomeTeleport(core, player, destination, onArrival, cast = chosenCast(player)) {
  const { steps: STEPS, lockTick: LOCK_TICK, landTick: LAND_TICK } = cast;
  // OSRS: the home teleport does not stop the player's walk, it simply cannot be cast
  // while moving. Refuse the click without clearing the route or playing tick 0.
  if (!standingStill(player)) {
    player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
    return null;
  }
  const start = player.getLocation().clone();
  reset(core, player);
  player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);

  let tick = -1;
  let locked = false;
  const task = new (class extends core.Task {
    constructor() {
      // Not immediate: the first run is this tick's task pass, tick 0.
      super(1, player, false);
    }

    execute() {
      tick++;
      if (!player.isRegistered() || player.getHitpoints() <= 0) {
        this.stop();
        return;
      }
      if (!locked && tick > 0 && interrupted(core, player, start)) {
        reset(core, player);
        this.stop();
        return;
      }
      const step = STEPS.get(tick);
      if (step) playStep(core, player, step);
      if (tick === LOCK_TICK) {
        locked = true;
        player.getPacketSender().sendVarbit(BUSY_VARBIT, 1);
        player.getMovementQueue().setBlockMovement(true).reset();
        player.setTeleporting(true);
      }
      if (tick === LAND_TICK) {
        player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
        player.setTeleporting(false);
        player.getMovementQueue().setBlockMovement(false).reset();
        const from = player.getLocation?.()?.clone?.() ?? null;
        const fromInstance = player.getPrivateArea?.() != null;
        player.moveTo(destination);
        // As the core's teleports do ("teleport:landed"): where it began, for content that remembers it.
        core.PluginManager?.emitCustomEvent?.("teleport:landed", { player, from, fromInstance, to: destination });
        reset(core, player);
        onArrival?.();
      }
      if (tick === LAND_TICK + 1) {
        player.performAnimation(core.Animation.DEFAULT_RESET_ANIMATION);
        this.stop();
      }
    }

    stop() {
      super.stop();
      if (locked && tick < LAND_TICK) {
        player.setTeleporting(false);
        player.getMovementQueue().setBlockMovement(false);
        player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
      }
    }
  })();
  core.TaskManager.submit(task);
  return task;
}

/** Whole minutes since 1970, the unit of the game's date varps (date_minutes, 3078). */
function dateMinutes(nowMs = Date.now()) {
  return Math.floor(nowMs / 60_000);
}

module.exports = { TOGGLES_ATTRIBUTE, startHomeTeleport, castOf, dateMinutes, LAND_TICK, LOCK_TICK, BUSY_VARBIT };
