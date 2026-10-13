/**
 * One Vorkath crater per player, following the Elvarg private-area pattern: whoever walks
 * into the crater (teleport + ice-chunks climb, boat walk-ins, admin teleports) gets a
 * personal area with a personal sleeping Vorkath. Leaving the crater, logging out or
 * disconnecting destroys it; NPCs, pool objects and drops go with it.
 */
const Shared = require("./Shared.Vorkath");
const CombatAchievements = require("./CombatAchievements.Vorkath");
const Hud = require("./Hud.Vorkath");

/** Crater interior: the wall line y=4053 stays outside so climbers arrive cleanly. */
const CRATER = { minX: 2258, maxX: 2286, minY: 4054, maxY: 4078 };

const ATTR_AREA = "vorkath:instance-area";

let api = null;
let core = null;
let VorkathPrivateArea = null;

function craterBoundary() {
  return new core.Boundary(CRATER.minX, CRATER.maxX, CRATER.minY, CRATER.maxY, 0);
}

function insideCrater(location) {
  if (!location || location.getZ?.() !== 0) return false;
  const x = location.getX();
  const y = location.getY();
  return x >= CRATER.minX && x <= CRATER.maxX && y >= CRATER.minY && y <= CRATER.maxY;
}

function defineAreaClass() {
  class VorkathArea extends core.PrivateArea {
    constructor(ownerName) {
      super([craterBoundary()]);
      this.ownerName = ownerName ?? "unknown";
    }

    destroy() {
      if (this.isDestroyed?.() === true) {
        return;
      }
      const addQueue = core.World.getAddNPCQueue();
      const removeQueue = core.World.getRemoveNPCQueue();
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

    /** Per tick, players in the crater only: what the Combat Achievements watch. */
    process(mobile) {
      if (mobile?.isPlayer?.()) CombatAchievements.tick(mobile.getAsPlayer());
    }

    postLeave(mobile, logout) {
      if (mobile?.isPlayer?.()) {
        CombatAchievements.left(mobile.getAsPlayer());
        clearArea(mobile.getAsPlayer(), this);
      }
      super.postLeave(mobile, logout);
    }

    /** Multi-way: fighters must switch to the zombified spawn while under attack. */
    isMulti() {
      return true;
    }
  }
  VorkathPrivateArea = VorkathArea;
}

function areaOf(player) {
  const area = player.getAttribute?.(ATTR_AREA);
  return area instanceof VorkathPrivateArea && area.isDestroyed?.() !== true ? area : null;
}

function clearArea(player, sourceArea) {
  if (!player) return;
  const assigned = player.getAttribute?.(ATTR_AREA);
  if (sourceArea == null || assigned === sourceArea || assigned?.isDestroyed?.() === true) {
    player.setAttribute?.(ATTR_AREA, null);
  }
}

function destroyArea(player) {
  Hud.dropFor(player);
  const area = player.getAttribute?.(ATTR_AREA);
  clearArea(player, area);
  if (area instanceof VorkathPrivateArea && area.isDestroyed?.() !== true) {
    area.destroy();
  }
}

function moveIntoArea(player, area) {
  const currentArea = player.getArea?.();
  if (currentArea && currentArea !== area) {
    currentArea.leave(player, false);
    currentArea.postLeave(player, false);
  }
  if (player.getArea?.() !== area) {
    area.enter(player);
  }
}

function ensureSleeper(area) {
  if (!area || area.isDestroyed?.() === true) return;
  const awake = (area.entities ?? []).some((entity) => {
    if (!entity?.isNpc?.() || !entity?.getAsNpc) return false;
    const id = entity.getAsNpc().getId?.();
    return id === Shared.SLEEPING_ID || id === Shared.WAKING_ID || id === Shared.AWAKE_ID;
  });
  if (awake) return;
  const location = new core.Location(Shared.SPAWN_TILE[0], Shared.SPAWN_TILE[1], Shared.SPAWN_TILE[2]);
  const sleeper = core.NPC.create(Shared.SLEEPING_ID, location);
  // The crater brings her back (here, as soon as she is gone, as captured); her own respawn
  // timer would add a second one.
  sleeper.__skipDefaultRespawn = true;
  sleeper.getMovementCoordinator?.().setRadius?.(0);
  area.add(sleeper);
  core.World.getAddNPCQueue().push(sleeper);
}

function enterCrater({ player }) {
  if (!player) return;
  if (!insideCrater(player.getLocation?.())) {
    destroyArea(player);
    return;
  }
  let area = areaOf(player);
  if (!area) {
    area = new VorkathPrivateArea(player.getUsername?.());
    player.setAttribute?.(ATTR_AREA, area);
  }
  moveIntoArea(player, area);
  ensureSleeper(area);
}

function leaveWorld({ player }) {
  if (!player) return;
  destroyArea(player);
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  defineAreaClass();
  pluginApi.onPlayerProcess(enterCrater);
  pluginApi.onPlayerLogout(leaveWorld);
  pluginApi.onPlayerDisconnect(leaveWorld);
}

module.exports = {
  attach,
  insideCrater,
  areaOf,
  ensureSleeper,
  destroyArea,
  _test: { insideCrater },
};
