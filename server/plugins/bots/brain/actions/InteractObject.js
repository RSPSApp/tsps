"use strict";

const { MapObjects } = require("../../../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
const { resolveCatalogObjectIds } = require("../BotObjectCatalog");
const { playerState } = require("../ActionState");
const {
  approachObject,
  queueRouteAndFlagAppearance,
  randomInRange,
} = require("../../behaviours/navigation/BotNavigation");

const MAX_TARGET_TILES = 64;
// Pick randomly among this many nearest live objects so a dense crowd of bots
// spreads over nearby trees/rocks instead of all felling the same one.
const TARGET_SPREAD = 6;
const MAX_DIRECT_ROUTE_TILES = 20;
const SEARCH_WALK_RADIUS = 10;
const INTERACT_COOLDOWN_MS = 1500;
// Consecutive clicks on the same object from the same tile that never start a
// session mean the route failed (tree behind a closed gate/fence). Blacklist and
// repick instead of parking there forever.
const UNREACHABLE_CLICKS = 2;
const UNREACHABLE_AVOID_MS = 5 * 60 * 1000;
// Shared by every bot and activity: one bot learning a tree is unreachable
// spares the rest of the crowd from re-pathing to it. Keyed by object + tile,
// so it is bounded by the number of objects bots ever target.
const UNREACHABLE_UNTIL = new Map();

function objectKey(object) {
  const loc = object.getLocation();
  return `${object.getId()}:${loc.getX()}:${loc.getY()}:${loc.getZ()}`;
}

function isAvoided(key, nowMs) {
  const until = UNREACHABLE_UNTIL.get(key);
  if (until === undefined) {
    return false;
  }
  if (until > nowMs) {
    return true;
  }
  UNREACHABLE_UNTIL.delete(key);
  return false;
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
  const stallMs = Math.max(5, Number(spec.stallSeconds ?? 120)) * 1000;
  const stateFor = (player) =>
    playerState(action, player, () => ({
      target: null,
      lastClickAt: 0,
      lastTargetKey: null,
      lastClickX: null,
      lastClickY: null,
      failedClicks: 0,
    }));

  function findTarget(player, nowMs) {
    const bot = stateFor(player);
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
      if (isAvoided(objectKey(object), nowMs)) {
        continue;
      }
      live.push({ object, distSq });
    }
    live.sort((left, right) => left.distSq - right.distSq);
    const pool = live.slice(0, TARGET_SPREAD);
    const best = pool[Math.floor(Math.random() * pool.length)]?.object ?? null;
    bot.target = best
      ? {
          objectId: best.getId(),
          x: best.getLocation().getX(),
          y: best.getLocation().getY(),
          z: best.getLocation().getZ(),
        }
      : null;
  }

  function resolveTargetObject(player) {
    const target = stateFor(player).target;
    if (!target) {
      return null;
    }
    const loc = player.getLocation().clone();
    loc.set(target.x, target.y, target.z);
    return MapObjects.get(target.objectId, loc, player.getPrivateArea());
  }

  function wander(player, state) {
    const home = state?.home ?? player.getLocation();
    const targetX = home.x + randomInRange(-SEARCH_WALK_RADIUS, SEARCH_WALK_RADIUS);
    const targetY = home.y + randomInRange(-SEARCH_WALK_RADIUS, SEARCH_WALK_RADIUS);
    queueRouteAndFlagAppearance(player, targetX, targetY, {
      reason: "brain_search_walk",
      basicPather: true,
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
    update(ctx) {
      const { player, state, nowMs } = ctx;
      const bot = stateFor(player);
      if (spec.until?.inventoryFull && player.getInventory().isFull()) {
        debug(ctx, "full");
        return "success";
      }
      if (world.isBusy?.(player)) {
        debug(ctx, "busy");
        return "running";
      }

      let object = bot.target ? resolveTargetObject(player) : null;
      // Another bot may have flagged this target unreachable since it was picked.
      if (object && isAvoided(objectKey(object), nowMs)) {
        object = null;
      }
      if (!object) {
        bot.target = null;
        findTarget(player, nowMs);
        object = bot.target ? resolveTargetObject(player) : null;
        if (!object) {
          if (nowMs - ctx.frame.lastProgressAt > stallMs) {
            return "failed";
          }
          debug(ctx, "no-target");
          wander(player, state);
          ctx.waitTicks = 2;
          return "wait";
        }
      }

      const target = bot.target;
      const loc = player.getLocation();
      const distance = Math.max(
        Math.abs(loc.getX() - target.x),
        Math.abs(loc.getY() - target.y)
      );
      if (distance > MAX_DIRECT_ROUTE_TILES) {
        debug(ctx, `approach:${distance}`);
        approachObject(player, object, { nowMs, reason: "brain_target_approach" });
        return "running";
      }
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
      bot.failedClicks =
        bot.lastTargetKey === key && stayedPut ? bot.failedClicks + 1 : 0;
      if (bot.failedClicks >= UNREACHABLE_CLICKS) {
        // Once per object (bot event logging is off by default, so this goes
        // to the server log where core's per-click warning used to land).
        if (!UNREACHABLE_UNTIL.has(key)) {
          console.warn("[bots] object unreachable", {
            object: key,
            from: `${now.getX()},${now.getY()}`,
          });
        }
        UNREACHABLE_UNTIL.set(key, nowMs + UNREACHABLE_AVOID_MS);
        bot.target = null;
        bot.lastTargetKey = null;
        bot.failedClicks = 0;
        debug(ctx, "unreachable-repick");
        findTarget(player, nowMs);
        return "running";
      }
      bot.lastTargetKey = key;
      bot.lastClickX = now.getX();
      bot.lastClickY = now.getY();
      bot.lastClickAt = nowMs;
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
  createInteractObjectAction,
  isAvoided,
  UNREACHABLE_UNTIL,
};
