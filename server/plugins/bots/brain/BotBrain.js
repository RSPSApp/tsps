"use strict";

const {
  clearMovementRequest,
  dispatchMovementRequest,
  peekMovementRequest,
} = require("../behaviours/navigation/BotNavigation");
const { maybeCrossDitch } = require("./DitchCrossing");
const { maybeOpenDoor } = require("./DoorOpening");
const { maybeUseShortcut } = require("./ShortcutCrossing");
const { maybeClimb } = require("./Climbing");

/**
 * Void-style behaviour runner: one action per bot per tick, driven by a frame
 * stack (activity at the bottom, resolvers pushed on top while a setup
 * requirement is unmet). No per-tick planning: an action either makes progress,
 * waits, succeeds, or fails, and failures re-assign on the next idle tick.
 */

const FRAME_STATE = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  WAIT: "wait",
  SUCCESS: "success",
  FAILED: "failed",
});

// Last-resort watchdog: an action that reports no progress this long fails the
// frame (and is logged), so a stuck bot cannot occupy a slot silently forever.
const FRAME_STALL_MS = 180000;
// A due rotation with nothing else free keeps the current activity and asks again later.
const SWITCH_RETRY_MS = 30000;
// Failed dispatches in a row before a pending walk is dropped.
const DEAD_WALK_ATTEMPTS = 3;

/** Hands state.mode back when an overlay that set it ends. */
function restoreMode(state, endingMode, previousMode) {
  if (state && endingMode && previousMode && state.mode === endingMode) {
    state.mode = previousMode;
  }
}

class BehaviourFrame {
  constructor(behaviour) {
    this.behaviour = behaviour;
    this.actionIndex = 0;
    this.state = FRAME_STATE.PENDING;
    this.waitTicks = 0;
    this.blocked = new Set();
    this.lastProgressAt = 0;
    this.enteredAt = 0;
    this.occupied = false;
  }

  action() {
    return this.behaviour.actions[this.actionIndex] ?? null;
  }
}

class BotBrain {
  constructor(options) {
    this.player = options.player;
    this.state = options.state ?? null;
    this.registry = options.registry;
    this.world = options.world;
    this.frames = [];
    this.lastError = null;
    // Ephemeral brains are reactive overlays (a bot fighting back): when the
    // activity ends, onExhausted restores whatever ran before it.
    this.ephemeral = options.ephemeral === true;
    this.onExhausted =
      typeof options.onExhausted === "function" ? options.onExhausted : null;
    // Optional rotation (bot-sites.json `switchMinutes`): { activityIds, weights, switchAfterMs }.
    // Only activityIds are ever assigned; with switchAfterMs ({min,max}) the bot
    // swaps to another of them at random once its activity has run that long.
    this.rotation = options.rotation ?? null;
    // Without a rotation the bot only ever returns to the activity it was given: a
    // wilderness bot whose pvp activity ends goes back to pvp, not to a random skill.
    this.rootActivityId = options.activity?.id ?? null;
    // Optional: picks the next root activity instead of the registry (an AI bot's own plan).
    // Returns an activity, "wait" to stay idle until it has one, or null for the usual pick.
    this.chooseNext = typeof options.chooseNext === "function" ? options.chooseNext : null;
    // A paused brain does nothing at all (a bot in a trade must not walk off or close it).
    this.paused = false;
    // Optional human pacing (AI bots): { actionPauseMs, activityPauseMs, walkPauseChance,
    // walkPauseMs, dropsPerTick }, each range [min, max]. Without it a bot acts every tick.
    this.pacing = options.pacing ?? null;
    // Nothing happens before this time: a pause between actions, or while typing.
    this.restUntil = 0;
    // When the next walk leg may go out (0: not decided for this gap yet).
    this.walkGapUntil = 0;
    this.switchAt = 0;
    if (options.activity) {
      this.pushRoot(options.activity, options.nowMs ?? Date.now());
    }
  }

