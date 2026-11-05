"use strict";

// Atop Varrock church, "Archibald tips slowly off the wall" (Wiki transcript). The
// archived easter26_egg_church_cutscene plays the cache's archibald_egg_fall01 for the
// searching player only. The Wiki's camera cutscene is not reproduced: no recording
// gives its camera, timing or the haystack shot, so this is the fall animation alone.
const Scene = require("./Scene.EasterEvents");
const WALL = Object.freeze({ x: 3256, y: 3483, z: 3 });
const FALL_TICKS = 3;
const falls = new Map();

function remove(api, player) {
  const record = falls.get(player);
  if (!record) return;
  falls.delete(player);
  record.task?.stop();
  api.removeNpc(record.npc);
}
function fall(api, { player }) {
  remove(api, player);
  const c = api.core, id = Scene.npcId(api, "easter26_egg_church_cutscene");
  if (!Scene.active() || id === null) return;
  const npc = api.spawnNpc({ id, x: WALL.x, y: WALL.y, z: WALL.z, wanderRadius: 0, owner: player, ownerOnly: true });
  if (!npc) return;
  npc.performAnimation(new c.Animation(c.CacheDefinitions.getSeqId("archibald_egg_fall01")));
  const record = { npc, ticks: 0 };
  class ArchibaldFall extends c.Task {
    constructor() { super(1, record); }
    execute() { if (++record.ticks >= FALL_TICKS) remove(api, player); }
  }
  record.task = new ArchibaldFall();
  falls.set(player, record);
  c.TaskManager.submit(record.task);
}
function clear(api, { player }) { remove(api, player); }
function clearAll(api) { for (const player of [...falls.keys()]) remove(api, player); }

module.exports = { WALL, fall, clear, clearAll };
