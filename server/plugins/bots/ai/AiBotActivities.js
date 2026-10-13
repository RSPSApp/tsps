"use strict";

const { createWalkToAction } = require("../brain/actions/WalkTo");
const { clearMovementRequest, requestMovement } = require("../behaviours/navigation/BotNavigation");

/**
 * Brain activities only AI bots run: walking to a place, and keeping up with a player. They
 * are built per use rather than listed in bot-activities.json, since each one carries its
 * own target. Shaped like compiled registry activities (BotActivityRegistry.compileActivity).
 */
const FOLLOW_DISTANCE = 2;
const FOLLOW_LOST_TILES = 40;
const FOLLOW_REPATH_MS = 1800;

function activity(id, mode, actions, repeat) {
  return {
    id,
    resolver: false,
    resolves: null,
    mode,
    capacity: 100000,
    repeat,
    ephemeral: false,
    manual: true,
    failureCooldownMs: 0,
    requires: [],
    setup: [],
    actions,
    produces: [],
    site: null,
  };
}

/** Walks to `place` ({ x, y, z }) and ends there. */
function createTravelActivity(place) {
  return activity("ai_travel", "roaming", [createWalkToAction({ x: place.x, y: place.y, z: place.z ?? 0, radius: 4 })], false);
}

const distance = (a, b) => Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY()));

/** Stays within a couple of tiles of `targetName`; fails once they're gone or far away. */
function createFollowActivity(targetName, getPlayerByName) {
  let lastPathAt = 0;
  const follow = {
    id: "aiFollow",
    update(ctx) {
      const { player, nowMs } = ctx;
      const target = getPlayerByName(targetName);
      if (!target || target.isRegistered?.() !== true) {
        return "failed";
      }
      const here = player.getLocation();
      const there = target.getLocation();
      if (there.getZ() !== here.getZ() || distance(here, there) > FOLLOW_LOST_TILES) {
        return "failed";
      }
      if (distance(here, there) > FOLLOW_DISTANCE && nowMs - lastPathAt >= FOLLOW_REPATH_MS) {
        lastPathAt = nowMs;
        requestMovement(player, there.getX(), there.getY(), { reason: "ai_follow", nowMs, z: there.getZ() });
      }
      return "running";
    },
    // Standing next to someone who stopped is not a stall.
    madeProgress: () => true,
    stop(ctx) {
      if (ctx?.player) clearMovementRequest(ctx.player);
    },
  };
  return activity("ai_follow", "roaming", [follow], true);
}

module.exports = { createFollowActivity, createTravelActivity };