  /** Rests for a random time in `range` ([min, max] ms), unless already resting longer. */
  rest(range, nowMs = Date.now()) {
    if (!range) return;
    const [min, max] = range;
    this.restUntil = Math.max(this.restUntil, nowMs + min + Math.random() * Math.max(0, max - min));
  }

  /** Starts a bottom-of-stack activity and schedules its rotation switch. */
  pushRoot(activity, nowMs) {
    this.rest(this.pacing?.activityPauseMs, nowMs);
    this.pushActivity(activity, nowMs);
    const span = this.rotation?.switchAfterMs;
    this.switchAt = span ? nowMs + span.min + Math.random() * (span.max - span.min) : 0;
  }

  ensureState() {
    const state = this.state ?? this.world?.resolveState?.(this.player);
    if (state) {
      this.state = state;
    }
    return this.state;
  }

  pushActivity(activity, nowMs) {
    const frame = new BehaviourFrame(activity);
    frame.enteredAt = nowMs;
    this.frames.push(frame);
    if (activity.resolver !== true) {
      this.registry?.occupy?.(activity);
      frame.occupied = true;
    }
    if (activity.actions?.length) {
      const state = this.ensureState();
      if (state && activity.mode) {
        state.mode = activity.mode;
      }
    }
  }

  /** Releases the capacity slot of one frame; overlays must not leak the parent's. */
  releaseFrame(frame) {
    if (frame?.occupied) {
      this.registry?.release?.(frame.behaviour);
      frame.occupied = false;
    }
  }

  /**
   * Ends an action. Its walk goes with it: a request it left behind (a bank walk
   * onto a booth tile that never completes) would otherwise hold up the next
   * action, which waits for pending movement before choosing its own.
   */
  stopAction(action, ctx) {
    action?.stop?.(ctx);
    clearMovementRequest(this.player);
    // Nor does an interface it opened (the bank after a deposit, a shop after a sale):
    // left open, the bot stays busy() and the next action never starts.
    if (Number(this.player.getInterfaceId?.() ?? -1) > 0) {
      this.player.getPacketSender?.()?.sendInterfaceRemoval?.();
    }
  }

  /**
   * Progress for actions that do not report their own: the bot changed tile. A long walk
   * (to a furnace, a far bank) must not trip the stall check halfway.
   */
  movedSinceLastTick() {
    const loc = this.player.getLocation?.();
    const position = loc ? `${loc.getX()},${loc.getY()},${loc.getZ()}` : null;
    // The first reading is the baseline, not a move.
    const moved = this.lastPosition !== undefined && position !== this.lastPosition;
    this.lastPosition = position;
    return moved;
  }

  isRunningActivity(activityId) {
    return this.frames.some((frame) => frame.behaviour?.id === activityId);
  }

  reset() {
    for (const frame of [...this.frames].reverse()) {
      this.stopAction(frame.action(), this.context(frame, Date.now()));
      this.releaseFrame(frame);
    }
    this.frames = [];
  }

  /** Skill plugins announce produces; this keeps stall timers from firing. */
  noteProgress(nowMs = Date.now()) {
    const frame = this.frames[this.frames.length - 1];
    if (frame) {
      frame.lastProgressAt = nowMs;
    }
  }

  /** Drops everything the brain is doing and starts `activity` as its root. */
  replaceRoot(activity, nowMs = Date.now()) {
    this.reset();
    this.rootActivityId = activity.id;
    this.pushRoot(activity, nowMs);
  }

  assignNext(nowMs) {
    const chosen = this.chooseNext?.(nowMs) ?? null;
    if (chosen === "wait") {
      return false;
    }
    if (chosen) {
      this.pushRoot(chosen, nowMs);
      return true;
    }
    const activity = this.registry?.pickActivity?.(this.player, nowMs, this.rotation
      ? { allowed: this.rotation.activityIds, weights: this.rotation.weights }
      : { own: this.rootActivityId });
    if (!activity) {
      return false;
    }
    this.pushRoot(activity, nowMs);
    return true;
  }

