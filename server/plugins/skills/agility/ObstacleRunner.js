
/**
 * Plays an agility obstacle as a list of steps, one game tick at a time.
 *
 * Obstacles are data: an array of plain step objects (see `applyStep`). The runner
 * owns the player for the duration - movement is blocked, render animations are
 * swapped in and restored, and every tile change bypasses collision the way an
 * obstacle does in game (a log or tightrope is not walkable ground).
 *
 * Steps:
 *   { anim: id, delay? }              play an animation (delay in client cycles)
 *   { render: id | null }             walk/stand animation override, null restores it
 *   { walk: [[x, y], ...] }           forced walk, one tile per tick, ignoring clipping
 *   { move: [x, y, z?], anim?, speed?, dir?, ticks? }
 *                                     exact-move to a tile, landing after `ticks` ticks;
 *                                     `ticks: 0` starts the move and leaves landing to a `tele`
 *   { tele: [x, y, z?] }              place the player on a tile (plane changes)
 *   { wait: ticks }                   continue after this many ticks
 *   { face: [x, y] } | { faceDir: "north" | ... }
 *   { hit: n | [min, max] }           damage the player
 *   { msg: text } | { say: text }     game message / overhead text
 *   { varbit: [id, value] }           set a player varbit (a multiloc's side, say)
 *   { sound: id, loops?, delay? }     sound effect (delay in client cycles)
 *   { gfx: id, delay?, height? }      play a graphic on the player (delay in client cycles)
 *   { objAnim: id }                   animate the obstacle object
 *   { run: (ctx) => void }            escape hatch for one-off behaviour
 *
 * Coordinates are absolute tiles; an omitted plane means the player's current plane.
 */

/** ForceMovement direction indices, as PlayerSession maps them onto client angles. */
const FORCE_DIRECTION = Object.freeze({ north: 0, east: 1, south: 2, west: 3 });

const DIRECTION_VECTORS = Object.freeze({
  north: [0, 1],
  east: [1, 0],
  south: [0, -1],
  west: [-1, 0],
});

const RESET_ANIMATION = -1;
/** Exact-move defaults: arrive 1 tick (30 client cycles) after the step starts. */
const DEFAULT_MOVE_CYCLES = 30;
const DEFAULT_MOVE_TICKS = 1;
/** A forced walk that has not arrived after this many tiles is abandoned. */
const MAX_WALK_TILES = 64;

const BUSY_ATTRIBUTE = "agility.obstacle";

let TaskManager;
let Location;
let Animation;
let Graphic;
let Direction;
let Flag;
let ForceMovement;
let HitDamage;
let HitMask;
/** The obstacle task class, made in `init` once `api.core` gives it `Task` to extend. */
let ObstacleTask = null;

function init(api) {
  TaskManager = api.getTaskManager();
  ({ Location, Animation, Graphic, Direction, Flag, ForceMovement, HitDamage, HitMask } = api.core);
  ObstacleTask = createObstacleTask(api.core.Task);
}

function isBusy(player) {
  return player.getAttribute(BUSY_ATTRIBUTE) != null;
}

function directionBetween(fromX, fromY, toX, toY) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? "east" : "west";
  }
  return dy >= 0 ? "north" : "south";
}

function toLocation(player, tile) {
  const z = tile.length > 2 ? tile[2] : player.getLocation().getZ();
  return new Location(tile[0], tile[1], z);
}

function setRender(player, animationId) {
  player.setSkillAnimation(animationId ?? RESET_ANIMATION);
  player.getUpdateFlag().flag(Flag.APPEARANCE);
}

function animate(player, id, delay = 0) {
  player.performAnimation(new Animation(id < 0 ? Animation.DEFAULT_RESET_ANIMATION.getId() : id, delay));
}

function hit(player, amount) {
  const damage = Array.isArray(amount)
    ? amount[0] + Math.floor(Math.random() * (amount[1] - amount[0] + 1))
    : amount;
  if (damage > 0) {
    player.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, HitMask.RED)]);
  }
}

