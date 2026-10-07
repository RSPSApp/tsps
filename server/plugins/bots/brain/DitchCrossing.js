"use strict";

/**
 * Brain-owned wilderness ditch crossing. BotBrain.dispatchMovement routes
 * every movement request through here; a request whose route crosses the
 * ditch walks to the object, clicks Cross, and waits for the force movement
 * before resuming the original request from the far side.
 */

const ATTEMPT_TIMEOUT_MS = 5000;
const DEFAULT_ATTEMPT_COOLDOWN_MS = 1200;
const DEFAULT_POST_CROSS_DELAY_MS = 0;

function isBetween(fromY, toY, objectY) {
  return (fromY - objectY) * (toY - objectY) <= 0 && fromY !== toY;
}

// A retreating bot runs deeper/away inside the Wilderness and never escapes
// south over the ditch; crossing back north is still allowed.
function isRetreatBlocked(player, state, objectY) {
  return !!state.pvp?.retreat && player.getLocation().getY() > objectY;
}

function startCross({ player, state, world, object, objectY, request, nowMs }) {
  const objectLoc = object.getLocation();
  const ditch = world.ditch;
  state.nextDitchAttemptAt = nowMs + Number(ditch?.attemptCooldownMs ?? DEFAULT_ATTEMPT_COOLDOWN_MS);
  player.getMovementQueue().walkToObject(object, {
    execute: () => {
      // A crossing queued before the retreat began must not fire.
      if (isRetreatBlocked(player, state, objectY)) {
        return;
      }
      const startSide = player.getLocation().getY() <= objectY ? "south" : "north";
      state.awaitingDitchTransition = {
        ditchY: objectY,
        startSide,
        startedAt: Date.now(),
      };
      player.getMovementQueue?.().reset?.();
      player.setPositionToFace?.(objectLoc);
      if (process.env.BOT_BRAIN_DEBUG === "1") {
        world.log?.("bot_brain_ditch_cross", {
          username: player.getUsername?.(),
          ditchY: objectY,
          fromY: player.getLocation().getY(),
          targetY: request.y,
        });
      }
      const handled = world.emitObjectInteraction?.({
        player,
        object,
        objectId: object.getId(),
        clickType: 1,
        location: {
          x: objectLoc.getX(),
          y: objectLoc.getY(),
          z: objectLoc.getZ(),
        },
        sourceLocation: {
          x: player.getLocation().getX(),
          y: player.getLocation().getY(),
          z: player.getLocation().getZ(),
        },
        handled: false,
      });
      if (handled !== true) {
        state.awaitingDitchTransition = null;
      }
    },
  });
  return true;
}

/**
 * @returns {boolean} true when the caller must skip normal dispatch this tick.
 */
function maybeCrossDitch({ player, state, world, request }) {
  const ditch = world?.ditch;
  if (!player || !state || !request || !ditch?.objectId) {
    return false;
  }
  const now = Date.now();
  const pending = state.awaitingDitchTransition ?? null;
  if (pending) {
    if (player.getForceMovement?.() != null) {
      return true;
    }
    const y = player.getLocation().getY();
    const crossed =
      pending.startSide === "north" ? y < pending.ditchY : y > pending.ditchY;
    if (crossed) {
      state.awaitingDitchTransition = null;
      state.nextDitchAttemptAt =
        now + Number(ditch.postCrossDelayMs ?? DEFAULT_POST_CROSS_DELAY_MS);
      return false;
    }
    if (now - Number(pending.startedAt ?? 0) < ATTEMPT_TIMEOUT_MS) {
      return true;
    }
    state.awaitingDitchTransition = null;
    state.nextDitchAttemptAt =
      now + Number(ditch.attemptCooldownMs ?? DEFAULT_ATTEMPT_COOLDOWN_MS);
    return false;
  }
  if (now < Number(state.nextDitchAttemptAt ?? 0)) {
    return false;
  }
  const from = player.getLocation();
  const to = { x: request.x, y: request.y, z: request.z ?? from.getZ() };
  const object = world.objectSearch?.findObjectOnRoute?.(
    player,
    from,
    to,
    ditch.objectId,
    1
  );
  if (!object?.getLocation) {
    return false;
  }
  const objectY = object.getLocation().getY();
  if (!isBetween(from.getY(), to.y, objectY) || isRetreatBlocked(player, state, objectY)) {
    return false;
  }
  return startCross({ player, state, world, object, objectY, request, nowMs: now });
}

module.exports = {
  maybeCrossDitch,
};