  /**
   * Rotation: once the root activity's time is up, swap it for another of the
   * rotation's activities. Waits for a safe point - no resolver/overlay on top
   * and no fight in progress.
   */
  maybeSwitchActivity(nowMs) {
    if (!this.switchAt || nowMs < this.switchAt || this.frames.length !== 1) {
      return;
    }
    const combat = this.player.getCombat?.();
    if (combat?.getTarget?.() || combat?.getAttacker?.()) {
      return;
    }
    const frame = this.frames[0];
    const next = this.registry?.pickActivity?.(this.player, nowMs, {
      allowed: this.rotation.activityIds,
      weights: this.rotation.weights,
      avoid: frame.behaviour.id,
    });
    if (!next) {
      this.switchAt = nowMs + SWITCH_RETRY_MS;
      return;
    }
    this.stopAction(frame.action(), this.context(frame, nowMs));
    this.releaseFrame(frame);
    this.frames = [];
    this.world?.log?.("bot_brain_activity_switch", {
      username: this.player.getUsername?.() ?? null,
      from: frame.behaviour.id,
      to: next.id,
    });
    this.pushRoot(next, nowMs);
  }

  startFrame(frame, nowMs) {
    const ctx = this.context(frame, nowMs);
    for (const requirement of frame.behaviour.setup ?? []) {
      if (requirement.check(ctx)) {
        continue;
      }
      const resolvers = this.registry?.resolversFor?.(requirement, this.player) ?? [];
      const resolver = resolvers.find(
        (candidate) =>
          !frame.blocked.has(candidate.id) &&
          (candidate.requires ?? []).every((condition) => condition.check(ctx))
      );
      if (!resolver) {
        frame.state = FRAME_STATE.FAILED;
        frame.failReason = `unresolved:${requirement.id ?? "requirement"}`;
        this.world?.log?.("bot_brain_frame_failed", { reason: frame.failReason });
        return;
      }
      frame.blocked.add(resolver.id);
      this.pushActivity(resolver, nowMs);
      return;
    }
    for (const requirement of frame.behaviour.requires ?? []) {
      if (!requirement.check(ctx)) {
        frame.state = FRAME_STATE.FAILED;
        frame.failReason = `requires:${requirement.id ?? "requirement"}`;
        this.world?.log?.("bot_brain_frame_failed", { reason: frame.failReason });
        return;
      }
    }
    const action = frame.action();
    if (!action) {
      frame.state = FRAME_STATE.SUCCESS;
      return;
    }
    frame.lastProgressAt = nowMs;
    frame.state = FRAME_STATE.RUNNING;
  }

  nextAction(nowMs) {
    const frame = this.frames[this.frames.length - 1];
    if (!frame) {
      return;
    }
    frame.actionIndex += 1;
    if (frame.actionIndex >= (frame.behaviour.actions?.length ?? 0)) {
      const repeat = frame.behaviour.repeat === true;
      if (repeat) {
        frame.actionIndex = 0;
      } else {
        this.completeFrame(nowMs);
        return;
      }
    }
    frame.state = FRAME_STATE.PENDING;
    this.startFrame(frame, nowMs);
  }

  completeFrame(nowMs) {
    const frame = this.frames[this.frames.length - 1];
    if (frame) {
      this.endFrame(frame, nowMs);
    }
  }

