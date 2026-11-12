"use strict";

const { playerState } = require("../ActionState.PlayerBots");

let requestSequence = 0;

/** A non-blocking, bounded model decision that may only select one authored graph route. */
function createAiAgentAction(spec, world) {
  const stateFor = player => playerState(action, player, () => ({ requestId: null, selected: null }));
  const action = {
    id: "ai_agent",
    update(ctx) {
      const state = stateFor(ctx.player);
      if (!state.requestId) {
        state.requestId = `graph:${ctx.player.getUsername?.() ?? "bot"}:${++requestSequence}`;
        state.selected = null;
      }
      const agent = world?.getAiGraphAgent?.(ctx.player);
      if (!agent?.requestGraphChoice) {
        state.error = "AI graph agent is not configured (enable PlayerBots AI and configure a provider).";
        return "failed";
      }
      const result = agent.requestGraphChoice({
        requestId: state.requestId,
        prompt: spec.prompt,
        choices: spec.choices,
        nowMs: ctx.nowMs,
      });
      if (result?.status === "pending") return "running";
      if (result?.status === "selected" && spec.choices.some(choice => choice.label === result.choice)) {
        state.selected = result.choice;
        return "success";
      }
      state.error = result?.error ?? "AI agent did not choose an available route.";
      return "failed";
    },
    outputPort(ctx) {
      const selected = stateFor(ctx.player).selected;
      const index = spec.choices.findIndex(choice => choice.label === selected);
      return index < 0 ? "error" : `choice_${index}`;
    },
    describe(ctx) {
      const state = stateFor(ctx.player);
      return state.selected ? `AI selected: ${state.selected}` : state.error ? `AI agent: ${state.error}` : "AI agent is deciding";
    },
    stop(ctx) {
      const state = stateFor(ctx.player);
      if (state.requestId) world?.getAiGraphAgent?.(ctx.player)?.cancelGraphChoice?.(state.requestId);
      state.requestId = null;
      state.selected = null;
    },
    madeProgress() { return true; },
  };
  return action;
}

module.exports = { createAiAgentAction };
