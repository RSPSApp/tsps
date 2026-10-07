const { Flag } = require("../../../../src/main/typescript/elvarg/game/model/Flag");
const { PathFinder } = require("../../../../src/main/typescript/elvarg/game/model/movement/path/PathFinder");
const { isOutsideWildernessHotspots } = require("../pvp/WildernessHotspotRegistry");

const MAX_ROUTE_SEGMENT_TILES = 24;
// Objects farther than this are approached in segments; see approachObject.
const MAX_OBJECT_DIRECT_ROUTE_TILES = 20;
const PATH_BLOCKED_LOG_THROTTLE_MS = 2500;
const NO_PATH_RETRY_BASE_MS = 1200;
const NO_PATH_RETRY_MAX_MS = 6000;
const SAME_SEGMENT_RETRY_BASE_MS = 1800;
const SAME_SEGMENT_RETRY_MAX_MS = 12000;
const UNREACHABLE_SEGMENT_COOLDOWN_BASE_MS = 1200;
const UNREACHABLE_SEGMENT_COOLDOWN_MAX_MS = 12000;
const UNREACHABLE_SEGMENT_TTL_MS = 30000;
const UNREACHABLE_SEGMENT_MAX_TRACKED = 24;
const MOVEMENT_REQUEST_REFRESH_GRACE_MS = 250;
const FORBIDDEN_TARGET_Y = new Set([3521, 3522]);
const PVP_ONLY_NON_WILD_STRIP_Y = new Set([3523, 3524]);
const pendingMovementByPlayer = new WeakMap();
const unreachableSegmentsByPlayer = new WeakMap();
const pathBlockedLogStateByUsername = new Map();

function consumePathBlockedLogBudget(username, nowMs) {
  if (!username) {
    return { shouldLog: true, suppressedCount: 0 };
  }
  const state =
    pathBlockedLogStateByUsername.get(username) ?? {
      lastLogAt: 0,
      suppressedCount: 0,
    };
  if (nowMs - state.lastLogAt < PATH_BLOCKED_LOG_THROTTLE_MS) {
    state.suppressedCount += 1;
    pathBlockedLogStateByUsername.set(username, state);
    return { shouldLog: false, suppressedCount: state.suppressedCount };
  }
  const suppressedCount = state.suppressedCount;
  state.lastLogAt = nowMs;
  state.suppressedCount = 0;
  pathBlockedLogStateByUsername.set(username, state);
  return { shouldLog: true, suppressedCount };
}

function randomInRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getUnreachableSegmentTracker(player) {
  if (!player) {
    return null;
  }
  let tracker = unreachableSegmentsByPlayer.get(player);
  if (!tracker) {
    tracker = new Map();
    unreachableSegmentsByPlayer.set(player, tracker);
  }
  return tracker;
}

function segmentKey(x, y, z) {
  return `${x},${y},${z}`;
}

function isPvpOnlyState(state) {
  const modes = state?.autonomy?.allowedAutonomousModes;
  return (
    Array.isArray(modes) &&
    modes.length === 1 &&
    modes[0] === "pvp"
  );
}

function isForbiddenTargetY(y, pvpOnly = false) {
  if (!Number.isFinite(y)) {
    return false;
  }
  const normalizedY = Math.floor(y);
  if (FORBIDDEN_TARGET_Y.has(normalizedY)) {
    return true;
  }
  return pvpOnly === true && PVP_ONLY_NON_WILD_STRIP_Y.has(normalizedY);
}

function sanitizeTargetTile(player, pvpOnly, targetX, targetY) {
  const safeX = Math.floor(targetX);
  const y = Math.floor(targetY);
  if (!isForbiddenTargetY(y, pvpOnly)) {
    return { x: safeX, y };
  }
  const currentY = player?.getLocation?.()?.getY?.();
  const safeY = Number.isFinite(currentY) && currentY <= 3522 ? 3520 : 3525;
  return { x: safeX, y: safeY };
}

