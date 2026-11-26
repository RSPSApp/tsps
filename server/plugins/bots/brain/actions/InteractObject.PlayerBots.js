"use strict";

const { MapObjects } = require("../../../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
const { resolveCatalogObjectIds } = require("../ObjectCatalog.PlayerBots");
const { playerState, stationaryFor } = require("../ActionState.PlayerBots");
const { canReachSpot } = require("../../behaviours/navigation/LongRoutes.PlayerBots");
const { createObjectReachChecker } = require("../../behaviours/navigation/ObjectReach.PlayerBots");
const {
  clearMovementRequest,
  peekMovementRequest,
  queueRouteAndFlagAppearance,
  randomInRange,
} = require("../../behaviours/navigation/Navigation.PlayerBots");

const MAX_TARGET_TILES = 64;
// Pick randomly among this many nearest live objects so a dense crowd of bots
// spreads over nearby trees/rocks instead of all felling the same one.
const TARGET_SPREAD = 6;
const MAX_DIRECT_ROUTE_TILES = 20;
const SEARCH_WALK_RADIUS = 10;
const INTERACT_COOLDOWN_MS = 1500;
// Clicks on the same object from the same tile that never produce (and never
// start a session) mean this bot cannot use it right now: it moves on to another
// for SKIP_CLICK_MS. Never shared, never about depletion: a depleted rock is a
// different object and is simply waited out until it respawns.
const UNREACHABLE_CLICKS = 3;
const SKIP_CLICK_MS = 2 * 60 * 1000;
// ...and only after this long since the first idle attempt: three quick attempts
// can all land inside one dispatch delay.
const UNREACHABLE_MIN_MS = 10000;
// Failing to reach something from far away says nothing about the thing (ores
// never run out; the walk may just be slow): only that bot skips it for a while.
// What is unreachable for everyone (an island) the route planner already knows.
const NEAR_TILES = 16;
const SKIP_MS = 10 * 60 * 1000;
const spotKey = (x, y, z) => `spot:${x >> 4},${y >> 4},${z}`;
// Shared: object key -> { player, until }. One gatherer per tree/rock, so a crowd
// spreads over the spot and then on to the next one instead of piling up.
const CLAIM_MS = 10000;
// Rocks respawn within seconds: only a crowd that lasts this long sends a gatherer
// on to the next spot.
const CROWDED_MOVE_ON_MS = 60000;
// A far walk that gets no closer for this long (fenced field, water) gives up on
// that spot and counts against its area; within ARRIVED_TILES it is just waiting.
const NO_PROGRESS_MS = 60000;
const ARRIVED_TILES = 20;
// A walk with a live movement request that produces no movement at all this long
// (the raw router cannot leave the bot's spot: a walled pen, a gate it cannot see)
// is dropped in seconds instead of being retried every tick.
const WALK_STALL_MS = 15000;
const CLAIMS = new Map();
// Claims hold players, so while bots keep claiming, expired ones are swept at least once per
// claim lifetime (and whenever the map passes this size). Once claiming stops, the last claims
// stay until the next one.
const MAX_CLAIMS = 2000;
let nextClaimSweepAt = 0;
function sweepClaims(nowMs) {
  nextClaimSweepAt = nowMs + CLAIM_MS;
  for (const [stale, entry] of CLAIMS) {
    if (entry.until <= nowMs || entry.player.isRegistered?.() === false) CLAIMS.delete(stale);
  }
}
function claim(key, player, nowMs) {
  if (CLAIMS.size > MAX_CLAIMS || nowMs >= nextClaimSweepAt) sweepClaims(nowMs);
  CLAIMS.set(key, { player, until: nowMs + CLAIM_MS });
}
function claimedByOther(key, player, nowMs) {
  const claim = CLAIMS.get(key);
  if (!claim) {
    return false;
  }
  if (claim.until <= nowMs || claim.player === player || claim.player.isRegistered?.() === false) {
    return false;
  }
  return true;
}

function objectKey(object) {
  const loc = object.getLocation();
  return `${object.getId()}:${loc.getX()}:${loc.getY()}:${loc.getZ()}`;
}

/**
 * Generic "walk to an object and use an option until X" action. Target
 * acquisition, segmented approach, then interact. Progress comes from the
 * skill plugins' produce events (BotBrainEvents), so this never polls the
 * inventory. State is per player: the action instance is shared.
 */
function createInteractObjectAction(spec, world) {
  const objectIds = resolveCatalogObjectIds(spec);
  const option = spec.option ?? "Chop down";
  const routeExists = world.routes?.canReachSpot ?? canReachSpot;
  const stallMs = Math.max(5, Number(spec.stallSeconds ?? 120)) * 1000;
  const untilAnyItem = (spec.until?.hasAnyItem ?? []).filter(Number.isInteger);
  const stateFor = (player) =>
    playerState(action, player, () => ({
      target: null,
      lastClickAt: 0,
      lastTargetKey: null,
      lastClickX: null,
      lastClickY: null,
      failedClicks: 0,
      // Nearest indexed object beyond live range, walked to when nothing is close.
      searchTarget: null,
      // This bot's own skips (object keys and far spots it could not get to) -> until.
      skips: new Map(),
      // Stationary-with-a-pending-walk watchdog.
      lastPosition: null,
      stillSince: 0,
    }));

  function findTarget(player, nowMs) {
    const bot = stateFor(player);
    bot.crowded = false;
    const loc = player.getLocation();
    const candidates =
      world.objectSearch?.findCandidatesByIds?.(player, objectIds, {
        regionRadius: 1,
        z: loc.getZ(),
        privateArea: player.getPrivateArea?.() ?? null,
      }) ?? [];
    const live = [];
    const maxDistSq = MAX_TARGET_TILES * MAX_TARGET_TILES;
    for (const object of candidates) {
      const objectLoc = object.getLocation();
      if (!objectLoc || objectLoc.getZ() !== loc.getZ()) {
        continue;
      }
      const dx = objectLoc.getX() - loc.getX();
      const dy = objectLoc.getY() - loc.getY();
      const distSq = dx * dx + dy * dy;
      if (distSq > maxDistSq) {
        continue;
      }
      if ((bot.skips.get(objectKey(object)) ?? 0) > nowMs) {
        continue;
      }
      if (claimedByOther(objectKey(object), player, nowMs)) {
        bot.crowded = true;
        continue;
      }
      live.push({ object, distSq });
    }
    live.sort((left, right) => left.distSq - right.distSq);
    const pool = live.slice(0, TARGET_SPREAD);
    const best = pool[Math.floor(Math.random() * pool.length)]?.object ?? null;
    if (best) {
      bot.searchTarget = null;
      bot.crowded = false;
      bot.movingOn = false;
      // Drop any leftover search walk: dispatched later it would drag the bot off
      // the rock (and moving cancels the skilling session).
      clearMovementRequest(player);
      claim(objectKey(best), player, nowMs);
    }
    bot.target = best
      ? {
          objectId: best.getId(),
          x: best.getLocation().getX(),
          y: best.getLocation().getY(),
          z: best.getLocation().getZ(),
        }
      : null;
  }

  const canReach = createObjectReachChecker(world.core);

  function resolveTargetObject(player) {
    const target = stateFor(player).target;
    if (!target) {
      return null;
    }
    const key = `${target.objectId}:${target.x}:${target.y}:${target.z}`;
    if (claimedByOther(key, player, Date.now())) {
      return null;
    }
    claim(key, player, Date.now());
    const loc = player.getLocation().clone();
    loc.set(target.x, target.y, target.z);
    return MapObjects.get(target.objectId, loc, player.getPrivateArea());
  }

  /**
   * Nothing in live range: head for the nearest indexed object (far regions are
   * never scanned; segmented walking covers the distance), else search around home.
   */
  /**
   * Nothing usable in live range. Commit to one far spot (the nearest indexed
   * object) and walk there; wait on arrival for respawns rather than turning back.
   * Give the spot up only if the walk stops getting closer, or after a lasting
   * crowd (then pick a spot past it).
   */
  function wander(player, state, nowMs) {
    const bot = stateFor(player);
    const here = player.getLocation();
    const distanceTo = (spot) => Math.max(Math.abs(here.getX() - spot.x), Math.abs(here.getY() - spot.y));
    if (!bot.crowded) {
      bot.crowdedSince = null;
    } else {
      bot.crowdedSince ??= nowMs;
      if (nowMs - bot.crowdedSince < CROWDED_MOVE_ON_MS) {
        return; // a rock is about to respawn or be freed: wait here
      }
      if (!bot.movingOn) {
        bot.movingOn = true;
        bot.searchTarget = null; // one new spot past the crowd
      }
    }
    if (bot.searchTarget) {
      const distance = distanceTo(bot.searchTarget);
      if (distance < bot.bestDistance) {
        bot.bestDistance = distance;
        bot.progressAt = nowMs;
        bot.walkProgress = true; // a long walk to a far spot is progress (madeProgress)
      } else if (distance > ARRIVED_TILES && nowMs - bot.progressAt >= NO_PROGRESS_MS) {
        // This bot cannot get there right now: it alone tries another spot.
        bot.skips.set(spotKey(bot.searchTarget.x, bot.searchTarget.y, bot.searchTarget.z ?? here.getZ()), nowMs + SKIP_MS);
        bot.searchTarget = null;
        // Moving on is progress: the frame stall must not fire while a bot works
        // through far spots it cannot currently walk to.
        bot.walkProgress = true;
      }
    }
    // The nearest spot the route planner can reach (an island is never picked).
    for (let attempt = 0; !bot.searchTarget && attempt < 4; attempt += 1) {
      const minDistance = bot.crowded ? MAX_TARGET_TILES : 0;
      const spot = world.objectSearch?.findNearestIndexedLocation?.(player, objectIds, {
        accept: (id, x, y, z) => (bot.skips.get(`${id}:${x}:${y}:${z}`) ?? 0) <= nowMs &&
          (bot.skips.get(spotKey(x, y, z)) ?? 0) <= nowMs &&
          Math.max(Math.abs(x - here.getX()), Math.abs(y - here.getY())) > minDistance,
      }) ?? null;
      if (!spot) {
        break;
      }
      const reachable = routeExists(player, spot, nowMs);
      if (reachable === undefined) {
        // Not planned yet (this tick's planning budget is spent): ask again next
        // tick rather than set off straight-line toward a spot across the sea.
        return;
      }
      if (reachable === false) {
        bot.skips.set(spotKey(spot.x, spot.y, spot.z ?? here.getZ()), nowMs + SKIP_MS);
        continue;
      }
      bot.searchTarget = spot;
      bot.bestDistance = distanceTo(spot);
      bot.progressAt = nowMs;
    }
    // Keep walking the current leg: re-randomising every tick zig-zags the bot.
    if (peekMovementRequest(player) || player.getMovementQueue?.()?.size?.() > 0) {
      return;
    }
    const home = bot.searchTarget ?? state?.home ?? { x: here.getX(), y: here.getY() };
    const targetX = home.x + randomInRange(-SEARCH_WALK_RADIUS, SEARCH_WALK_RADIUS);
    const targetY = home.y + randomInRange(-SEARCH_WALK_RADIUS, SEARCH_WALK_RADIUS);
    queueRouteAndFlagAppearance(player, targetX, targetY, {
      reason: "brain_search_walk",
      basicPather: true,
      // Home's floor: a bot left upstairs (a bank floor) takes the stairs back down.
      z: Number.isFinite(home.z) ? home.z : undefined,
    });
  }

  let debugCounter = 0;
  function debug(ctx, detail) {
    if (process.env.BOT_BRAIN_DEBUG !== "1") {
      return;
    }
    debugCounter += 1;
    if (debugCounter % 10 !== 0) {
      return;
    }
    const player = ctx.player;
    const loc = player.getLocation?.();
    const target = stateFor(player).target;
    world.log?.("bot_brain_interact_debug", {
      username: player.getUsername?.(),
      detail,
      x: loc?.getX?.() ?? null,
      y: loc?.getY?.() ?? null,
      queue: player.getMovementQueue?.()?.size?.() ?? 0,
      target: target ? `${target.objectId}@${target.x},${target.y}` : null,
    });
  }

  const action = {
    id: "interactObject",
    // Getting closer to a far spot keeps the activity alive: a long walk to the
    // next mine must not trip the produce-based stall before it arrives.
    madeProgress(ctx) {
      const bot = stateFor(ctx.player);
      const progressed = bot.walkProgress === true;
      bot.walkProgress = false;
      // Walking at a live target is progress: a long approach (or retargeting
      // across a mine) must not trip the frame stall before the bot arrives.
      return progressed || ctx.brain?.movedSinceLastTick?.() === true;
    },
    describe(ctx) {
      const bot = stateFor(ctx.player);
      const target = bot.target;
      return `gather target=${target ? `${target.objectId}@${target.x},${target.y}` : "none"} ` +
        `far=${bot.searchTarget ? `${bot.searchTarget.x},${bot.searchTarget.y}` : "none"} failedClicks=${bot.failedClicks}`;
    },
    update(ctx) {
      const { player, state, nowMs } = ctx;
      const bot = stateFor(player);
      const here = player.getLocation();
      const stationaryMs = stationaryFor(bot, player, nowMs);
      if (spec.until?.inventoryFull && player.getInventory().isFull()) {
        debug(ctx, "full");
        return "success";
      }
      // Done once any of these is held (one log for a cooking fire).
      if (untilAnyItem.some((itemId) => player.getInventory().getAmount(itemId) > 0)) {
        return "success";
      }
      if (world.isBusy?.(player)) {
        debug(ctx, "busy");
        return "running";
      }
      // A pending walk that has produced no movement at all is dropped: the router
      // cannot get this bot anywhere from here (a walled pen, an unseen gate), so
      // the target/spot is abandoned instead of being retried every tick.
      if (peekMovementRequest(player) && stationaryMs >= WALK_STALL_MS) {
        if (bot.target) {
          bot.skips.set(
            `${bot.target.objectId}:${bot.target.x}:${bot.target.y}:${bot.target.z}`,
            nowMs + SKIP_MS
          );
        }
        if (bot.searchTarget) {
          bot.skips.set(
            spotKey(bot.searchTarget.x, bot.searchTarget.y, bot.searchTarget.z ?? here.getZ()),
            nowMs + SKIP_MS
          );
        }
        bot.target = null;
        bot.searchTarget = null;
        bot.failedClicks = 0;
        bot.walkProgress = true;
        bot.stillSince = 0;
        clearMovementRequest(player);
        debug(ctx, "walk-stall-skip");
        return "running";
      }

      let object = bot.target ? resolveTargetObject(player) : null;
      if (!object) {
        bot.target = null;
        findTarget(player, nowMs);
        object = bot.target ? resolveTargetObject(player) : null;
        if (!object) {
          if (nowMs - ctx.frame.lastProgressAt > stallMs) {
            return "failed";
          }
          debug(ctx, "no-target");
          wander(player, state, nowMs);
          ctx.waitTicks = 2;
          return "wait";
        }
      }

      const target = bot.target;
      const loc = player.getLocation();
      if (process.env.BOT_GATHER_DEBUG === "1" && nowMs - (bot.debugAt ?? 0) >= 30000) {
        bot.debugAt = nowMs;
        const request = peekMovementRequest(player);
        world.log?.("bot_brain_interact_snapshot", {
          username: player.getUsername?.(),
          target: bot.target ? `${bot.target.objectId}@${bot.target.x},${bot.target.y}` : "none",
          far: bot.searchTarget ? `${bot.searchTarget.x},${bot.searchTarget.y}` : "none",
          walk: request ? `${request.x},${request.y} basic=${request.basicPather === true}` : "none",
          queue: player.getMovementQueue?.()?.size?.() ?? 0,
          failed: bot.failedClicks,
          x: loc.getX(),
          y: loc.getY(),
        });
      }
      const distance = Math.max(
        Math.abs(loc.getX() - target.x),
        Math.abs(loc.getY() - target.y)
      );
      if (player.getForceMovement?.() != null) {
        debug(ctx, "force");
        return "running";
      }
      if (player.getMovementQueue?.()?.size?.() > 0) {
        debug(ctx, `queue:${player.getMovementQueue().size()}`);
        return "running";
      }
      // Re-issuing walkToObject every tick keeps resetting the route before its
      // arrival callback fires, so the click never lands. Space them out.
      if (nowMs - bot.lastClickAt < INTERACT_COOLDOWN_MS) {
        debug(ctx, "cooldown");
        return "running";
      }

      const objectLoc = object.getLocation();
      const key = objectKey(object);
      const now = player.getLocation();
      const stayedPut =
        bot.lastClickX === now.getX() && bot.lastClickY === now.getY();
      // A repeat click only counts as failed when nothing was produced since the
      // last one: a rock that gave its ore, depleted and respawned is clicked again
      // from the same tile by a bot that is mining it just fine.
      const producedSinceClick = ctx.frame.lastProgressAt > bot.lastClickAt;
      bot.failedClicks =
        bot.lastTargetKey === key && stayedPut && !producedSinceClick ? bot.failedClicks + 1 : 0;
      if (bot.failedClicks === 1) {
        bot.failingSince = nowMs;
      }
      if (bot.failedClicks >= UNREACHABLE_CLICKS && nowMs - bot.failingSince >= UNREACHABLE_MIN_MS) {
        // This bot alone moves on: its walk never got there (far), or its clicks do
        // nothing here (near). Other bots keep using the object.
        bot.skips.set(key, nowMs + (distance > NEAR_TILES ? SKIP_MS : SKIP_CLICK_MS));
        bot.target = null;
        bot.lastTargetKey = null;
        bot.failedClicks = 0;
        // Repicking is the action making progress: the frame stall must not fire
        // while a bot works through targets it cannot currently reach.
        bot.walkProgress = true;
        debug(ctx, "unreachable-repick");
        findTarget(player, nowMs);
        return "running";
      }
      bot.lastTargetKey = key;
      bot.lastClickX = now.getX();
      bot.lastClickY = now.getY();
      bot.lastClickAt = nowMs;
      if (distance > MAX_DIRECT_ROUTE_TILES || !canReach(player, object)) {
        // Far away, or a fence/closed gate in the way: walkToObject would just fail,
        // so walk at it with brain movement (staged, opens the blocking gate).
        // Counted like a click: no movement and no produce blacklists it.
        debug(ctx, `approach:${distance}`);
        queueRouteAndFlagAppearance(player, objectLoc.getX(), objectLoc.getY(), {
          nowMs, reason: "brain_target_approach", basicPather: true,
        });
        return "running";
      }
      clearMovementRequest(player);
      const queue = player.getMovementQueue();
      debug(
        ctx,
        `interact:${distance}:obj=${object.getId()}@${objectLoc.getX()},${objectLoc.getY()}`
      );
      queue.walkToObject(object, {
        execute: () => {
          if (process.env.BOT_BRAIN_DEBUG === "1") {
            world.log?.("bot_brain_interact_click", {
              username: player.getUsername?.(),
              objectId: object.getId(),
              x: objectLoc.getX(),
              y: objectLoc.getY(),
            });
          }
          world.emitObjectInteraction?.({
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
        },
      });
      return "running";
    },
    stop(ctx) {
      const player = ctx?.player;
      if (!player) {
        return;
      }
      stateFor(player).target = null;
    },
  };
  return action;
}

module.exports = {
  CLAIMS,
  claim,
  createInteractObjectAction,
};
