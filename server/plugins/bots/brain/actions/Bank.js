"use strict";

const { MapObjects } = require("../../../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
const { Bank } = require("../../../../src/main/typescript/elvarg/game/model/container/impl/Bank");
const { BANK_BOOTH_IDS, isUsableBankBooth } = require("../../lib/BankBooths");
const { playerState } = require("../ActionState");
const { approachObject } = require("../../behaviours/navigation/BotNavigation");

const BANK_SEARCH_REGION_RADIUS = 2;
const MAX_DIRECT_ROUTE_TILES = 20;
const INTERACT_COOLDOWN_MS = 1500;
const DEPOSIT_DELAY_MS = 600;
// Same unreachable-target guard as InteractObject: a booth whose route keeps
// failing is avoided for a while so another booth gets picked.
const UNREACHABLE_CLICKS = 2;
const UNREACHABLE_AVOID_MS = 60000;

/**
 * Deposits the inventory at the nearest usable bank booth, then reports success.
 * Segmented approach and the interact cooldown mirror the woodcutting action:
 * re-issuing walkToObject every tick cancels the arrival callback.
 */
function createBankAction(spec, world) {
  const withdrawSpecs = Array.isArray(spec.withdraw) ? spec.withdraw : [];
  const isWithdraw = withdrawSpecs.length > 0;
  const requireFull = !isWithdraw && spec.until?.inventoryFull !== false;
  const stateFor = (player) =>
    playerState(action, player, () => ({
      booth: null,
      lastClickAt: 0,
      depositAt: 0,
      suppressedAutoRetaliate: null,
      lastTargetKey: null,
      lastClickX: null,
      lastClickY: null,
      failedClicks: 0,
      avoid: new Map(),
    }));

  function withdrawSatisfied(player) {
    const inventory = player.getInventory();
    return withdrawSpecs.every(
      (entry) => inventory.getAmount(entry.item) >= entry.amount
    );
  }

  function performWithdraw(player) {
    const inventory = player.getInventory();
    for (const entry of withdrawSpecs) {
      let remaining = entry.amount - inventory.getAmount(entry.item);
      let guard = 0;
      while (remaining > 0 && guard++ < 40) {
        let withdrew = false;
        for (let tab = 0; tab < Bank.TOTAL_BANK_TABS - 1; tab++) {
          const bank = player.getBank(tab);
          if (!bank) {
            continue;
          }
          const slot = bank.getSlotForItemId?.(entry.item) ?? -1;
          if (slot < 0) {
            continue;
          }
          const stack = bank.getItems()[slot];
          if (!stack || stack.getId() !== entry.item) {
            continue;
          }
          const take = Math.min(remaining, stack.getAmount());
          Bank.withdraw(player, entry.item, slot, take, tab);
          remaining -= take;
          withdrew = true;
          if (remaining <= 0) {
            break;
          }
        }
        if (!withdrew) {
          break;
        }
      }
    }
  }

  function findBooth(player, nowMs) {
    const bot = stateFor(player);
    const loc = player.getLocation();
    const candidates =
      world.objectSearch?.findCandidatesByIds?.(player, [...BANK_BOOTH_IDS], {
        regionRadius: BANK_SEARCH_REGION_RADIUS,
        z: loc.getZ(),
        privateArea: player.getPrivateArea?.() ?? null,
      }) ?? [];
    let best = null;
    let bestDistSq = Number.MAX_SAFE_INTEGER;
    let fallback = null;
    let fallbackDistSq = Number.MAX_SAFE_INTEGER;
    for (const object of candidates) {
      if (!object || !isUsableBankBooth(object.getId())) {
        continue;
      }
      const objectLoc = object.getLocation();
      if (!objectLoc || objectLoc.getZ() !== loc.getZ()) {
        continue;
      }
      const dx = objectLoc.getX() - loc.getX();
      const dy = objectLoc.getY() - loc.getY();
      const distSq = dx * dx + dy * dy;
      if (distSq < fallbackDistSq) {
        fallbackDistSq = distSq;
        fallback = object;
      }
      const key = `${object.getId()}:${objectLoc.getX()}:${objectLoc.getY()}`;
      const avoidedUntil = bot.avoid.get(key);
      if (avoidedUntil !== undefined && avoidedUntil > nowMs) {
        continue;
      }
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = object;
      }
    }
    // If every booth is avoided, ignore the list: better a retry than a stall.
    return best ?? fallback;
  }

  function resolveBooth(player) {
    const booth = stateFor(player).booth;
    if (!booth) {
      return null;
    }
    const loc = player.getLocation().clone();
    loc.set(booth.x, booth.y, booth.z);
    return MapObjects.get(booth.objectId, loc, player.getPrivateArea());
  }

  const action = {
    id: "bank",
    update(ctx) {
      const { player, nowMs } = ctx;
      const bot = stateFor(player);
      if (
        spec.suppressAutoRetaliate === true &&
        bot.suppressedAutoRetaliate === null
      ) {
        bot.suppressedAutoRetaliate =
          typeof player.autoRetaliateReturn === "function"
            ? player.autoRetaliateReturn()
            : true;
        player.setAutoRetaliate?.(false);
      }
      if (bot.depositAt > 0 && nowMs >= bot.depositAt) {
        if (isWithdraw) {
          performWithdraw(player);
          world.log?.("bot_brain_bank_withdrew", {
            username: player.getUsername?.(),
          });
        } else {
          Bank.depositItems(player, player.getInventory(), true);
          world.log?.("bot_brain_bank_deposited", {
            username: player.getUsername?.(),
          });
        }
        bot.depositAt = 0;
        return "success";
      }
      if (isWithdraw && withdrawSatisfied(player)) {
        return "success";
      }
      if (requireFull && !player.getInventory().isFull()) {
        return "success";
      }

      const object = resolveBooth(player) ?? findBooth(player, nowMs);
      if (!object) {
        return "failed";
      }
      bot.booth = {
        objectId: object.getId(),
        x: object.getLocation().getX(),
        y: object.getLocation().getY(),
        z: object.getLocation().getZ(),
      };

      const loc = player.getLocation();
      const distance = Math.max(
        Math.abs(loc.getX() - bot.booth.x),
        Math.abs(loc.getY() - bot.booth.y)
      );
      if (distance > MAX_DIRECT_ROUTE_TILES) {
        approachObject(player, object, { nowMs, reason: "brain_bank_approach" });
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

      const objectLoc = object.getLocation();
      const key = `${object.getId()}:${objectLoc.getX()}:${objectLoc.getY()}`;
      const now = player.getLocation();
      const stayedPut =
        bot.lastClickX === now.getX() && bot.lastClickY === now.getY();
      bot.failedClicks =
        bot.lastTargetKey === key && stayedPut ? bot.failedClicks + 1 : 0;
      if (bot.failedClicks >= UNREACHABLE_CLICKS) {
        bot.avoid.set(key, nowMs + UNREACHABLE_AVOID_MS);
        bot.booth = null;
        bot.lastTargetKey = null;
        bot.failedClicks = 0;
        return "running";
      }
      bot.lastTargetKey = key;
      bot.lastClickX = now.getX();
      bot.lastClickY = now.getY();
      bot.lastClickAt = nowMs;
      player.getMovementQueue().walkToObject(object, {
        execute: () => {
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
          stateFor(player).depositAt = Date.now() + DEPOSIT_DELAY_MS;
        },
      });
      return "running";
    },
    stop(ctx) {
      const player = ctx?.player;
      if (!player) {
        return;
      }
      const bot = stateFor(player);
      bot.booth = null;
      bot.lastClickAt = 0;
      bot.depositAt = 0;
      if (bot.suppressedAutoRetaliate !== null) {
        player.setAutoRetaliate?.(bot.suppressedAutoRetaliate);
        bot.suppressedAutoRetaliate = null;
      }
    },
  };
  return action;
}

module.exports = {
  createBankAction,
};