function pruneUnreachableSegments(tracker, nowMs) {
  if (!tracker || tracker.size <= 0) {
    return;
  }
  const staleBefore = nowMs - UNREACHABLE_SEGMENT_TTL_MS;
  for (const [key, entry] of tracker.entries()) {
    if (!entry || Number(entry.lastFailedAt ?? 0) < staleBefore) {
      tracker.delete(key);
    }
  }
  if (tracker.size <= UNREACHABLE_SEGMENT_MAX_TRACKED) {
    return;
  }
  const byOldest = Array.from(tracker.entries()).sort(
    (a, b) => Number(a[1]?.lastFailedAt ?? 0) - Number(b[1]?.lastFailedAt ?? 0)
  );
  const removeCount = tracker.size - UNREACHABLE_SEGMENT_MAX_TRACKED;
  for (let index = 0; index < removeCount; index++) {
    tracker.delete(byOldest[index][0]);
  }
}

function isAtTarget(player, target) {
  if (!player || !target) {
    return false;
  }
  const loc = player.getLocation();
  return (
    loc.getX() === target.x &&
    loc.getY() === target.y &&
    loc.getZ() === target.z
  );
}

function chooseNextTarget(player, state, botWalkRadius, options = {}) {
  if (!player || !state?.home) {
    return null;
  }

  const roamBounds = options?.bounds ?? null;
  const homeX = state.home.x;
  const homeY = state.home.y;
  const homeZ =
    Number.isFinite(roamBounds?.z) ? roamBounds.z : state.home.z ?? player.getLocation().getZ();
  const currentX = player.getLocation().getX();
  const currentY = player.getLocation().getY();
  const previousTarget = state.roaming?.target;
  const pvpOnly = isPvpOnlyState(state);
  const acceptTarget = (target) =>
    (typeof options.acceptTarget !== "function" || options.acceptTarget(target) === true) &&
    (!pvpOnly || !!state?.pvp?.hotspotId || isOutsideWildernessHotspots(target));
  const radiusSq = botWalkRadius * botWalkRadius;
  const maxAttempts = 24;

  if (roamBounds) {
    const minX = Math.floor(roamBounds.minX);
    const maxX = Math.floor(roamBounds.maxX);
    const minY = Math.floor(roamBounds.minY);
    const maxY = Math.floor(roamBounds.maxY);
    if (maxX >= minX && maxY >= minY) {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const targetX = randomInRange(minX, maxX);
        const targetY = randomInRange(minY, maxY);
        if (isForbiddenTargetY(targetY, pvpOnly)) {
          continue;
        }
        if (targetX === currentX && targetY === currentY) {
          continue;
        }
        if (
          previousTarget &&
          targetX === previousTarget.x &&
          targetY === previousTarget.y &&
          attempt < maxAttempts - 1
        ) {
          continue;
        }
        const candidate = { x: targetX, y: targetY, z: homeZ };
        if (acceptTarget && acceptTarget(candidate) !== true) {
          continue;
        }
        return candidate;
      }
    }
  }

  // Keep roaming local to each bot's home tile; ditch crossing remains organic
  // and is only triggered by path-blocked handling when a route is obstructed.
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const dx = randomInRange(-botWalkRadius, botWalkRadius);
    const dy = randomInRange(-botWalkRadius, botWalkRadius);
    if (dx * dx + dy * dy > radiusSq) {
      continue;
    }

    const targetX = homeX + dx;
    const targetY = homeY + dy;
    if (isForbiddenTargetY(targetY, pvpOnly)) {
      continue;
    }
    if (targetX === currentX && targetY === currentY) {
      continue;
    }
    if (
      previousTarget &&
      targetX === previousTarget.x &&
      targetY === previousTarget.y &&
      attempt < maxAttempts - 1
    ) {
      continue;
    }
    const candidate = { x: targetX, y: targetY, z: homeZ };
    if (acceptTarget && acceptTarget(candidate) !== true) {
      continue;
    }
    return candidate;
  }

  const fallbackTargets = [
    [homeX + botWalkRadius, homeY],
    [homeX - botWalkRadius, homeY],
    [homeX, homeY + botWalkRadius],
    [homeX, homeY - botWalkRadius],
    [homeX, homeY],
  ];

  for (const [targetX, targetY] of fallbackTargets) {
    if (isForbiddenTargetY(targetY, pvpOnly)) {
      continue;
    }
    if (targetX === currentX && targetY === currentY) {
      continue;
    }
    const candidate = { x: targetX, y: targetY, z: homeZ };
    if (acceptTarget && acceptTarget(candidate) !== true) {
      continue;
    }
    return candidate;
  }

  return null;
}