  /**
   * Pops the top frame and resumes its parent (a failed resolver makes the
   * parent look for another). A failed activity is put on cooldown so the
   * next assignment picks something else.
   */
  endFrame(frame, nowMs, failed = false) {
    this.frames.pop();
    this.releaseFrame(frame);
    const behaviour = frame.behaviour;
    if (failed && behaviour.resolver !== true && behaviour.actions?.length) {
      this.registry?.blockActivity?.(
        this.player,
        behaviour.id,
        nowMs,
        behaviour.failureCooldownMs
      );
    }
    const parent = this.frames[this.frames.length - 1];
    if (parent) {
      // An overlay (pvp_engage) may have changed state.mode; give it back.
      restoreMode(this.state, behaviour.mode, parent.behaviour.mode);
      parent.state = FRAME_STATE.PENDING;
      return;
    }
    if (this.ephemeral) {
      this.onExhausted?.();
      return;
    }
    this.assignNext(nowMs);
  }

  context(frame, nowMs) {
    return {
      player: this.player,
      state: this.ensureState(),
      world: this.world,
      brain: this,
      activity: frame?.behaviour ?? null,
      frame,
      nowMs,
    };
  }

  /**
   * With pacing, a walk leg sometimes waits a moment before the next goes out, as a player
   * pauses between clicks. Decided once per gap; returns true while the bot should wait.
   */
  holdWalk(nowMs) {
    const pacing = this.pacing;
    if (!pacing) return false;
    if (this.walkGapUntil === 0) {
      const [min, max] = pacing.walkPauseMs ?? [0, 0];
      this.walkGapUntil = Math.random() < (pacing.walkPauseChance ?? 0)
        ? nowMs + min + Math.random() * Math.max(0, max - min)
        : nowMs;
    }
    return nowMs < this.walkGapUntil;
  }

  /** Dispatches the bot's pending movement request (ditch crossings and doors included). */
  dispatchMovement(nowMs = Date.now()) {
    const player = this.player;
    if (!player || player.getForceMovement?.() != null) {
      return;
    }
    if (player.getMovementQueue?.()?.size?.() > 0) {
      return;
    }
    const request = peekMovementRequest(player);
    if (!request) {
      return;
    }
    if (this.holdWalk(nowMs)) {
      return;
    }
    this.walkGapUntil = 0;
    if (maybeOpenDoor({ player, state: this.state ?? null, world: this.world, request })) {
      return;
    }
    if (maybeUseShortcut({ player, state: this.state ?? null, world: this.world, request })) {
      return;
    }
    if (maybeClimb({ player, state: this.state ?? null, world: this.world, request })) {
      return;
    }
    if (
      maybeCrossDitch({
        player,
        state: this.state ?? null,
        world: this.world,
        request,
      })
    ) {
      return;
    }
    const result = dispatchMovementRequest(player, request, this.state ?? undefined);
    const latest = peekMovementRequest(player);
    if (latest === request && result?.hasRoute === true) {
      // A planned long route keeps its request until the last leg: the next leg goes
      // out as soon as this one is walked, instead of the bot standing until its
      // activity asks again (which made long walks crawl a leg at a time).
      const route = (request.climbVia ?? request).route;
      if (!(route && route.index < route.waypoints.length)) {
        clearMovementRequest(player);
      }
    } else if (latest === request) {
      const opening = maybeOpenDoor({ player, state: this.state ?? null, world: this.world, request, select: true });
      const shortcutting =
        !opening &&
        maybeUseShortcut({ player, state: this.state ?? null, world: this.world, request, select: true });
      // A walk that keeps finding no path (onto a rock or booth tile the bot already
      // stands by, a spot cut off) and no door to open or shortcut to climb is dead:
      // drop it, so the action re-decides instead of waiting on it forever.
      if (
        !opening && !shortcutting &&
        !this.state?.doorAttempt && !this.state?.shortcutAttempt &&
        Number(request.noPathAttempts ?? 0) >= DEAD_WALK_ATTEMPTS
      ) {
        clearMovementRequest(player);
      }
    }
  }

