"use strict";

const {
  clearMovementRequest,
  requestMovement,
} = require("../../behaviours/navigation/BotNavigation");

const WALK_STALL_MS = 60000;

/** Segmented walk to a fixed tile; completes inside `radius`. Resolver-sized. */
function createWalkToAction(spec) {
  const target = {
    x: Number(spec.x),
    y: Number(spec.y),
    z: Number(spec.z ?? 0),
    radius: Math.max(0, Number(spec.radius ?? 3)),
  };
  return {
    id: "walkTo",
    update(ctx) {
      const { player, nowMs } = ctx;
      const loc = player.getLocation();
      if (
        loc.getZ() === target.z &&
        Math.max(
          Math.abs(loc.getX() - target.x),
          Math.abs(loc.getY() - target.y)
        ) <= target.radius
      ) {
        clearMovementRequest(player);
        return "success";
      }
      if (player.getForceMovement?.() != null) {
        return "running";
      }
      if (player.getMovementQueue?.()?.size?.() > 0) {
        return "running";
      }
      if (nowMs - ctx.frame.lastProgressAt > WALK_STALL_MS) {
        return "failed";
      }
      requestMovement(player, target.x, target.y, {
        reason: "brain_walk_to",
        basicPather: true,
        z: target.z,
      });
      return "running";
    },
    stop(ctx) {
      if (ctx?.player) {
        clearMovementRequest(ctx.player);
      }
    },
  };
}

module.exports = {
  createWalkToAction,
};
