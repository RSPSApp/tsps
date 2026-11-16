"use strict";

/**
 * The training room and its eight fights.
 *
 * Wiki: entering fights the knights in order; dying, logging out or teleporting away keeps the
 * knight being fought (the 12 August 2026 change also keeps it when leaving through the door);
 * once Sir Lancelot is beaten the squire refuses re-entry. A death is safe: Merlin teleports the
 * player back outside with every item.
 *
 * The room is shared, but each player's knight is an owner-only spawn, so two players can use it
 * at once without seeing or attacking each other's wave.
 */
const Common = require("./Common.KnightWaves");

/** player -> { npc } while they are in a wave. */
const sessions = new Map();

let area = null;
let AreaClass = null;

function areaClass() {
  if (AreaClass) return AreaClass;
  AreaClass = class KnightWavesRoom extends Common.core.Area {
    constructor() {
      super([new Common.core.Boundary(
        Common.ROOM.minX, Common.ROOM.maxX, Common.ROOM.minY, Common.ROOM.maxY, Common.ROOM.z)]);
    }

    getName() {
      return "Knight Waves Training Ground";
    }

    getMusicTrack() {
      return Common.MUSIC;
    }

    postEnter(mobile) {
      const player = mobile?.isPlayer?.() ? mobile.getAsPlayer() : null;
      if (player) enterRoom(player);
    }

    postLeave(mobile) {
      const player = mobile?.isPlayer?.() ? mobile.getAsPlayer() : null;
      if (player) endSession(player);
    }

    process(mobile) {
      const player = mobile?.isPlayer?.() ? mobile.getAsPlayer() : null;
      if (!player || !sessions.has(player)) return;
      const session = sessions.get(player);
      if (!Common.inRoom(player) || Common.completed(player) >= Common.COMPLETE) return;
      if (session.npc && Common.core.World.getProcessCycle() >= session.deadline) {
        removeNpc(session);
        session.paused = true;
        send(player, Common.MESSAGES.timeout);
        return;
      }
      if (!session.npc && !session.pendingSpawn && !session.paused && (player.getHitpoints?.() ?? 0) > 0) {
        spawnWave(player, session);
      }
    }
  };
  return new AreaClass();
}

function send(player, message) {
  player.sendMessage?.(message);
}

/** Put the player back beside the squire, west of the doors. */
function eject(player, message) {
  if (message) send(player, message);
  player.getMovementQueue?.().reset?.();
  player.moveTo(Common.outsideLocation());
}

function enterRoom(player) {
  if (!Common.kingsRansomComplete(player)) {
    eject(player, Common.MESSAGES.needKingsRansom);
    return;
  }
  if (Common.completed(player) >= Common.COMPLETE) {
    eject(player, Common.MESSAGES.complete);
    return;
  }
  if (sessions.has(player)) return;
  const session = { player, npc: null, paused: false, pendingSpawn: false, deadline: 0 };
  sessions.set(player, session);
  Common.core.PrayerHandler?.resetAll?.(player);
  // Mirror the saved count while the client is in the room.
  player.getPacketSender?.().sendVarbit?.(Common.KNIGHT_WAVES_STATE_VARBIT, Common.completed(player));
  spawnWave(player, session);
}

/** Remove the player's knight and forget the session; the saved wave count is untouched. */
function endSession(player) {
  const session = sessions.get(player);
  if (!session) return;
  sessions.delete(player);
  removeNpc(session);
}

function removeNpc(session) {
  const npc = session.npc;
  session.npc = null;
  if (!npc || npc.isRegistered?.() === false || (npc.getHitpoints?.() ?? 0) <= 0) return;
  area?.leave?.(npc, false);
  Common.api.removeNpc(npc);
}

/** A free tile near the room's centre, if the first choice is blocked. */
function spawnTile() {
  const offsets = [[0, 0], [0, 1], [1, 0], [-1, 0], [0, -1]];
  for (const [dx, dy] of offsets) {
    const x = Common.SPAWN.x + dx;
    const y = Common.SPAWN.y + dy;
    if (x < Common.ROOM.minX || x > Common.ROOM.maxX || y < Common.ROOM.minY || y > Common.ROOM.maxY) continue;
    if (!Common.core.RegionManager.wallsExist?.(Common.roomLocation(x, y), null)) return { x, y };
  }
  return { x: Common.SPAWN.x, y: Common.SPAWN.y };
}