/** One tile of a forced walk; bypasses the movement queue so clipping never stops it. */
function stepTowards(player, target) {
  const location = player.getLocation();
  const dx = Math.sign(target[0] - location.getX());
  const dy = Math.sign(target[1] - location.getY());
  if (dx === 0 && dy === 0) {
    return false;
  }
  const next = new Location(location.getX() + dx, location.getY() + dy, location.getZ());
  player.setLocation(next);
  player.setWalkingDirection(Direction.fromDeltas(dx, dy));
  player.getMovementQueue().handleRegionChange();
  return true;
}

/**
 * Expands `move` into start/wait/land so landing is an ordinary step, and resolves
 * the obstacle's step list (arrays or a function of the context).
 */
function expandSteps(steps) {
  const expanded = [];
  for (const step of steps) {
    if (step == null) continue;
    if (step.move) {
      expanded.push({ moveStart: step });
      if (step.ticks !== 0) {
        expanded.push({ wait: step.ticks ?? DEFAULT_MOVE_TICKS });
        expanded.push({ land: step.move });
      }
    } else {
      expanded.push(step);
    }
  }
  return expanded;
}

function createObstacleTask(Task) {
  return class ObstacleTask extends Task {
    constructor(context, steps, onFinish) {
      super(1, context.player, true);
      this.context = context;
      this.player = context.player;
      this.steps = expandSteps(steps);
      this.onFinish = onFinish;
      this.index = 0;
      // Not `delay`: that is Task's own interval between executes.
      this.waitTicks = 0;
      this.walkPath = null;
      this.walkedTiles = 0;
      this.finished = false;
    }

    execute() {
      if (this.finished) {
        this.stop();
        return;
      }
      if (!this.player.isRegistered?.() || this.player.getHitpoints() <= 0) {
        this.finish(false);
        return;
      }
      if (this.walkPath) {
        this.advanceWalk();
        if (this.walkPath) return;
      }
      if (this.waitTicks > 0 && --this.waitTicks > 0) {
        return;
      }
      while (this.index < this.steps.length) {
        this.applyStep(this.steps[this.index++]);
        if (this.walkPath || this.waitTicks > 0 || this.finished) return;
      }
      this.finish(true);
    }

    advanceWalk() {
      while (this.walkPath.length > 0) {
        if (this.walkedTiles++ < MAX_WALK_TILES && stepTowards(this.player, this.walkPath[0])) {
          return;
        }
        this.walkPath.shift();
      }
      this.walkPath = null;
    }

    applyStep(step) {
      const player = this.player;
      if (step.wait != null) {
        this.waitTicks = step.wait;
      } else if (step.anim != null) {
        animate(player, step.anim, step.delay ?? 0);
      } else if ("render" in step) {
        setRender(player, step.render);
      } else if (step.walk) {
        this.walkPath = step.walk.map((tile) => [tile[0], tile[1]]);
        this.walkedTiles = 0;
        this.advanceWalk();
      } else if (step.moveStart) {
        this.startMove(step.moveStart);
      } else if (step.land) {
        player.setForceMovement(null);
        player.moveTo(toLocation(player, step.land));
      } else if (step.tele) {
        player.setForceMovement(null);
        player.moveTo(toLocation(player, step.tele));
      } else if (step.face) {
        player.setPositionToFace(toLocation(player, step.face));
      } else if (step.faceDir) {
        const [dx, dy] = DIRECTION_VECTORS[step.faceDir];
        const location = player.getLocation();
        player.setPositionToFace(new Location(location.getX() + dx, location.getY() + dy, location.getZ()));
      } else if (step.hit != null) {
        hit(player, step.hit);
      } else if (step.msg) {
        player.sendMessage(step.msg);
      } else if (step.say) {
        player.forceChat(step.say);
      } else if (step.varbit) {
        player.getPacketSender().sendVarbit(step.varbit[0], step.varbit[1]);
      } else if (step.sound != null) {
        player.getPacketSender().sendSoundEffect(step.sound, step.loops ?? 1, step.delay ?? 0);
      } else if (step.gfx != null) {
        // Graphic reads a third argument of 0-2 as a Priority, so a height is only passed when set.
        player.performGraphic(step.height
          ? new Graphic(step.gfx, step.delay ?? 0, step.height)
          : new Graphic(step.gfx, step.delay ?? 0));
      } else if (step.objAnim != null) {
        if (this.context.object) {
          player.getPacketSender().sendObjectAnimation(this.context.object, new Animation(step.objAnim));
        }
      } else if (step.run) {
        step.run(this.context);
      }
    }

    startMove(step) {
      const player = this.player;
      const current = player.getLocation().clone();
      const target = toLocation(player, step.move);
      const [startCycle, endCycle] = step.speed ?? [0, DEFAULT_MOVE_CYCLES];
      const direction = step.dir
        ?? directionBetween(current.getX(), current.getY(), target.getX(), target.getY());
      // PlayerSession sends the start relative to the current tile and the end as an
      // offset; starting on the current tile keeps both relative to the same origin.
      const forceMovement = new ForceMovement(
        current,
        new Location(target.getX() - current.getX(), target.getY() - current.getY()),
        startCycle,
        endCycle,
        FORCE_DIRECTION[direction] ?? direction,
        step.anim ?? -1
      );
      player.getMovementQueue().reset();
      if (step.anim != null) {
        animate(player, step.anim, step.delay ?? 0);
      }
      player.setForceMovement(forceMovement);
    }

    /** Applies every remaining tile change at once, for logouts mid-obstacle. */
    fastForward() {
      if (this.finished) return;
      if (this.walkPath && this.walkPath.length > 0) {
        const last = this.walkPath[this.walkPath.length - 1];
        this.player.setLocation(toLocation(this.player, last));
      }
      this.walkPath = null;
      while (this.index < this.steps.length) {
        const step = this.steps[this.index++];
        const tile = step.land ?? step.tele ?? (step.walk ? step.walk[step.walk.length - 1] : null);
        if (tile) {
          this.player.setForceMovement(null);
          this.player.setLocation(toLocation(this.player, tile));
        }
      }
      this.finish(true);
    }

    finish(completed) {
      if (this.finished) return;
      this.finished = true;
      super.stop();
      release(this.player);
      this.onFinish?.(completed);
    }

    /** Anything that cancels this task (teleports, logout sweeps) must still unlock the player. */
    stop() {
      if (!this.finished) {
        this.finish(false);
        return;
      }
      super.stop();
    }
  };
}

