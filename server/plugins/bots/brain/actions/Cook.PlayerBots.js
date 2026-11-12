"use strict";

const { playerState } = require("../ActionState.PlayerBots");
const { resolveCatalogObjectIds } = require("../ObjectCatalog.PlayerBots");
const { createObjectReachChecker } = require("../../behaviours/navigation/ObjectReach.PlayerBots");
const {
  approachBlockedObject,
  approachObject,
  peekMovementRequest,
  clearMovementRequest,
} = require("../../behaviours/navigation/Navigation.PlayerBots");
const { createInteractObjectAction } = require("./InteractObject.PlayerBots");
const { createEquipToolAction } = require("./EquipTool.PlayerBots");
const Cooking = require("../../../skills/Cooking.plugin");
const Firemaking = require("../../../skills/Firemaking.plugin");
const { ItemIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");

// A range further than this is not worth the walk: light a fire instead.
const RANGE_SEARCH_TILES = 24;
// Fires (anyone's) this close are cooked on.
const FIRE_SEARCH_TILES = 8;
const DIRECT_ROUTE_TILES = 20;
const INTERACT_COOLDOWN_MS = 1800;
// Used this many times without the cooking starting (wrong side of a counter): skip it.
const FAILED_USES = 3;
const AVOID_MS = 2 * 60 * 1000;
const TINDERBOX = ItemIds.TINDERBOX;
// The amount a bot picks in the cook menu: everything.
const COOK_ALL = 28;

const tileKey = (object) => {
  const loc = object.getLocation();
  return `${object.getId()}:${loc.getX()},${loc.getY()},${loc.getZ()}`;
};
const chebyshev = (a, b) => Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY()));

/**
 * Cooks the raw food the bot can cook, through the cooking plugin (food used on a range
 * or fire, as a player would). Uses a range nearby, else a fire nearby; with neither it
 * chops one log (dropping a fish if the inventory is full), lights one fire and cooks
 * on that. The axe and tinderbox are tools, provisioned like any other bot tool.
 *
 * JSON: { "type": "cook" }
 */
