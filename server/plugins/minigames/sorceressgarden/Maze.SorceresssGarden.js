"use strict";

/**
 * The four seasonal mazes: their elemental patrols, the catch rule and the sq'irk trees.
 *
 * The elementals are world-spawned and never leave their garden; each is driven along a
 * straight back-and-forth track. The Wiki publishes only images of the exact patrol
 * routes, so each track is derived from the local map clipping instead: from the spawn,
 * try north/east/south/west in an order rotated by the spawn tile, take the first
 * direction with a clear step, and run up to six tiles until a hedge blocks (a 2-6 tile
 * round trip).
 *
 * A player within two tiles (chebyshev) of an elemental with the hedge line clear is
 * caught: the elemental stops for a tick, then the player is put back in the central
 * garden. Picking a fruit grants exactly one sq'irk and the Wiki's Farming XP, then also
 * teleports the player to the central garden, so one fruit per trip by construction.
 */

const Gardens = require("./Gardens.SorceresssGarden");

const {
  CENTRAL_GARDEN,
  PLANE,
  SEASONS,
  SEASON_ORDER,
  meetsLevel,
  seasonForTree,
} = Gardens;

/** Tiles a patrol track may run from its spawn. */
const PATROL_MAX = 6;
/** The Wiki does not quote the catch line; this is the wording this plugin uses. */
const CAUGHT_MESSAGE = "The elemental spots you and teleports you out of the garden!";
const LEVEL_MESSAGE = (season) => `You need a Thieving level of ${season.level} to enter this garden.`;
const PICK_LEVEL_MESSAGE = (season) => `You need a Thieving level of ${season.level} to pick fruit from this garden.`;

let api;
let core;

/** player -> token; a pending catch ejection is cancelled when the player leaves. */
const sessions = new Map();

const tile = (x, y) => new core.Location(x, y, PLANE);
const centralGarden = () => tile(CENTRAL_GARDEN.x, CENTRAL_GARDEN.y);
const thievingLevel = (player) => player.getSkillManager().getCurrentLevel(core.Skill.THIEVING);
const tileBlocked = (x, y) => core.RegionManager.blocked(tile(x, y), null);

function later(ticks, action) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(ticks);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

// --- The catch rule

function withinCatchRange(ax, ay, bx, by) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by)) <= 2;
}

/** Bresenham between two tiles; true when a strictly-between tile blocks the view. */
function lineOfSightBlocked(ax, ay, bx, by, isBlocked) {
  let x = ax;
  let y = ay;
  const dx = Math.abs(bx - ax);
  const dy = Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1;
  const sy = ay < by ? 1 : -1;
  let err = dx - dy;
  while (x !== bx || y !== by) {
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
    if (x === bx && y === by) return false;
    if (isBlocked(x, y)) return true;
  }
  return false;
}

function shouldCatch(ax, ay, bx, by, isBlocked) {
  return withinCatchRange(ax, ay, bx, by) && !lineOfSightBlocked(ax, ay, bx, by, isBlocked);
}

function catchPlayer(player, garden, npc) {
  if (sessions.has(player)) return;
  const state = garden.patrols.get(npc);
  if (state) state.pause = 1;
  const token = {};
  sessions.set(player, token);
  player.sendMessage(CAUGHT_MESSAGE);
  later(1, () => {
    if (sessions.get(player) !== token) return;
    sessions.delete(player);
    if (player.isRegistered?.() === false) return;
    player.moveTo(centralGarden());
  });
}

// --- Patrols

/** `{ dir, length }` for the first clear cardinal from `spawn`, or null when boxed in. */
function buildTrack(spawn, isBlocked = tileBlocked) {
  const directions = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  const rotation = Math.abs(spawn.getX() + spawn.getY()) % 4;
  for (let i = 0; i < directions.length; i++) {
    const [dx, dy] = directions[(rotation + i) % 4];
    let length = 0;
    while (
      length < PATROL_MAX
      && !isBlocked(spawn.getX() + dx * (length + 1), spawn.getY() + dy * (length + 1))
    ) {
      length++;
    }
    if (length > 0) return { dir: [dx, dy], length };
  }
  return null;
}

function initPatrol(garden, npc) {
  const spawn = npc.getLocation().clone();
  const track = buildTrack(spawn);
  garden.patrols.set(npc, {
    spawn,
    dir: track?.dir ?? null,
    length: track?.length ?? 0,
    forward: true,
    pause: 0,
  });
  npc.setScriptedMovement?.(true);
  npc.getMovementCoordinator?.().setRadius(0);
  npc.getMovementQueue().reset();
}

