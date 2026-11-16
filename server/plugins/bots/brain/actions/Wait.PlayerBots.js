"use strict";

const { playerState } = require("../ActionState.PlayerBots");

function createWaitAction(spec) {
  const durationMs = Math.max(0, Math.floor(Number(spec.seconds ?? 1) * 1000));
  const action = {
    id: "wait",
    update(ctx) {
      const state = playerState(action, ctx.player, () => ({ startedAt: null }));
      if (state.startedAt === null) state.startedAt = ctx.nowMs;
      return ctx.nowMs - state.startedAt >= durationMs ? "success" : "running";
    },
    stop(ctx) { playerState(action, ctx.player, () => ({ startedAt: null })).startedAt = null; },
    madeProgress: () => true,
    describe: () => `wait ${durationMs}ms`,
  };
  return action;
}

module.exports = { createWaitAction };
