"use strict";

const {
  chooseNextTarget,
  clearMovementRequest,
  isAtTarget,
  randomInRange,
  requestMovement,
} = require("../../behaviours/navigation/BotNavigation");
const {
  getWildernessHotspot,
  isOutsideWildernessHotspots,
} = require("../../behaviours/pvp/WildernessHotspotRegistry");

const WALK_RADIUS = 10;
const ENDPOINT_LINGER_MS = 500;
const PRE_WALK_MIN_MS = 180;
const PRE_WALK_MAX_MS = 1650;
const DYNAMIC_JITTER_MS = 3200;
const LINGER_JITTER_MS = 2200;
const DITCH_PROBE_RADIUS = 30;

function hashUsername(value) {
  const text = typeof value === "string" ? value : "";
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function resolveDeterministicJitterMs(username, nowMs, spreadMs) {
  const safeSpreadMs = Math.max(1, Math.floor(spreadMs));
  const cycleSeed = Math.floor(Math.max(0, Number(nowMs) || 0) / 5000);
  return hashUsername(`${username}:${cycleSeed}`) % safeSpreadMs;
}

/**
 * Brain roam: pick a target around home/roam bounds, walk to it, linger, repeat.
 * Username+cycle-seeded jitter keeps a crowd from moving in visible waves. All
 * per-bot state lives on state.roaming so the action instance can be shared.
 */
function createWanderAction(spec, world) {
  const walkRadius = Math.max(1, Math.floor(Number(spec.walkRadius ?? WALK_RADIUS)));
  const endpointLingerMs = Math.max(
    0,
    Math.floor(Number(spec.endpointLingerMs ?? ENDPOINT_LINGER_MS))
  );
  const roamDitchMaxY = Math.max(
    0,
    Math.floor(Number(world?.ditch?.roamMaxDistanceY ?? 12))
  );

  function assignedHotspot(state) {
    const hotspotId = state?.pvp?.hotspotId;
    return hotspotId ? getWildernessHotspot(hotspotId) : null;
  }

  function assignedBounds(state) {
    const bounds = state?.roaming?.roamBounds ?? null;
    return bounds &&
      Number.isFinite(bounds.minX) &&
      Number.isFinite(bounds.maxX) &&
      Number.isFinite(bounds.minY) &&
      Number.isFinite(bounds.maxY)
      ? bounds
      : null;
  }

  function effectiveRadius(state) {
    const hotspot = assignedHotspot(state);
    return Number.isFinite(hotspot?.roamRadius)
      ? Math.max(1, Math.floor(hotspot.roamRadius))
      : walkRadius;
  }

  function effectiveLinger(player, state) {
    const hotspot = assignedHotspot(state);
    const base = Number.isFinite(hotspot?.lingerMs)
      ? Math.max(0, Math.floor(hotspot.lingerMs))
      : endpointLingerMs;
    return base + (hashUsername(player?.getUsername?.() ?? "") % LINGER_JITTER_MS);
  }

  function preWalkDelay(player, nowMs) {
    return (
      randomInRange(PRE_WALK_MIN_MS, PRE_WALK_MAX_MS) +
      resolveDeterministicJitterMs(player?.getUsername?.() ?? "", nowMs, DYNAMIC_JITTER_MS)
    );
  }

  function resolveDitchY(player) {
    const objectId = world?.ditch?.objectId;
    if (!objectId || !world.objectSearch?.findNearestObject) {
      return null;
    }
    const object = world.objectSearch.findNearestObject(
      player,
      objectId,
      DITCH_PROBE_RADIUS
    );
    const y = object?.getLocation?.()?.getY?.();
    return Number.isFinite(y) ? y : null;
  }

  function acceptTargetFor(player, state) {
    const hotspot = assignedHotspot(state);
    const bounds = assignedBounds(state);
    const area = hotspot?.area ?? bounds;
    const hotspotAccept = area
      ? (target) =>
          !!target &&
          (hotspot ? true : isOutsideWildernessHotspots(target)) &&
          target.z === area.z &&
          target.x >= area.minX &&
          target.x <= area.maxX &&
          target.y >= area.minY &&
          target.y <= area.maxY
      : null;
    let ditchAccept = null;
    const ditchY = resolveDitchY(player);
    if (Number.isFinite(ditchY)) {
      const currentY = player.getLocation().getY();
      if (Math.abs(currentY - ditchY) > roamDitchMaxY) {
        const keepSouthSide = currentY <= ditchY;
        ditchAccept = (target) =>
          !!target && (keepSouthSide ? target.y <= ditchY : target.y >= ditchY);
      }
    }
    if (!hotspotAccept) {
      return ditchAccept;
    }
    if (!ditchAccept) {
      return hotspotAccept;
    }
    return (target) =>
      hotspotAccept(target) === true && ditchAccept(target) === true;
  }

  function pickTarget(player, state, nowMs) {
    const acceptTarget = acceptTargetFor(player, state);
    const options = acceptTarget ? { acceptTarget } : {};
    const bounds = assignedBounds(state);
    if (bounds) {
      options.bounds = bounds;
    }
    const target = chooseNextTarget(player, state, effectiveRadius(state), options);
    state.roaming.target = target
      ? { x: target.x, y: target.y, z: target.z }
      : null;
    state.roaming.nextWalkAt = nowMs + preWalkDelay(player, nowMs);
  }

  return {
    id: "wander",
    update(ctx) {
      const { player, state, nowMs } = ctx;
      if (!player || !state?.roaming || !state.home) {
        return "failed";
      }
      if (player.getForceMovement?.() != null) {
        return "running";
      }
      if (player.getMovementQueue?.()?.size?.() > 0) {
        return "running";
      }
      const roaming = state.roaming;
      if (nowMs < Number(roaming.nextWalkAt ?? 0)) {
        return "running";
      }
      if (!roaming.target) {
        pickTarget(player, state, nowMs);
        return "running";
      }
      if (!isAtTarget(player, roaming.target)) {
        requestMovement(player, roaming.target.x, roaming.target.y, {
          reason: "brain_roam",
          basicPather: true,
          z: roaming.target.z,
        });
        return "running";
      }
      if (!roaming.endpointPauseUntil) {
        roaming.endpointPauseUntil = nowMs + effectiveLinger(player, state);
        return "running";
      }
      if (nowMs < Number(roaming.endpointPauseUntil)) {
        return "running";
      }
      roaming.endpointPauseUntil = 0;
      roaming.target = null;
      pickTarget(player, state, nowMs);
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
  createWanderAction,
};
