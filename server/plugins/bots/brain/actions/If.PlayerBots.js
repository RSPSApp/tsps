"use strict";

const { playerState } = require("../ActionState.PlayerBots");

// Select once on entry, then finish that branch; never re-evaluate a running action.
function createIfAction(condition, yes, no) {
  const stateFor = player => playerState(action, player, () => ({ active: null }));
  const action = {
    id: "if",
    update(ctx) {
      const state = stateFor(ctx.player);
      if (!state.active) state.active = condition.check(ctx) ? yes : no;
      if (!state.active) return "success";
      return state.active.update(ctx);
    },
    stop(ctx) {
      const state = stateFor(ctx.player);
      state.active?.stop?.(ctx);
      state.active = null;
    },
    madeProgress(ctx) {
      const state = stateFor(ctx.player);
      if (state.active?.madeProgress) return state.active.madeProgress(ctx) === true;
      const loc = ctx.player.getLocation?.();
      const position = loc ? `${loc.getX()},${loc.getY()},${loc.getZ()}` : null;
      const moved = state.position !== undefined && state.position !== position;
      state.position = position;
      return moved;
    },
    describe(ctx) { return `if → ${stateFor(ctx.player).active?.id ?? "checking"}`; },
  };
  return action;
}
module.exports = { createIfAction };
