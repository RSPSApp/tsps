"use strict";

// The Spook-a-thon judging (transcript action 5shIok .. LRWlwH). The source gives
// the cast and lines, not positions or camera paths: the owner-only actors stand
// in Fred's front yard (event scenery placements) and the camera frames the house.
// These presentation positions are provisional; see halloween-2025-source.md.
const { cutscene } = require("./data/halloween-2025-scene.json");
const { BUNDLE } = require("./Progress.HalloweenEvents");
const SPEAKERS = Object.freeze({ "Fred the Farmer": "fred", "Seth Groats": "seth", Death: "death" });
const records = new Map();
// The judging is one conversation: once it has been gone this long, the scene ends
// too (an unavailable overhead actor or another interface can close it early).
const CHAT_GONE_TICKS = 3;

function remove(api, record) {
  for (const npc of record.npcs.values()) if (npc.isRegistered()) api.removeNpc(npc);
  record.npcs.clear();
}

function finish(api, { player }) {
  const record = records.get(player);
  if (!record) return;
  records.delete(player);
  api.core.TaskManager.cancelTasks(record);
  remove(api, record);
  if (record.session) delete record.session.cutscene;
  if (player.isRegistered()) {
    player.getPacketSender().sendCameraReset();
    player.getMovementQueue().reset().setBlockMovement(record.blocked);
  }
}

function start(api, request) {
  const { player, session } = request, c = api.core;
  finish(api, { player });
  const record = { npcs: new Map(), session, blocked: player.getMovementQueue().isMovementBlocked?.() ?? false };
  try {
    for (const row of cutscene.actors) {
      const id = c.CacheDefinitions.getArchivedId(BUNDLE, "npc", row.symbol);
      if (id === null) throw new Error("Missing Halloween cutscene actor " + row.symbol);
      const npc = api.spawnNpc({ id, x: row.x, y: row.y, z: 0, wanderRadius: 0, owner: player, ownerOnly: true,
        face: c.Direction[row.face].getId() });
      if (!npc) throw new Error("Could not create Halloween cutscene actor " + row.symbol);
      npc.__skipDefaultRespawn = true;
      npc.setScriptedMovement(true);
      record.npcs.set(row.role, npc);
    }
  } catch (error) {
    remove(api, record);
    api.log("Halloween cutscene: " + error.message);
    return;
  }
  records.set(player, record);
  session.cutscene = { actorsFor: step => actorsFor(record, step) };
  // The scene is framed from the front yard, wherever the player spoke to Fred.
  player.moveTo(new c.Location(cutscene.player.x, cutscene.player.y, cutscene.player.z));
  player.getMovementQueue().reset().setBlockMovement(true);
  watch(api, player, record);
  const { camera } = cutscene, sender = player.getPacketSender();
  sender.sendCameraMoveTo(camera.x, camera.y, camera.height, false);
  sender.sendCameraLookAt(camera.lookX, camera.lookY, camera.lookHeight, false);
  request.handled = true;
}

function watch(api, player, record) {
  const { Task, TaskManager } = api.core;
  let gone = 0;
  TaskManager.submit(new (class HalloweenCutsceneWatch extends Task {
    constructor() { super(1, record, false); }
    execute() {
      if (records.get(player) !== record) return this.stop();
      gone = player.getDialogueManager().getCurrent() ? 0 : gone + 1;
      if (gone >= CHAT_GONE_TICKS || !player.isRegistered()) finish(api, { player });
    }
  })());
}

function actorsFor(record, step) {
  if (step?.presentation !== "overhead" || typeof step.player === "string") return undefined;
  const npc = record.npcs.get(SPEAKERS[step.speaker]);
  return npc?.isRegistered() ? [npc] : undefined;
}

function active(player) { return records.has(player); }
function cancelAll(api) { for (const player of [...records.keys()]) finish(api, { player }); }

module.exports = { start, finish, active, cancelAll };
