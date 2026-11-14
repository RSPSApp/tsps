/**
 * The Agility obstacles of each floor, as recorded (rsprox 1862 and 3299):
 *
 * - Drops (Jump on the "Stairs" ledges): the jump-down now, the next tick the landing a plane
 *   lower and jumpdown2, the XP the tick after.
 * - The middle stairs (Climb-down): +3 the HUD closes and the stairs' fade, +5 the landing, +7 the
 *   fade back and the XP, +9 the HUD again.
 * - Platforms: two hops of two tiles, 2 ticks apart; the first stops the timer. The F4 gate and
 *   the F5 stepping stones do the same with their own moves.
 * - The floor stairs: +2 the floor's completion and the way down.
 *
 * Handlers see the instance tile; `templateOf` gives the source tile the data is keyed on.
 */
const Common = require("./Common.HallowedSepulchre");
const Run = require("./Run.HallowedSepulchre");

/** ForceMovement's facing: 0 north, 1 east, 2 south, 3 west. */
const FACING = { "0,1": 0, "1,0": 1, "0,-1": 2, "-1,0": 3 };
/** Recorded hop timing, in client cycles. */
const HOP_CYCLES = [12, 27];

function runAt(event) {
  const run = Run.runOf(event.player);
  if (!run?.area || !event.object) return null;
  return { run, tile: run.area.templateOf(event.object.getLocation()) };
}

/** One exact move from template tile `from` to `to`, landing `ticks` later. */
function exactMove(run, from, to, cycles, facing, ticks = 1) {
  const { ForceMovement, ForceMovementTask, Location, TaskManager } = Common.core;
  const start = run.area.at(from);
  run.player.moveTo(start);
  TaskManager.submit(new ForceMovementTask(run.player, ticks,
    new ForceMovement(start.clone(), new Location(to[0] - from[0], to[1] - from[1]), cycles[0], cycles[1], facing, -1)));
}

/** Steps the player can walk from template tile `from` (breadth first, up to `limit` tiles). */
function walkable(run, from, limit = 4000) {
  const { RegionManager } = Common.core;
  const [x0, y0, z] = from;
  const seen = new Set([Common.key(x0, y0, z)]);
  const queue = [[x0, y0]];
  for (let i = 0; i < queue.length && seen.size < limit; i++) {
    const [x, y] = queue[i];
    const at = run.area.at([x, y, z]);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const key = Common.key(x + dx, y + dy, z);
      if (seen.has(key)) continue;
      if (!RegionManager.canMove(at.getX(), at.getY(), at.getX() + dx, at.getY() + dy, at.getZ(), 1, 1, run.area)) continue;
      seen.add(key);
      queue.push([x + dx, y + dy]);
    }
  }
  return seen;
}

/** Of an obstacle's two ends, the one the player can walk to (the nearer if both or neither). */
function reachableEnd(run, here, ends) {
  const seen = walkable(run, here);
  const reachable = ends.filter((end) => seen.has(Common.key(...end)));
  const pool = reachable.length ? reachable : ends;
  const distance = (end) => Math.abs(end[0] - here[0]) + Math.abs(end[1] - here[1]);
  return pool.reduce((best, end) => (distance(end) < distance(best) ? end : best));
}

function facingOf(dx, dy) {
  return FACING[`${Math.sign(dx)},${Math.sign(dy)}`] ?? 0;
}

function drop(event) {
  const found = runAt(event);
  if (!found) return false;
  const { run, tile } = found;
  const to = Common.data.drops[Common.key(...tile)];
  if (!to) return false;
  if (!run.act(3, { agility: true })) return true;
  const { player } = run;
  player.getMovementQueue().reset();
  Common.animate(player, "jumpDown", 15);
  run.schedule(1, () => {
    player.moveTo(run.area.at(to));
    run.lastLanding = to;
    Common.animate(player, "jumpDown2");
  });
  run.schedule(2, () => Common.xp(player, "AGILITY", Common.data.xp.drop));
  return true;
}