  debugTick(frame) {
    if (process.env.BOT_BRAIN_DEBUG !== "1") {
      return;
    }
    this._debugCounter = (this._debugCounter ?? 0) + 1;
    if (this._debugCounter % 20 !== 0) {
      return;
    }
    const loc = this.player.getLocation?.();
    this.world?.log?.("bot_brain_debug", {
      username: this.player.getUsername?.(),
      state: frame?.state ?? "none",
      action: frame?.action()?.id ?? null,
      index: frame?.actionIndex ?? null,
      mode: this.state?.mode ?? null,
      x: loc?.getX?.() ?? null,
      y: loc?.getY?.() ?? null,
      queue: this.player.getMovementQueue?.()?.size?.() ?? 0,
    });
  }

  /** @returns {"running"|"idle"} */
  tick(nowMs = Date.now()) {
    this.lastTickAt = nowMs;
    if (this.paused) {
      return "running";
    }
    // A pause (between actions, while typing) holds walking and the activity, never the
    // support below: a resting bot still eats and defends itself.
    const resting = nowMs < this.restUntil;
    if (!resting) {
      this.dispatchMovement(nowMs);
    }
    // Support runs before the activity action: boosts, defensive/retreat,
    // then eating.
    const support = this.world?.supportTick?.({
      player: this.player,
      state: this.ensureState(),
      nowMs,
    });
    if (support?.skip === true || resting) {
      return "running";
    }
    this.maybeSwitchActivity(nowMs);
    const frame = this.frames[this.frames.length - 1];
    this.debugTick(frame);
    if (!frame) {
      if (!this.ephemeral) {
        this.assignNext(nowMs);
      }
      return "running";
    }
    switch (frame.state) {
      case FRAME_STATE.PENDING:
        this.startFrame(frame, nowMs);
        break;
      case FRAME_STATE.RUNNING: {
        const action = frame.action();
        if (!action) {
          frame.state = FRAME_STATE.SUCCESS;
          break;
        }
        const ctx = this.context(frame, nowMs);
        let result;
        try {
          result = action.update(ctx);
        } catch (error) {
          this.lastError = String(error?.message ?? error);
          this.world?.log?.("bot_brain_action_failed", {
            action: action.id,
            activity: this.frames[this.frames.length - 1]?.behaviour?.id ?? null,
            error: this.lastError,
          });
          result = "failed";
        }
        if (result === "success") {
          this.stopAction(action, ctx);
          this.rest(this.pacing?.actionPauseMs, nowMs);
          this.nextAction(nowMs);
        } else if (result === "failed") {
          this.stopAction(action, ctx);
          frame.state = FRAME_STATE.FAILED;
        } else if (result === "wait") {
          frame.state = FRAME_STATE.WAIT;
          frame.waitTicks = Math.max(1, Number(ctx.waitTicks ?? 1));
        } else {
          if (typeof action.madeProgress === "function" ? action.madeProgress(ctx) : this.movedSinceLastTick()) {
            frame.lastProgressAt = nowMs;
          }
          if (nowMs - frame.lastProgressAt >= FRAME_STALL_MS) {
            const loc = this.player.getLocation?.();
            this.world?.log?.("bot_brain_frame_stalled", {
              username: this.player.getUsername?.() ?? null,
              activity: frame.behaviour?.id ?? null,
              action: action.id,
              stallMs: nowMs - frame.lastProgressAt,
              x: loc?.getX?.() ?? null,
              y: loc?.getY?.() ?? null,
            });
            this.stopAction(action, ctx);
            frame.state = FRAME_STATE.FAILED;
          }
        }
        break;
      }
      case FRAME_STATE.WAIT:
        frame.waitTicks -= 1;
        if (frame.waitTicks <= 0) {
          frame.state = FRAME_STATE.PENDING;
        }
        break;
      case FRAME_STATE.SUCCESS:
        this.completeFrame(nowMs);
        break;
      case FRAME_STATE.FAILED:
        this.endFrame(frame, nowMs, true);
        break;
      default:
        frame.state = FRAME_STATE.PENDING;
        break;
    }
    return "running";
  }
}

module.exports = {
  BotBrain,
  FRAME_STATE,
  restoreMode,
};
