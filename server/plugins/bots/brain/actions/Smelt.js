"use strict";

const Smithing = require("../../../skills/Smithing.plugin");
const { resolveCatalogObjectIds } = require("../BotObjectCatalog");
const { playerState } = require("../ActionState");
const { approachObject } = require("../../behaviours/navigation/BotNavigation");

const FURNACE_IDS = Object.freeze(
  resolveCatalogObjectIds({ catalog: "furnace" })
);
const MAX_DIRECT_ROUTE_TILES = 20;
const INTERACT_COOLDOWN_MS = 1500;

function resolveRecipe(spec) {
  if (spec.barId) {
    return Smithing.SMELTING_RECIPES?.find((recipe) => recipe.barId === spec.barId) ?? null;
  }
  const wanted = String(spec.bar ?? "").replace(/_/g, " ").toLowerCase();
  return (
    Smithing.SMELTING_RECIPES?.find(
      (recipe) => String(recipe.name ?? "").toLowerCase() === wanted
    ) ?? null
  );
}

/**
 * Smelts the inventory's ores at the nearest furnace, completing when no bar's
 * worth of ingredients is left (the activity then banks and repeats). Wraps the
 * smithing plugin's bot entry point, so no interface clicking is needed.
 */
function createSmeltAction(spec, world) {
  const recipe = resolveRecipe(spec);
  const stateFor = (player) =>
    playerState(action, player, () => ({ lastClickAt: 0 }));

  function barsFromInventory(player, targetRecipe) {
    const inventory = player?.getInventory?.();
    if (!inventory || !targetRecipe?.ingredients?.length) {
      return 0;
    }
    let bars = Number.MAX_SAFE_INTEGER;
    for (const [itemId, amount] of targetRecipe.ingredients) {
      if (!Number.isInteger(itemId) || !Number.isInteger(amount) || amount <= 0) {
        return 0;
      }
      bars = Math.min(bars, Math.floor(inventory.getAmount(itemId) / amount));
    }
    return bars === Number.MAX_SAFE_INTEGER ? 0 : bars;
  }

  function findFurnace(player) {
    const loc = player.getLocation();
    const candidates =
      world.objectSearch?.findCandidatesByIds?.(player, FURNACE_IDS, {
        regionRadius: 2,
        z: loc.getZ(),
        privateArea: player.getPrivateArea?.() ?? null,
      }) ?? [];
    let best = null;
    let bestDistSq = Number.MAX_SAFE_INTEGER;
    for (const object of candidates) {
      const objectLoc = object?.getLocation?.();
      if (!objectLoc || objectLoc.getZ() !== loc.getZ()) {
        continue;
      }
      const dx = objectLoc.getX() - loc.getX();
      const dy = objectLoc.getY() - loc.getY();
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = object;
      }
    }
    return best;
  }

  const action = {
    id: "smelt",
    update(ctx) {
      const { player, nowMs } = ctx;
      const bot = stateFor(player);
      if (!recipe) {
        return "failed";
      }
      if (Smithing.isSmeltingActive?.(player)) {
        return "running";
      }
      const bars = barsFromInventory(player, recipe);
      if (bars <= 0) {
        return "success";
      }
      const furnace = findFurnace(player);
      if (!furnace) {
        return "failed";
      }
      const furnaceLoc = furnace.getLocation();
      const loc = player.getLocation();
      const distance = Math.max(
        Math.abs(loc.getX() - furnaceLoc.getX()),
        Math.abs(loc.getY() - furnaceLoc.getY())
      );
      if (distance > MAX_DIRECT_ROUTE_TILES) {
        approachObject(player, furnace, { nowMs, reason: "brain_furnace_approach" });
        return "running";
      }
      if (player.getForceMovement?.() != null) {
        return "running";
      }
      if (player.getMovementQueue?.()?.size?.() > 0) {
        return "running";
      }
      if (nowMs - bot.lastClickAt < INTERACT_COOLDOWN_MS) {
        return "running";
      }
      bot.lastClickAt = nowMs;

      player.getMovementQueue().walkToObject(furnace, {
        execute: () => {
          world.emitObjectInteraction?.({
            player,
            object: furnace,
            objectId: furnace.getId(),
            clickType: 1,
            location: {
              x: furnaceLoc.getX(),
              y: furnaceLoc.getY(),
              z: furnaceLoc.getZ(),
            },
            sourceLocation: {
              x: player.getLocation().getX(),
              y: player.getLocation().getY(),
              z: player.getLocation().getZ(),
            },
            handled: false,
          });
          const available = barsFromInventory(player, recipe);
          if (available > 0) {
            Smithing.startBotSmelting?.(player, recipe, available);
          }
        },
      });
      return "running";
    },
    stop(ctx) {
      const player = ctx?.player;
      if (!player) {
        return;
      }
      stateFor(player).lastClickAt = 0;
    },
  };
  return action;
}

module.exports = {
  createSmeltAction,
};