function createCookAction(spec, world) {
  const rangeIds = resolveCatalogObjectIds({ catalog: "range", option: "cook" });
  const logIds = (Firemaking.LIGHTABLE_LOGS ?? []).map((log) => log.itemId);
  const canReach = createObjectReachChecker(world.core);
  const chopLog = createInteractObjectAction({
    catalog: "tree", tier: "normal", option: "Chop down", until: { hasAnyItem: logIds }, stallSeconds: 120,
  }, world);
  const equipAxe = createEquipToolAction({ tool: "axe" });
  const stateFor = (player) => playerState(action, player, () => ({
    lastUseAt: 0, failedUses: 0, lastTargetKey: null, avoid: new Map(), chopping: false, moved: false, position: null,
  }));

  /**
   * The first raw item in the inventory the bot may cook: the Cooking level, and the quest and
   * Hunters' Rumours gates the cooking plugin applies.
   */
  function rawToCook(player) {
    for (const [slot, item] of player.getInventory().getItems().entries()) {
      const cookable = item ? Cooking.COOKABLE_BY_RAW?.get(item.getId()) : null;
      if (cookable && !cookable.rangeOnly && Cooking.canCookFood(player, cookable)) return { item, slot };
    }
    return null;
  }

  function nearestCookingObject(player, nowMs) {
    const loc = player.getLocation();
    const usable = (object) => object && object.getLocation().getZ() === loc.getZ() &&
      (stateFor(player).avoid.get(tileKey(object)) ?? 0) <= nowMs;
    let best = null;
    let bestDistance = Infinity;
    const consider = (object, maxTiles) => {
      if (!usable(object)) return;
      const distance = chebyshev(object.getLocation(), loc);
      if (distance <= maxTiles && distance < bestDistance) {
        best = object;
        bestDistance = distance;
      }
    };
    for (const object of world.objectSearch?.findCandidatesByIds?.(player, rangeIds, {
      regionRadius: 1, z: loc.getZ(), privateArea: player.getPrivateArea?.() ?? null,
    }) ?? []) consider(object, RANGE_SEARCH_TILES);
    for (const object of world.core.World.getObjects()) {
      if (Cooking.FIRE_OBJECT_NAMES?.has(object.getDefinition?.()?.getName?.())) consider(object, FIRE_SEARCH_TILES);
    }
    return best;
  }

  function useOn(player, object, raw, nowMs) {
    const bot = stateFor(player);
    const key = tileKey(object);
    bot.failedUses = bot.lastTargetKey === key ? bot.failedUses + 1 : 0;
    bot.lastTargetKey = key;
    if (bot.failedUses >= FAILED_USES) {
      bot.avoid.set(key, nowMs + AVOID_MS);
      bot.failedUses = 0;
      return;
    }
    bot.lastUseAt = nowMs;
    const at = object.getLocation();
    player.getMovementQueue().walkToObject(object, {
      execute: () => {
        world.emitItemOnObject?.({
          player, object, objectId: object.getId(), item: raw.item, itemId: raw.item.getId(), itemSlot: raw.slot,
          interfaceType: 0, location: { x: at.getX(), y: at.getY(), z: at.getZ() }, handled: false,
        });
        // More than one raw item opens the cook menu; a bot cooks them all.
        const menu = player.getCreationMenu?.();
        if (menu) {
          player.getPacketSender().closeCreationMenu();
          menu.execute(menu.getItems()[0], COOK_ALL);
        }
      },
    });
  }

  /** No range or fire about: light one, getting a log first. */
  function makeFire(ctx, raw) {
    const { player } = ctx;
    const bot = stateFor(player);
    const inventory = player.getInventory();
    const log = logIds.find((id) => inventory.getAmount(id) > 0 && Firemaking.canPlayerBurnLog?.(player, id));
    if (log !== undefined) {
      if (bot.chopping) {
        chopLog.stop?.(ctx);
        bot.chopping = false;
      }
      if (inventory.getAmount(TINDERBOX) <= 0) inventory.adds(TINDERBOX, 1);
      // The fire takes the tile the bot stands on and steps it aside; the next update finds it.
      return Firemaking.startBotInventoryFiremaking?.(player, log) === false ? "failed" : "running";
    }
    if (inventory.isFull()) {
      // Room for the log: one raw fish goes, as a player would drop one.
      inventory.deleteNumber(raw.item.getId(), 1);
    }
    if (equipAxe.update(ctx) !== "success") return "failed";
    bot.chopping = true;
    const result = chopLog.update(ctx);
    return result === "failed" ? "failed" : "running";
  }

  const action = {
    id: "cook",
    update(ctx) {
      const { player, nowMs } = ctx;
      const bot = stateFor(player);
      const loc = player.getLocation();
      const position = `${loc.getX()},${loc.getY()},${loc.getZ()}`;
      if (position !== bot.position) {
        bot.position = position;
        bot.moved = true;
      }
      if (Cooking.isCookingActive?.(player) || Firemaking.isFiremakingActive?.(player)) {
        bot.failedUses = 0;
        return "running";
      }
      const raw = rawToCook(player);
      if (!raw) return "success";
      if (player.getMovementQueue().size() > 0) return "running";
      const target = nearestCookingObject(player, nowMs);
      if (!target) {
        if (peekMovementRequest(player) && !bot.chopping) return "running";
        return makeFire(ctx, raw);
      }
      if (bot.chopping) {
        chopLog.stop?.(ctx);
        bot.chopping = false;
        clearMovementRequest(player);
      }
      if (chebyshev(target.getLocation(), loc) > DIRECT_ROUTE_TILES) {
        approachObject(player, target, { nowMs, reason: "brain_cook_approach" });
        return "running";
      }
      if (peekMovementRequest(player) || nowMs - bot.lastUseAt < INTERACT_COOLDOWN_MS) return "running";
      if (approachBlockedObject(player, target, { nowMs, reason: "brain_cook_approach", canReach })) {
        return "running";
      }
      useOn(player, target, raw, nowMs);
      return "running";
    },
    stop(ctx) {
      const bot = stateFor(ctx.player);
      if (bot.chopping) chopLog.stop?.(ctx);
      bot.chopping = false;
      bot.lastTargetKey = null;
      bot.failedUses = 0;
      bot.position = null;
    },
    madeProgress(ctx) {
      const bot = stateFor(ctx.player);
      const moved = bot.moved || (bot.chopping && chopLog.madeProgress?.(ctx) === true);
      bot.moved = false;
      return moved;
    },
    describe(ctx) {
      const bot = stateFor(ctx.player);
      return bot.chopping ? `cook (chopping a log) ${chopLog.describe?.(ctx) ?? ""}` : "cook";
    },
  };
  return action;
}

module.exports = {
  createCookAction,
};
