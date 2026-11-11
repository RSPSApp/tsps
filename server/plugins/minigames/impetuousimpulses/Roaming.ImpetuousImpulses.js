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
// Existing server estimate: Wiki generic range100 is not established here for Puro-Puro.
const WANDER_RADIUS = 8;
const IGNORE_CLIPPING_FLAG = "movement:ignore-clipping";
// Existing Hunter Puro-Puro rectangle identifies realm membership.
const MAZE_BOUNDS = Object.freeze([2560, 2623, 4288, 4351]);
// Cache242 enclosing walls occupy x2561/2622 and y4289/4350. Keep ordinary targets inside them.
const WANDER_BOUNDS = Object.freeze([2562, 2621, 4290, 4349]);
function wanderRadius([x, y]) {
  return Math.max(0, Math.min(WANDER_RADIUS, x - WANDER_BOUNDS[0], WANDER_BOUNDS[1] - x,
    y - WANDER_BOUNDS[2], WANDER_BOUNDS[3] - y));
}
const PLANE = 0;

let core;
let api;
let task;
let implingIds;
let tick = 0;
/** npc -> { tier, point, visibleAt, removeAt } */
const live = new Map();

function init(pluginApi) {
  api = pluginApi;
  core = api.core;
  implingIds = new Set(Object.values(data.tables).flatMap(table =>
    Object.keys(table).map(key => core.NpcIdentifiers[`${key}_IMPLING_2`])));
}

/** Every Puro-Puro impling flies, including the fixed population loaded from world definitions. */
function configureFlight({ npc }) {
  if (!implingIds.has(npc.getId())) return;
  const at = npc.getSpawnPosition(), x = at.getX(), y = at.getY();
  if (at.getZ() !== PLANE || x < MAZE_BOUNDS[0] || x > MAZE_BOUNDS[1]
    || y < MAZE_BOUNDS[2] || y > MAZE_BOUNDS[3]) return;
  // The Wiki's scenery-crossing rule applies to implings; ordinary actors keep collision.
  npc.setFlag(IGNORE_CLIPPING_FLAG, true);
  const movement = npc.getMovementCoordinator();
  movement.setRadius(Math.min(movement.getRadius(), wanderRadius([x, y])));
}

function weighted(table) {
  let draw = 1 + Math.floor(Math.random() * Object.values(table).reduce((sum, weight) => sum + weight, 0));
  for (const [key, weight] of Object.entries(table)) if ((draw -= weight) <= 0) return key;
}

function spawn(tier, point) {
  const key = weighted(data.tables[tier]);
  const npc = api.spawnNpc({ id: core.NpcIdentifiers[`${key}_IMPLING_2`], x: point[0], y: point[1], z: PLANE, wanderRadius: wanderRadius(point) });
  if (!npc) return;
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
  pluginApi.onCustomEvent("npc:added", configureFlight);
  pluginApi.onServerStartup(start);
  pluginApi.onServerShutdown(shutdown);
  pluginApi.onCustomEvent("hunter:impling-caught", caught);
}

module.exports = register;
Object.assign(module.exports, { init, start, process, caught, shutdown, live, MANIFEST_TICKS, CAUGHT_TICKS, MAZE_BOUNDS, WANDER_BOUNDS, wanderRadius, configureFlight });