function lock(player, task) {
  player.setAttribute(BUSY_ATTRIBUTE, task);
  player.getMovementQueue().reset();
  player.getMovementQueue().setBlockMovement(true);
}

function release(player) {
  if (player.getAttribute(BUSY_ATTRIBUTE) == null) return;
  player.setAttribute(BUSY_ATTRIBUTE, null);
  player.getMovementQueue().setBlockMovement(false);
  if (player.getForceMovement() != null) {
    player.setForceMovement(null);
  }
  setRender(player, null);
  animate(player, RESET_ANIMATION);
}

/**
 * Runs `steps` for the player. `render` sets a walk animation for the whole run.
 * `onFinish(completed)` fires once; `completed` is false if the player died or left.
 */
function run(context, steps, { render = null, onFinish = null } = {}) {
  const task = new ObstacleTask(context, steps, onFinish);
  lock(context.player, task);
  if (render != null) {
    setRender(context.player, render);
  }
  TaskManager.submit(task);
  return task;
}

/** Finishes an in-progress obstacle instantly (logout), landing on its end tile. */
function completeNow(player) {
  const task = player.getAttribute(BUSY_ATTRIBUTE);
  if (task instanceof ObstacleTask) {
    task.fastForward();
  }
}

module.exports = {
  DIRECTION_VECTORS,
  init,
  isBusy,
  run,
  completeNow,
  directionBetween,
};