function stairs(event) {
  const found = runAt(event);
  if (!found) return false;
  const { run, tile } = found;
  const to = Common.data.stairs[Common.key(...tile)];
  if (!to) return false;
  if (!run.act(9, { agility: true })) return true;
  const { player } = run;
  player.getMovementQueue().reset();
  run.schedule(3, () => {
    Common.closeHud(player);
    Common.legacyFade(player);
  });
  run.schedule(5, () => {
    player.moveTo(run.area.at(to));
    run.lastLanding = to;
  });
  run.schedule(7, () => {
    Common.fade(player, false);
    Common.xp(player, "AGILITY", Common.data.xp.stairs);
  });
  run.schedule(9, () => {
    Common.closeFade(player);
    if (!run.expired) Common.openHud(player);
  });
  return true;
}

/** Hops through `tiles` (template, the first is where the player starts), 2 ticks apart. */
function hops(run, tiles, spacing, onFirst, xp) {
  const { player } = run;
  player.getMovementQueue().reset();
  tiles.slice(1).forEach((to, index) => {
    const from = tiles[index];
    const hop = () => {
      Common.animate(player, "jumpStones");
      exactMove(run, from, to, [HOP_CYCLES[0], to[3] ?? HOP_CYCLES[1]], facingOf(to[0] - from[0], to[1] - from[1]));
      if (index === 0) onFirst();
    };
    if (index === 0) hop();
    else run.schedule(index * spacing, hop);
  });
  run.schedule((tiles.length - 1) * spacing, () => Common.xp(player, "AGILITY", xp));
}

/** A platform's hops: from two tiles before it, onto it, to two tiles past it. */
function platformHops(objectId, [x, y, z]) {
  const [dx, dy] = Common.data.platforms[String(objectId)] ?? [];
  if (dx == null) return null;
  return [[x - 2 * dx, y - 2 * dy, z], [x, y, z], [x + 2 * dx, y + 2 * dy, z]];
}

/** Whether template tile `here` is past the platform `tile`, the way it goes. */
function pastPlatform(objectId, tile, here) {
  const [dx, dy] = Common.data.platforms[String(objectId)];
  return (here[0] - tile[0]) * dx + (here[1] - tile[1]) * dy > 0;
}

function platform(event) {
  const found = runAt(event);
  if (!found) return false;
  const { run, tile } = found;
  const path = platformHops(event.objectId, tile);
  if (!path) return false;
  if (!run.act(4)) return true;
  const here = run.area.templateOf(run.player.getLocation());
  if (pastPlatform(event.objectId, tile, here)) {
    run.player.sendMessage(Common.message("noBack"));
    return true;
  }
  run.crossAgilityObstacle(4);
  const xp = run.floorNumber === 5 ? Common.data.xp.platformFloor5 : Common.data.xp.platform;
  hops(run, path, 2, () => {
    Common.spam(run.player, Common.message("platform"));
    run.pause();
  }, xp);
  return true;
}

function steppingStones(event) {
  const found = runAt(event);
  if (!found) return false;
  const { run } = found;
  const { from, hops: path } = Common.data.steppingStones;
  if (!run.act(4)) return true;
  const here = run.area.templateOf(run.player.getLocation());
  if (here[1] < from[1] - 1) {
    run.player.sendMessage(Common.message("noBack"));
    return true;
  }
  run.crossAgilityObstacle(4);
  const tiles = [from, ...path.map(([x, y, cycles]) => [x, y, from[2], cycles])];
  hops(run, tiles, 1, () => run.pause(), Common.data.xp.steppingStones);
  return true;
}

