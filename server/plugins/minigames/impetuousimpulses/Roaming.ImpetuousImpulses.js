"use strict";

/**
 * Puro-Puro's roaming implings (Wiki, Implings and Puro-Puro): each spawn point holds an
 * invisible impling that roams for two minutes before it shows, and is replaced the moment it
 * is caught, rolling its tier's table again. The tier tables are the Wiki's (low and mid match the
 * overworld; the high table is out of 301). The points use the Puro-Puro precursor coordinates
 * in Wiki Implings revision 15360701's embedded map: 10 low, 12 mid and 2 high. Its
 * prose claims 21 low, conflicting with that map; no extra low coordinates are invented.
 * Catching is the Hunter plugin's, which emits hunter:impling-caught and leaves removal to us.
 * The fixed spawns come from npc-spawns.json and the imp defenders are not implemented.
 */
const data = require("./data/roaming-spawns.json");

const MANIFEST_TICKS = 200;
const CAUGHT_TICKS = 2;
// Estimate: the Wiki does not give the wander range.
const WANDER_RADIUS = 8;
const IGNORE_CLIPPING_FLAG = "movement:ignore-clipping";
// Existing Hunter Puro-Puro rectangle. This caps the estimate to keep ordinary wandering in realm.
const MAZE_BOUNDS = Object.freeze([2560, 2623, 4288, 4351]);
function wanderRadius([x, y]) {
  return Math.max(0, Math.min(WANDER_RADIUS, x - MAZE_BOUNDS[0], MAZE_BOUNDS[1] - x,
    y - MAZE_BOUNDS[2], MAZE_BOUNDS[3] - y));
}
const PLANE = 0;

let core;
let api;
let task;
let tick = 0;
/** npc -> { tier, point, visibleAt, removeAt } */
const live = new Map();

function init(pluginApi) {
  api = pluginApi;
  core = api.core;
}

function weighted(table) {
  let draw = 1 + Math.floor(Math.random() * Object.values(table).reduce((sum, weight) => sum + weight, 0));
  for (const [key, weight] of Object.entries(table)) if ((draw -= weight) <= 0) return key;
}

function spawn(tier, point) {
  const key = weighted(data.tables[tier]);
  const npc = api.spawnNpc({ id: core.NpcIdentifiers[`${key}_IMPLING_2`], x: point[0], y: point[1], z: PLANE, wanderRadius: wanderRadius(point) });
  if (!npc) return;
  // Implings cross scenery, including water and magical wheat (Wiki Impling, revision 15360701).
  npc.setFlag(IGNORE_CLIPPING_FLAG, true);
  npc.setVisible(false);
  live.set(npc, { tier, point, visibleAt: tick + MANIFEST_TICKS, removeAt: 0 });
}

function start() {
  for (const tier of ["low", "mid", "high"]) for (const point of data[tier]) spawn(tier, point);
  class RoamingTask extends core.Task {
    execute() { process(); }
  }
  task = new RoamingTask(1);
  core.TaskManager.submit(task);
}

function process() {
  tick++;
  for (const [npc, state] of [...live]) {
    if (state.visibleAt && tick >= state.visibleAt) { state.visibleAt = 0; npc.setVisible(true); }
    if (state.removeAt && tick >= state.removeAt) {
      api.removeNpc(npc);
      live.delete(npc);
      spawn(state.tier, state.point);
    }
  }
}

function caught(event) {
  const state = live.get(event.npc);
  if (!state) return;
  event.handled = true;
  state.removeAt = tick + CAUGHT_TICKS;
  event.npc.untargetable = true;
}

function shutdown() {
  task?.stop();
  for (const npc of live.keys()) api.removeNpc(npc);
  live.clear();
}

function register(pluginApi) {
  init(pluginApi);
  pluginApi.onServerStartup(start);
  pluginApi.onServerShutdown(shutdown);
  pluginApi.onCustomEvent("hunter:impling-caught", caught);
}

module.exports = register;
Object.assign(module.exports, { init, start, process, caught, shutdown, live, MANIFEST_TICKS, CAUGHT_TICKS, MAZE_BOUNDS, wanderRadius });