function calculateStrictWalkRoute(player, targetX, targetY) {
  // Bot ditch traversal depends on `path_blocked` events. The default walk route
  // uses basic fallback and can stop near the target instead of reporting blocked.
  return PathFinder.calculateRoute(player, 0, targetX, targetY, 0, 0, 0, 0, false);
}

function calculateWalkRoute(player, targetX, targetY) {
  return PathFinder.calculateRoute(player, 0, targetX, targetY, 0, 0, 0, 0, true);
}

function resolveSegmentTarget(
  player,
  pvpOnly,
  targetX,
  targetY,
  maxRouteSegmentTiles = MAX_ROUTE_SEGMENT_TILES
) {
  if (!player) {
    return sanitizeTargetTile(player, pvpOnly, targetX, targetY);
  }
  const maxSegmentTiles = Math.max(1, Math.floor(maxRouteSegmentTiles));
  const loc = player.getLocation();
  const currentX = loc.getX();
  const currentY = loc.getY();
  const dx = targetX - currentX;
  const dy = targetY - currentY;
  const chebyshevDistance = Math.max(Math.abs(dx), Math.abs(dy));
  if (chebyshevDistance <= maxSegmentTiles) {
    return sanitizeTargetTile(player, pvpOnly, targetX, targetY);
  }

  const ratio = maxSegmentTiles / chebyshevDistance;
  let segmentX = currentX + Math.round(dx * ratio);
  let segmentY = currentY + Math.round(dy * ratio);

  if (segmentX === currentX && dx !== 0) {
    segmentX += Math.sign(dx);
  }
  if (segmentY === currentY && dy !== 0) {
    segmentY += Math.sign(dy);
  }

  return sanitizeTargetTile(player, pvpOnly, segmentX, segmentY);
}

function queueRouteAndFlagAppearance(player, targetX, targetY, options = {}) {
  return requestMovement(player, targetX, targetY, options);
}

function requestMovement(player, targetX, targetY, options = {}) {
  if (!player) {
    return false;
  }
  if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
    return false;
  }
  const loc = player.getLocation?.();
  const z = Number.isFinite(options.z) ? Math.floor(options.z) : loc?.getZ?.();
  const pvpOnly = isPvpOnlyState(options.state ?? null);
  const target = sanitizeTargetTile(player, pvpOnly, targetX, targetY);
  const requestedAtMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const maxRouteSegmentTiles =
    Number.isFinite(options.maxRouteSegmentTiles) &&
    options.maxRouteSegmentTiles > 0
      ? Math.floor(options.maxRouteSegmentTiles)
      : MAX_ROUTE_SEGMENT_TILES;
  const basicPather = options.basicPather === true;
  const nextDispatchAtMs = Number.isFinite(options.nextDispatchAtMs)
    ? Math.max(0, Math.floor(options.nextDispatchAtMs))
    : 0;
  const existing = pendingMovementByPlayer.get(player);

  if (
    existing &&
    existing.x === target.x &&
    existing.y === target.y &&
    existing.z === (Number.isFinite(z) ? z : null) &&
    existing.pvpOnly === pvpOnly &&
    existing.basicPather === basicPather &&
    existing.maxRouteSegmentTiles === maxRouteSegmentTiles
  ) {
    existing.reason =
      typeof options.reason === "string" ? options.reason : existing.reason ?? null;
    existing.requestedAtMs = requestedAtMs;
    if (nextDispatchAtMs > 0) {
      existing.nextDispatchAtMs = Math.max(
        Number(existing.nextDispatchAtMs ?? 0),
        nextDispatchAtMs
      );
    } else if (
      Number.isFinite(existing.lastDispatchedAtMs) &&
      existing.lastDispatchedAtMs > 0 &&
      requestedAtMs - existing.lastDispatchedAtMs <= MOVEMENT_REQUEST_REFRESH_GRACE_MS
    ) {
      existing.nextDispatchAtMs = Math.max(
        Number(existing.nextDispatchAtMs ?? 0),
        existing.lastDispatchedAtMs + MOVEMENT_REQUEST_REFRESH_GRACE_MS
      );
    }
    return true;
  }

  pendingMovementByPlayer.set(player, {
    x: target.x,
    y: target.y,
    z: Number.isFinite(z) ? z : null,
    reason: typeof options.reason === "string" ? options.reason : null,
    requestedAtMs,
    maxRouteSegmentTiles,
    basicPather,
    pvpOnly,
    state: options.state,
    nextDispatchAtMs,
    noPathAttempts: 0,
    sameSegmentNoPathAttempts: 0,
    lastFailedSegmentKey: null,
    lastSegmentX: null,
    lastSegmentY: null,
    lastSegmentZ: null,
    lastDispatchedAtMs: 0,
  });
  return true;
}

