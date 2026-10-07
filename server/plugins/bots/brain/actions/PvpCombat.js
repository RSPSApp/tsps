"use strict";

/**
 * Brain action that keeps a PvP bot in the fight loop: re-gear after death,
 * seek a target when idle, then hand every tick to the shared PvP engine.
 *
 * exitWhenIdle marks a reactive overlay (a recruit defending its owner): it
 * ends the activity once the seeded target is gone so the parent resumes.
 */
function createPvpCombatAction(spec, controller) {
  const id = spec?.id ?? "pvpCombat";
  const exitWhenIdle = spec?.exitWhenIdle === true;
  return {
    id,
    update(ctx) {
      const player = ctx.player;
      const state = ctx.state;
      if (!player || !state || !state.pvp || typeof controller?.tick !== "function") {
        return "failed";
      }
      if ((player.getHitpoints?.() ?? 0) <= 0 || player.isDyingReturn?.() === true) {
        return "running";
      }
      controller.ensureLoadout(player, state);
      if (state.pvp.retreat) {
        return "running";
      }
      const target =
        player.getCombat?.().getTarget?.() ?? state.pvp.targetPlayer ?? null;
      const targetAlive =
        !!target &&
        target.isRegistered?.() !== false &&
        (target.getHitpoints?.() ?? 1) > 0;
      if (targetAlive) {
        controller.tick({ player, state, nowMs: ctx.nowMs });
        return "running";
      }
      if (exitWhenIdle) {
        return "success";
      }
      if (ctx.nowMs >= Number(state.pvp.nextActionAt ?? 0)) {
        controller.seek({ player, state, nowMs: ctx.nowMs });
      }
      if (!state.pvp.targetUsername) {
        controller.wanderWhileSeeking?.({ player, state, nowMs: ctx.nowMs });
      }
      return "running";
    },
    madeProgress(ctx) {
      return !!ctx.state?.pvp?.targetUsername;
    },
  };
}

module.exports = {
  createPvpCombatAction,
};
