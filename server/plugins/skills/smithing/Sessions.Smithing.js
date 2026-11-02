/**
 * Smithing's make-X loops (smelting, anvil work, cannonballs): one task ticks every player's
 * session. Each cycle starts `firstDelay` ticks after the session (then every `interval`
 * ticks, or `interval(player)` read as each cycle opens): `begin(player)` runs the cycle's
 * opening (a message, the animation), and
 * `step(player)` makes the item `finishDelay` ticks later. Either returning false ends the
 * session, as do `remaining` running out and the player moving, dying or logging out.
 */
const Core = require("./Core.Smithing");
const { pauseForLevelUp, actionInterval } = require("../SkillActions");

const SESSIONS = new Map();
/** Other per-tick work (closing menus a player walked away from). */
const EVERY_TICK = [];
let tick = 0;

function start(player, { type, skill = null, remaining, interval, firstDelay = 0, finishDelay = 0, begin, step, onStop }) {
  stop(player, false);
  SESSIONS.set(player, {
    type, skill, remaining, interval, finishDelay, begin, step, onStop,
    // The task's next run is the tick the session started on (offset 0).
    nextCycle: tick + 1 + firstDelay,
    finishAt: null,
  });
}

/**
 * A one-off timed action (godsword or shield repairs): `steps` run at their tick offsets from
 * now (offset 0 is this tick); walking off cancels the rest.
 */
function timeline(player, type, steps) {
  const ordered = [...steps].sort((a, b) => a.at - b.at);
  start(player, {
    type,
    remaining: 1,
    interval: 1,
    begin: () => true,
    step: (actor) => {
      const session = SESSIONS.get(actor);
      session.elapsed = (session.elapsed ?? -1) + 1;
      while (ordered.length && ordered[0].at <= session.elapsed) {
        if (ordered.shift().run(actor) === false) return false;
      }
      if (ordered.length) session.remaining++;
      return true;
    },
  });
}

function stop(player, resetAnimation = true) {
  const session = SESSIONS.get(player);
  if (!session) return;
  SESSIONS.delete(player);
  session.onStop?.(player);
  if (resetAnimation) player.performAnimation(Core.Animation.DEFAULT_RESET_ANIMATION);
}

function typeOf(player) {
  return SESSIONS.get(player)?.type ?? null;
}

function pause(event) {
  pauseForLevelUp(event, SESSIONS, (player) => stop(player, false));
}

function everyTick(fn) {
  EVERY_TICK.push(fn);
}

function advance(player, session) {
  if (session.finishAt == null && tick >= session.nextCycle) {
    // Content may work faster ("skills:action-interval", by the session's type: a league relic's 2-tick smelting).
    const pace = typeof session.interval === "function" ? session.interval(player) : session.interval;
    session.nextCycle = tick + actionInterval(Core.api, player, session.skill ?? Core.Skill.SMITHING, session.type, pace);
    if (session.begin && !session.begin(player)) return false;
    session.finishAt = tick + session.finishDelay;
  }
  if (session.finishAt == null || tick < session.finishAt) return true;
  session.finishAt = null;
  // Content may make several items in the one cycle ("skills:actions-per-cycle", a league relic's all at once).
  const actions = require("./Common.Smithing").actionsPerCycle(player, session.skill ?? Core.Skill.SMITHING, session.type);
  for (let done = 0; done < actions; done++) {
    if (!session.step(player)) {
      if (done === 0) return false;
      stop(player, false);
      return true;
    }
    if (--session.remaining <= 0) {
      stop(player, false);
      return true;
    }
  }
  return true;
}

/** Runs one tick. Sessions started during the tick's packets get their opening this tick. */
function process() {
  tick++;
  for (const fn of EVERY_TICK) fn();
  for (const [player, session] of SESSIONS) {
    if (!player?.isRegistered?.() || player.getHitpoints() <= 0) {
      stop(player, false);
      continue;
    }
    if (player.getMovementQueue().size() > 0 || player.getForceMovement() != null) {
      stop(player);
      continue;
    }
    if (session.levelUpPaused) continue;
    if (!advance(player, session)) stop(player);
  }
}

function createTask() {
  class SmithingTask extends Core.Task {
    constructor() {
      super(1);
    }

    execute() {
      process();
    }
  }
  return new SmithingTask();
}

function startTask() {
  Core.api.getTaskManager().submit(createTask());
}

module.exports = function attach(api) {
  api.onServerStartup(startTask);
};

Object.assign(module.exports, { start, stop, pause, typeOf, everyTick, timeline });
