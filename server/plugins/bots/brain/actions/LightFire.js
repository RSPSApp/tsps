"use strict";

const { Location } = require("../../../../src/main/typescript/elvarg/game/model/Location");
const { ObjectManager } = require("../../../../src/main/typescript/elvarg/game/entity/impl/object/ObjectManager");
const { RegionManager } = require("../../../../src/main/typescript/elvarg/game/collision/RegionManager");
const Firemaking = require("../../../skills/Firemaking.plugin");
const { requestMovement } = require("../../behaviours/navigation/BotNavigation");

const TILE_SEARCH_ATTEMPTS = 20;
const TILE_SEARCH_RADIUS = 3;

/**
 * Burns the inventory's logs one at a time on clear tiles near the bank, then
 * completes. Wraps the firemaking plugin's bot entry point; produces events
 * already reset the frame stall clock.
 */
function createLightFireAction(spec, world) {
  function findBurnableLog(player) {
    for (const item of player.getInventory?.()?.getItems?.() ?? []) {
      const id = item?.getId?.();
      if (id > 0 && Firemaking.isWoodcuttingLog?.(id) && Firemaking.canPlayerBurnLog?.(player, id)) {
        return id;
      }
    }
    return null;
  }

  function moveToClearTile(player) {
    const loc = player.getLocation();
    for (let attempt = 0; attempt < TILE_SEARCH_ATTEMPTS; attempt++) {
      const dx = Math.floor(Math.random() * (TILE_SEARCH_RADIUS * 2 + 1)) - TILE_SEARCH_RADIUS;
      const dy = Math.floor(Math.random() * (TILE_SEARCH_RADIUS * 2 + 1)) - TILE_SEARCH_RADIUS;
      if (dx === 0 && dy === 0) {
        continue;
      }
      const candidate = new Location(loc.getX() + dx, loc.getY() + dy, loc.getZ());
      if (
        !RegionManager.blocked(candidate, player.getPrivateArea?.() ?? null) &&
        !ObjectManager.existsLocation(candidate) &&
        !Firemaking.isFireTileBlocked?.(candidate, player.getPrivateArea?.() ?? null)
      ) {
        requestMovement(player, candidate.getX(), candidate.getY(), {
          reason: "brain_light_tile",
          basicPather: true,
          z: candidate.getZ(),
        });
        return true;
      }
    }
    return false;
  }

  return {
    id: "lightFire",
    update(ctx) {
      const { player } = ctx;
      if (Firemaking.isFiremakingActive?.(player)) {
        return "running";
      }
      const logId = findBurnableLog(player);
      if (logId == null) {
        return "success";
      }
      if (player.getForceMovement?.() != null) {
        return "running";
      }
      if (player.getMovementQueue?.()?.size?.() > 0) {
        return "running";
      }
      const loc = player.getLocation();
      if (ObjectManager.existsLocation(loc)) {
        return moveToClearTile(player) ? "running" : "failed";
      }
      Firemaking.startBotInventoryFiremaking?.(player, logId);
      return "running";
    },
  };
}

module.exports = {
  createLightFireAction,
};
