const { Boundary } = require("../../src/main/typescript/elvarg/game/model/Boundary");
const { NPC } = require("../../src/main/typescript/elvarg/game/entity/impl/npc/NPC");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { PrivateArea } = require("../../src/main/typescript/elvarg/game/model/areas/impl/PrivateArea");
const { GameConstants } = require("../../src/main/typescript/elvarg/game/GameConstants");
const { NpcIdentifiers } = require("../../src/main/typescript/elvarg/util/NpcIdentifiers");

const ATTR_PENDING_INSTANCE = "count_draynor:pending_instance";
const ATTR_INSTANCE_AREA = "count_draynor:instance_area";

// OSRS Count Draynor encounter is in Draynor Manor basement.
// Coordinates aligned to the known encounter room tile set used by OSRS data dumps.
const COUNT_DRAYNOR_TELEPORT_LOCATION = new Location(3077, 9772, 0);
const COUNT_DRAYNOR_SPAWN_LOCATION = new Location(3078, 9772, 0);
const COUNT_DRAYNOR_ROOM_BOUNDARY = new Boundary(3072, 3084, 9766, 9779, 0);
const COUNT_DRAYNOR_IDS = new Set([
  NpcIdentifiers.COUNT_DRAYNOR,
  NpcIdentifiers.COUNT_DRAYNOR_2,
  NpcIdentifiers.COUNT_DRAYNOR_3,
]);

class CountDraynorPrivateArea extends PrivateArea {
  constructor(ownerName) {
    super([COUNT_DRAYNOR_ROOM_BOUNDARY]);
    this.ownerName = ownerName ?? "unknown";
  }

  destroy() {
    if (this.isDestroyed?.() === true) {
      return;
    }

    const addQueue = World.getAddNPCQueue();
    const removeQueue = World.getRemoveNPCQueue();
    for (const entity of this.entities) {
      if (!entity?.isNpc?.() || !entity?.getAsNpc) {
        continue;
      }
      const npc = entity.getAsNpc();
      for (let index = addQueue.indexOf(npc); index !== -1; index = addQueue.indexOf(npc)) {
        addQueue.splice(index, 1);
      }
      if (npc.isRegistered?.() && !removeQueue.includes(npc)) {
        removeQueue.push(npc);
      }
    }

    super.destroy();
  }

  postLeave(mobile, logout) {
    if (mobile?.isPlayer?.()) {
      clearInstanceAttributes(mobile.getAsPlayer(), this);
    }
    super.postLeave(mobile, logout);
  }
}

function isCountDraynorNpc(npc) {
  if (!npc || typeof npc.getId !== "function") {
    return false;
  }
  return COUNT_DRAYNOR_IDS.has(npc.getId());
}

function isNearCountDraynorTeleportLocation(player) {
  const location = player?.getLocation?.();
  if (!location || location.getZ?.() !== COUNT_DRAYNOR_TELEPORT_LOCATION.getZ()) {
    return false;
  }
  return location.getDistance(COUNT_DRAYNOR_TELEPORT_LOCATION) <= 3;
}

function resolveInstanceArea(player) {
  const existingArea = player.getAttribute(ATTR_INSTANCE_AREA);
  if (
    existingArea instanceof CountDraynorPrivateArea &&
    existingArea.isDestroyed?.() !== true
  ) {
    return existingArea;
  }

  const createdArea = new CountDraynorPrivateArea(player.getUsername?.());
  player.setAttribute(ATTR_INSTANCE_AREA, createdArea);
  return createdArea;
}

function clearInstanceAttributes(player, sourceArea) {
  if (!player) {
    return;
  }
  const assignedArea = player.getAttribute(ATTR_INSTANCE_AREA);
  if (
    sourceArea == null ||
    assignedArea === sourceArea ||
    assignedArea?.isDestroyed?.() === true
  ) {
    player.setAttribute(ATTR_INSTANCE_AREA, null);
  }
  player.setAttribute(ATTR_PENDING_INSTANCE, false);
}

function movePlayerIntoArea(player, area) {
  const currentArea = player.getArea?.();
  if (currentArea && currentArea !== area) {
    currentArea.leave(player, false);
    currentArea.postLeave(player, false);
  }
  if (player.getArea?.() !== area) {
    area.enter(player);
  }
}