/**
 * The pathfinder only routes inside a 128-tile window around the player, so an object
 * farther than `maxDirectTiles` must be approached in segments before the final
 * walkToObject route. Returns true when a segmented approach was queued (the caller
 * should wait); false when the object is close enough to route to directly.
 */
function approachObject(player, object, options = {}) {
  const objectLoc = object?.getLocation?.();
  const playerLoc = player?.getLocation?.();
  if (!objectLoc || !playerLoc) {
    return false;
  }
  const maxDirectTiles =
    Number.isFinite(options.maxDirectTiles) && options.maxDirectTiles > 0
      ? Math.floor(options.maxDirectTiles)
      : MAX_OBJECT_DIRECT_ROUTE_TILES;
  const distance = Math.max(
    Math.abs(playerLoc.getX() - objectLoc.getX()),
    Math.abs(playerLoc.getY() - objectLoc.getY())
  );
  if (distance <= maxDirectTiles) {
    return false;
  }
  queueRouteAndFlagAppearance(player, objectLoc.getX(), objectLoc.getY(), {
    nowMs: options.nowMs,
    reason: options.reason ?? "object_approach",
    // moveNear: an exact-tile route keeps failing on the last segment before water,
    // which stalls the whole approach; the caller only needs progress.
    basicPather: options.basicPather !== false,
    maxRouteSegmentTiles: options.maxRouteSegmentTiles,
  });
  return true;
}

function peekMovementRequest(player) {
  if (!player) {
    return null;
  }
  return pendingMovementByPlayer.get(player) ?? null;
}

function clearMovementRequest(player) {
  if (!player) {
    return;
  }
  pendingMovementByPlayer.delete(player);
}