/** A floor 2 stepping stone (not recorded): a hop from a tile in line onto the stone. */
function floor2Stone(event) {
  const found = runAt(event);
  if (!found) return false;
  const { run, tile } = found;
  const here = run.area.templateOf(run.player.getLocation());
  const dx = tile[0] - here[0];
  const dy = tile[1] - here[1];
  if ((dx !== 0 && dy !== 0) || Math.abs(dx + dy) > 2 || dx + dy === 0) return false;
  if (!run.act(2, { agility: true })) return true;
  run.player.getMovementQueue().reset();
  Common.animate(run.player, "jumpStones");
  exactMove(run, here, tile, HOP_CYCLES, facingOf(dx, dy));
  run.schedule(1, () => Common.xp(run.player, "AGILITY", Common.data.floor2Stones.xp));
  return true;
}

function gate(event) {
  const found = runAt(event);
  if (!found) return false;
  const { run } = found;
  const { from, to, cycles } = Common.data.gate;
  if (!run.act(3)) return true;
  const here = run.area.templateOf(run.player.getLocation());
  if (here[1] > from[1]) {
    run.player.sendMessage(Common.message("noBack"));
    return true;
  }
  run.crossAgilityObstacle(3);
  run.player.getMovementQueue().reset();
  Common.spam(run.player, Common.message("gate"));
  Common.animate(run.player, "squeeze");
  exactMove(run, from, to, cycles, facingOf(to[0] - from[0], to[1] - from[1]), 2);
  run.pause();
  run.schedule(2, () => Common.xp(run.player, "AGILITY", Common.data.xp.gate));
  return true;
}

/** The floor stairs: the next floor's Agility level, then +2 the floor's credit and the way down. */
function floorStairs(event) {
  const found = runAt(event);
  if (!found) return false;
  const { run } = found;
  const { player } = run;
  if (run.transitioning || require("./Traps.HallowedSepulchre").holding(run)) return true;
  if (run.expired) {
    player.sendMessage(Common.message("stairsBlocked"));
    return true;
  }
  const next = Common.data.floors.find((floor) => floor.floor === run.floorNumber + 1);
  if (!next) return false;
  if (Common.agilityRequired() && Common.level(player, "AGILITY") < next.agility) {
    player.sendMessage(Common.message("agilityLevel", { level: next.agility }));
    return true;
  }
  player.getMovementQueue().reset();
  run.transitioning = true;
  run.schedule(2, () => run.completeFloor());
  return true;
}

/** Template tiles obstacles are used from, by object id: (run, tile, here, id) => tile or null. */
const startTiles = new Map();

function registerStart(ids, start) {
  for (const id of [].concat(ids)) startTiles.set(id, start);
}

/**
 * Walk to the obstacle's own start tile: the platforms and stones sit across gaps the player
 * can't stand next to, and the pillars, bridges and portals are used from a set tile.
 */
function route(event) {
  const start = startTiles.get(event.objectId);
  const run = start && Run.runOf(event.player);
  if (!run?.area || !event.object) return;
  const tile = run.area.templateOf(event.object.getLocation());
  const here = run.area.templateOf(event.player.getLocation());
  const to = start(run, tile, here, event.objectId);
  if (!to) return;
  const at = run.area.at(to);
  event.destination = { x: at.getX(), y: at.getY(), z: at.getZ() };
}

function attachObstacles(api) {
  const { data } = Common;
  registerStart(Object.keys(data.platforms).map(Number), (run, tile, here, id) => (
    pastPlatform(id, tile, here) ? null : platformHops(id, tile)[0]));
  registerStart(data.steppingStones.ids, () => data.steppingStones.from);
  registerStart(data.gate.id, () => data.gate.from);
  api.onObjectRoute(route);
  api.onObjectClick(data.dropIds, 1, drop);
  api.onObjectClick(data.stairIds, 1, stairs);
  api.onObjectClick(Object.keys(data.platforms).map(Number), 1, platform);
  api.onObjectClick(data.steppingStones.ids, 1, steppingStones);
  api.onObjectClick(data.gate.id, 1, gate);
  api.onObjectClick(data.floor2Stones.ids, 1, floor2Stone);
  api.onObjectClick(data.floorStairs, 1, floorStairs);
}

module.exports = { attachObstacles, exactMove, facingOf, runAt, registerStart, reachableEnd };
