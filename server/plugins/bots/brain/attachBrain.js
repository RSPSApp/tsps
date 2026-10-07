"use strict";

const { BotBrain, restoreMode } = require("./BotBrain");

/** Wires a spawned bot's entry to a brain running `activity`. Shared by sites, bench and ::bot. */
function attachBrain(options = {}) {
  const { runtime, registry, world, bot, activity, home, resetMovementState, nowMs } = options;
  if (!runtime || !registry || !bot || !activity) {
    return false;
  }
  const username = bot.getUsername?.();
  const state = username ? runtime.botStatesByName?.get?.(username) : null;
  const entry = username ? runtime.entriesByUsername?.get?.(username) : null;
  if (!state || !entry) {
    return false;
  }
  if (home) {
    state.home = { x: home.x, y: home.y, z: home.z ?? 0 };
  }
  // PvP bots must stay pvp-only (target filters and tryStartMode rely on it);
  // other brain activities drop the PvP priming so they cannot be dragged into fights.
  if (state.autonomy && activity.mode !== "pvp") {
    state.autonomy.allowedAutonomousModes = null;
  }
  const brain = new BotBrain({
    player: bot,
    state,
    registry,
    world,
    activity,
    ephemeral: activity.ephemeral === true,
    nowMs: nowMs ?? Date.now(),
  });
  if (brain.ephemeral) {
    const previousMode = state.mode;
    brain.onExhausted = () => {
      if (entry.brain !== brain) {
        return;
      }
      entry.brain = null;
      restoreMode(state, activity.mode, previousMode);
      if (state.pvp) {
        state.pvp.targetUsername = null;
        state.pvp.targetPlayer = null;
        state.pvp.phase = "idle";
        state.pvp.endsAt = 0;
      }
      resetMovementState?.(bot);
    };
  }
  // Release every frame's capacity slot, not just the top one: a replaced
  // brain may still hold its parent activity under an overlay.
  if (entry.brain && entry.brain !== brain) {
    entry.brain.reset();
  }
  entry.brain = brain;
  resetMovementState?.(bot);
  return true;
}

module.exports = {
  attachBrain,
};