function dispatchMovementRequest(player, request, state = request?.state) {
  if (!player || !request) {
    return null;
  }
  const nowMs = Date.now();
  const segmentTarget = resolveSegmentTarget(
    player,
    request.pvpOnly === true,
    request.x,
    request.y,
    request.maxRouteSegmentTiles
  );
  const segmentZ = Number.isFinite(request.z)
    ? request.z
    : player.getLocation()?.getZ?.() ?? 0;
  const unreachableTracker = getUnreachableSegmentTracker(player);
  if (unreachableTracker) {
    pruneUnreachableSegments(unreachableTracker, nowMs);
    const key = segmentKey(segmentTarget.x, segmentTarget.y, segmentZ);
    const previousFailure = unreachableTracker.get(key);
    if (
      previousFailure &&
      Number.isFinite(previousFailure.untilMs) &&
      nowMs < previousFailure.untilMs
    ) {
      request.lastSegmentX = segmentTarget.x;
      request.lastSegmentY = segmentTarget.y;
      request.lastSegmentZ = segmentZ;
      request.lastDispatchedAtMs = nowMs;
      request.nextDispatchAtMs = Math.max(
        Number(request.nextDispatchAtMs ?? 0),
        previousFailure.untilMs
      );
      return {
        segmentTarget,
        hasRoute: false,
        steps: 0,
        skippedByCooldown: true,
      };
    }
  }
  let steps =
    request.basicPather === true
      ? calculateWalkRoute(player, segmentTarget.x, segmentTarget.y)
      : calculateStrictWalkRoute(player, segmentTarget.x, segmentTarget.y);
  if (isPvpOnlyState(state) && !state?.pvp?.hotspotId) {
    // Check intermediate tiles too: the queue can contain distant checkpoints.
    const queue = player.getMovementQueue();
    let x = player.getLocation().getX();
    let y = player.getLocation().getY();
    route: for (const point of queue.pointsReturn()) {
      const destination = point.position;
      while (x !== destination.getX() || y !== destination.getY()) {
        x += Math.sign(destination.getX() - x);
        y += Math.sign(destination.getY() - y);
        if (!isOutsideWildernessHotspots({ x, y, z: destination.getZ() })) {
          queue.reset();
          steps = 0;
          if (state.roaming) state.roaming.target = null;
          clearMovementRequest(player);
          break route;
        }
      }
    }
  }
  const hasRoute = Number.isFinite(steps) ? steps > 0 : false;
  request.lastSegmentX = segmentTarget.x;
  request.lastSegmentY = segmentTarget.y;
  request.lastSegmentZ = segmentZ;
  request.lastDispatchedAtMs = nowMs;

  if (hasRoute) {
    request.noPathAttempts = 0;
    request.sameSegmentNoPathAttempts = 0;
    request.lastFailedSegmentKey = null;
    request.nextDispatchAtMs = 0;
    if (unreachableTracker) {
      unreachableTracker.delete(segmentKey(segmentTarget.x, segmentTarget.y, segmentZ));
    }
    player.getUpdateFlag().flag(Flag.APPEARANCE);
  } else {
    const currentSegmentKey = segmentKey(segmentTarget.x, segmentTarget.y, segmentZ);
    const attempts = Math.max(0, Number(request.noPathAttempts ?? 0)) + 1;
    request.noPathAttempts = attempts;
    const sameSegmentAttempts =
      request.lastFailedSegmentKey === currentSegmentKey
        ? Math.max(0, Number(request.sameSegmentNoPathAttempts ?? 0)) + 1
        : 1;
    request.sameSegmentNoPathAttempts = sameSegmentAttempts;
    request.lastFailedSegmentKey = currentSegmentKey;
    const retryDelayMs = Math.min(
      NO_PATH_RETRY_MAX_MS,
      NO_PATH_RETRY_BASE_MS * 2 ** Math.min(attempts - 1, 3)
    );
    const sameSegmentRetryDelayMs = Math.min(
      SAME_SEGMENT_RETRY_MAX_MS,
      SAME_SEGMENT_RETRY_BASE_MS * 2 ** Math.min(sameSegmentAttempts - 1, 3)
    );
    let unreachableUntilMs = 0;
    if (unreachableTracker) {
      const previousFailure = unreachableTracker.get(currentSegmentKey);
      const segmentAttempts =
        Math.max(0, Number(previousFailure?.attempts ?? 0)) + 1;
      const segmentCooldownMs = Math.min(
        UNREACHABLE_SEGMENT_COOLDOWN_MAX_MS,
        UNREACHABLE_SEGMENT_COOLDOWN_BASE_MS * 2 ** Math.min(segmentAttempts - 1, 4)
      );
      unreachableUntilMs = nowMs + segmentCooldownMs;
      unreachableTracker.set(currentSegmentKey, {
        attempts: segmentAttempts,
        untilMs: unreachableUntilMs,
        lastFailedAt: nowMs,
      });
    }
    request.nextDispatchAtMs = Math.max(
      nowMs + retryDelayMs,
      nowMs + sameSegmentRetryDelayMs,
      unreachableUntilMs
    );
  }

  return {
    segmentTarget,
    hasRoute,
    steps: Number.isFinite(steps) ? steps : 0,
  };
}

module.exports = {
  approachObject,
  calculateStrictWalkRoute,
  chooseNextTarget,
  clearMovementRequest,
  dispatchMovementRequest,
  isAtTarget,
  peekMovementRequest,
  queueRouteAndFlagAppearance,
  randomInRange,
  requestMovement,
  resolveSegmentTarget,
};