function spawnWave(player, session) {
  if (session.npc) return;
  session.pendingSpawn = false;
  const index = Common.completed(player);
  const knight = Common.knightAt(index);
  if (!knight) return;
  const tile = spawnTile();
  const npc = Common.api.spawnNpc({
    id: knight.id,
    x: tile.x,
    y: tile.y,
    z: Common.ROOM.z,
    owner: player,
    ownerOnly: true,
    wanderRadius: 0,
  });
  if (!npc) {
    send(player, "The training ground is too crowded right now.");
    endSession(player);
    return;
  }
  npc.__skipDefaultRespawn = true;
  npc.__knightWaves = { player, index };
  session.deadline = Common.core.World.getProcessCycle() + Common.TIMEOUT_TICKS;
  session.paused = false;
  area?.enter?.(npc);
  session.npc = npc;
  send(player, Common.MESSAGES.wave(index + 1, knight.name));
  npc.getCombat?.().attack?.(player);
}

function knightDied(event) {
  const tag = event.npc?.__knightWaves;
  if (!tag) return;
  const player = tag.player;
  const session = sessions.get(player);
  if (!session || session.npc !== event.npc) return;
  area?.leave?.(event.npc, false);
  session.npc = null;
  const beaten = Common.setCompleted(player, Common.completed(player) + 1);
  if (beaten >= Common.COMPLETE) {
    send(player, Common.MESSAGES.finished);
    Common.api.emitCustomEvent("knight-waves:completed", { player });
    return;
  }
  session.pendingSpawn = true;
  Common.later(2, () => {
    if (sessions.get(player) !== session || !Common.inRoom(player)) return;
    session.pendingSpawn = false;
    spawnWave(player, session);
  });
}

function playerDied(event) {
  const player = event.player;
  const session = player ? sessions.get(player) : null;
  if (!session) return;
  endSession(player);
  event.handled = true;
  eject(player);
}

function keepItems(event) {
  if (event.player && sessions.has(event.player)) event.shouldDrop = false;
}

function playerLoggedOut({ player }) {
  if (player) endSession(player);
}

function trainingDoorY(objectId, location) {
  const x = location?.getX?.() ?? location?.x;
  const y = location?.getY?.() ?? location?.y;
  const z = location?.getZ?.() ?? location?.z;
  const doors = Common.core.ObjectIdentifiers;
  return z === Common.ROOM.z && x === 2751
    && ((objectId === doors.LARGE_DOOR_73 && y === 3507) || (objectId === doors.LARGE_DOOR_74 && y === 3508))
    ? y : null;
}

function routeTrainingDoor(event) {
  const y = trainingDoorY(event.objectId, event.object?.getLocation?.());
  if (y !== null && Common.inRoom(event.player)) event.destination = { x: 2753, y, z: Common.ROOM.z };
}

function handleTrainingDoorToggle(request) {
  const { player, objectId } = request;
  const y = trainingDoorY(objectId, request.location);
  if (!player || y === null) return;
  request.handled = true;

  const inside = Common.inRoom(player);
  if (!inside && !Common.kingsRansomComplete(player)) {
    send(player, Common.MESSAGES.needKingsRansom);
    return;
  }
  if (!inside && Common.completed(player) >= Common.COMPLETE) {
    send(player, Common.MESSAGES.complete);
    return;
  }

  const start = player.getLocation();
  const from = [start.getX(), start.getY(), start.getZ()];
  Common.later(1, () => {
    if (player.isRegistered?.() === false) return;
    const here = player.getLocation();
    // Do not carry a player who moved or left the room after clicking.
    if (here.getX() !== from[0] || here.getY() !== from[1] || here.getZ() !== from[2] || Common.inRoom(player) !== inside) return;
    player.moveTo(Common.roomLocation(inside ? 2751 : 2753, y));
  });
}

function attachRoom(api) {
  area = areaClass();
  api.registerArea(area);
  api.onObjectRoute(routeTrainingDoor);
  api.onCustomEvent("door:toggle", handleTrainingDoorToggle);
  api.onNpcDeath(knightDied);
  api.onPlayerDeath(playerDied);
  api.onShouldDropItemsOnDeath(keepItems);
  api.onPlayerLogout(playerLoggedOut);
}

module.exports = {
  attachRoom,
  enterRoom,
  endSession,
  spawnWave,
  knightDied,
  playerDied,
  keepItems,
  playerLoggedOut,
  sessions,
  _areaClass: areaClass,
};
