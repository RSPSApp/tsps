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
 * and no cooldown starts.
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

/**
 * Starts the cast toward `destination`; `onArrival` runs on landing (where the spell starts its
 * cooldown). Returns the task, which is stopped early if the cast is interrupted.
 */
function startHomeTeleport(core, player, destination, onArrival) {
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
        player.moveTo(destination);
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

module.exports = { startHomeTeleport, dateMinutes, LAND_TICK, LOCK_TICK, BUSY_VARBIT };