function ensureCountDraynorSpawn(area) {
  if (!area || area.isDestroyed?.() === true) {
    return;
  }

  const hasCountDraynor = (area.entities ?? []).some((entity) => {
    if (!entity?.isNpc?.() || !entity?.getAsNpc) {
      return false;
    }
    return isCountDraynorNpc(entity.getAsNpc());
  });
  if (hasCountDraynor) {
    return;
  }

  const npc = NPC.create(
    NpcIdentifiers.COUNT_DRAYNOR,
    COUNT_DRAYNOR_SPAWN_LOCATION.clone()
  );
  npc.getMovementCoordinator?.().setRadius?.(4);
  area.add(npc);
  World.getAddNPCQueue().push(npc);
}

function getCountDraynorInArea(area) {
  if (!area || area.isDestroyed?.() === true) {
    return null;
  }
  for (const entity of area.entities ?? []) {
    if (!entity?.isNpc?.() || !entity?.getAsNpc) {
      continue;
    }
    const npc = entity.getAsNpc();
    if (isCountDraynorNpc(npc) && npc.getHitpoints?.() > 0) {
      return npc;
    }
  }
  return null;
}

function forceCountDraynorAggression(area, player) {
  if (!player || !area || area.isDestroyed?.() === true) {
    return;
  }
  const npc = getCountDraynorInArea(area);
  if (!npc) {
    return;
  }
  if (npc.getCombat?.().getTarget?.() === player) {
    return;
  }
  npc.getCombat?.().attack?.(player);
}

function exitInstanceToHome(player, area) {
  if (!player) {
    return;
  }

  clearInstanceAttributes(player, area);
  player.getCombat?.().reset?.();

  if (area && player.getArea?.() === area) {
    area.leave(player, false);
    area.postLeave(player, false);
  }

  player.moveTo(GameConstants.DEFAULT_LOCATION.clone());
}

let World;
let pluginApi;

function climbManorStairs(request) {
  if (request.handled) return;
  const { STAIRS_11, STAIRS_12 } = pluginApi.core.ObjectIdentifiers;
  if (request.objectId !== STAIRS_11 && request.objectId !== STAIRS_12) return;
  const entering = request.objectId === STAIRS_11;
  if (entering) request.player.setAttribute(ATTR_PENDING_INSTANCE, true);
  pluginApi.emitCustomEvent(entering ? "ladders:climbDown" : "ladders:climbUp", {
    player: request.player,
    destination: entering ? COUNT_DRAYNOR_TELEPORT_LOCATION : new Location(3116, 3356, 0),
  });
  request.handled = true;
}

module.exports = {
  name: "CountDraynor",
  register(api) {
    pluginApi = api;
    World = api.getWorld();
    api.onCustomEvent("ladders:climb", climbManorStairs);
    api.onPlayerProcess(({ player }) => {
      if (!player) {
        return;
      }

      const instanceArea = player.getAttribute(ATTR_INSTANCE_AREA);
      if (
        instanceArea instanceof CountDraynorPrivateArea &&
        instanceArea.isDestroyed?.() === true
      ) {
        clearInstanceAttributes(player, instanceArea);
      }

      if (
        player.getAttribute(ATTR_PENDING_INSTANCE) === true &&
        isNearCountDraynorTeleportLocation(player)
      ) {
        const area = resolveInstanceArea(player);
        movePlayerIntoArea(player, area);
        ensureCountDraynorSpawn(area);
        forceCountDraynorAggression(area, player);
        player.setAttribute(ATTR_PENDING_INSTANCE, false);
      }

      const currentArea = player.getArea?.();
      if (!(currentArea instanceof CountDraynorPrivateArea)) {
        return;
      }
      forceCountDraynorAggression(currentArea, player);
    });

    api.onNpcDeath(({ npc }) => {
      if (!isCountDraynorNpc(npc)) {
        return;
      }

      const area = npc.getArea?.();
      if (!(area instanceof CountDraynorPrivateArea)) {
        return;
      }

      npc.__skipDefaultRespawn = true;

      const players = [...(area.getPlayers?.() ?? [])];
      for (const player of players) {
        exitInstanceToHome(player, area);
      }
    });
  },
};