function patrolTick(garden, npc) {
  if (!garden.patrols.has(npc)) initPatrol(garden, npc);
  const state = garden.patrols.get(npc);
  if (!state.dir || state.length === 0 || state.pause > 0) {
    if (state.pause > 0) state.pause--;
    return;
  }
  const queue = npc.getMovementQueue();
  if (queue.size() > 0) return;
  const at = npc.getLocation();
  const offset = (at.getX() - state.spawn.getX()) * state.dir[0]
    + (at.getY() - state.spawn.getY()) * state.dir[1];
  if (state.forward && offset >= state.length) {
    state.forward = false;
    return;
  }
  if (!state.forward && offset <= 0) {
    state.forward = true;
    return;
  }
  const stepX = state.forward ? state.dir[0] : -state.dir[0];
  const stepY = state.forward ? state.dir[1] : -state.dir[1];
  if (queue.canWalk(stepX, stepY)) queue.walkStep(stepX, stepY);
}

function resetPatrols(garden) {
  for (const [npc, state] of garden.patrols) {
    state.forward = true;
    state.pause = 0;
    npc.getMovementQueue().reset();
    if (!npc.getLocation().equals(state.spawn)) npc.moveTo(state.spawn.clone());
  }
}

// --- Entry and the tree

/** True (and sends the player back) when their current Thieving level is too low. */
function entryBlocked(player, season) {
  if (meetsLevel(season, thievingLevel(player))) return false;
  player.sendMessage(LEVEL_MESSAGE(season));
  player.moveTo(centralGarden());
  return true;
}

function pickFruit(event) {
  const season = seasonForTree(event.objectId);
  if (!season) return false;
  const player = event.player;
  if (!meetsLevel(season, thievingLevel(player))) {
    player.sendMessage(PICK_LEVEL_MESSAGE(season));
    return;
  }
  const inventory = player.getInventory();
  inventory.adds(season.fruitId, 1);
  inventory.refreshItems();
  player.getSkillManager().addExperiences(core.Skill.FARMING, season.farmingXp);
  player.sendMessage(`You pick a ${season.name} sq'irk.`);
  player.moveTo(centralGarden());
}

function createGarden(season) {
  class SeasonalGarden extends core.Area {
    constructor() {
      super([new core.Boundary(season.area[0], season.area[1], season.area[2], season.area[3], PLANE)]);
      this.patrols = new Map();
    }

    process(mobile) {
      if (mobile.isNpc()) {
        if (season.elementalIds.has(mobile.getId())) patrolTick(this, mobile.getAsNpc());
        return;
      }
      if (!mobile.isPlayer()) return;
      const player = mobile.getAsPlayer();
      for (const npc of this.getNpcs()) {
        if (!season.elementalIds.has(npc.getId())) continue;
        const at = npc.getLocation();
        const me = player.getLocation();
        if (shouldCatch(at.getX(), at.getY(), me.getX(), me.getY(), tileBlocked)) {
          catchPlayer(player, this, npc);
          return;
        }
      }
    }

    postEnter(mobile) {
      if (!mobile.isPlayer()) return;
      entryBlocked(mobile.getAsPlayer(), season);
    }

    postLeave(mobile) {
      if (!mobile.isPlayer()) return;
      const player = mobile.getAsPlayer();
      sessions.delete(player);
      // The last player out leaves the gardens as they were found.
      if (this.getPlayers().length === 0) resetPatrols(this);
    }
  }
  return new SeasonalGarden();
}

function logout({ player }) {
  if (player) sessions.delete(player);
}

module.exports = function registerMaze(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  for (const key of SEASON_ORDER) api.registerArea(createGarden(SEASONS[key]));
  api.onObjectInteraction("Sq'irk tree", { "Pick-Fruit": pickFruit });
  api.onPlayerLogout(logout);
};

module.exports._test = {
  setCore(value) {
    core = value;
  },
  CAUGHT_MESSAGE,
  PATROL_MAX,
  withinCatchRange,
  lineOfSightBlocked,
  shouldCatch,
  buildTrack,
  entryBlocked,
  pickFruit,
  createGarden,
  sessions,
  _setApi(value) {
    api = value;
  },
};
