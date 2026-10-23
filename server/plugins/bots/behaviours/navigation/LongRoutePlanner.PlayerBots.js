"use strict";

/**
 * Long-distance route planning for bots. The in-game route finder only searches a
 * 128x128 window, and straight-line staged walking cannot find detours past it
 * (a fenced field, a river with the bridge behind the bot). This plans the whole
 * walk with A* over tile collision flags, treating closed doors/gates as passable
 * (the brain opens them on arrival), and returns waypoints the existing segmented
 * walking follows one at a time.
 *
 * Pure: collision and door lookups are passed in, so it is testable on a fake map.
 */

// Collision flags, as in RsmodRouteFinding.
const WALL_NORTH = 0x2;
const WALL_EAST = 0x8;
const WALL_SOUTH = 0x20;
const WALL_WEST = 0x80;
const LOC = 0x100;
const FLOOR_BLOCKED = 0x200000 | 0x40000;

// Moving in a direction is blocked by these flags on the destination tile.
const MOVES = [
  { dx: 0, dy: 1, wall: WALL_SOUTH },  // north: a wall on the destination's south side
  { dx: 1, dy: 0, wall: WALL_WEST },   // east
  { dx: 0, dy: -1, wall: WALL_NORTH }, // south
  { dx: -1, dy: 0, wall: WALL_EAST },  // west
];

const MAX_BOX_SIDE = 640;
// Tiles searched per plan, across all box widenings: bounds the cost of proving
// a target unreachable (an island) to a few tens of ms.
const DEFAULT_MAX_EXPANSIONS = 120000;
const DOOR_COST = 4;
// The goal tile may itself be blocked (a rock, a tree): close enough counts.
const GOAL_REACH = 2;
// No exact path (goal in water): settle for the closest reachable tile this near.
const NEAR_GOAL_TILES = 10;
const WAYPOINT_SPACING = 12;

// Scratch buffers sized for the largest box, reused between plans; only touched
// cells are reset.
const CELLS = MAX_BOX_SIDE * MAX_BOX_SIDE;
const gScore = new Int32Array(CELLS).fill(-1);
const parent = new Int32Array(CELLS);
const closed = new Uint8Array(CELLS);

/** Binary min-heap of cell indices keyed by f-score. */
class Heap {
  constructor() {
    this.items = [];
    this.keys = [];
  }
  push(item, key) {
    const { items, keys } = this;
    let index = items.length;
    items.push(item);
    keys.push(key);
    while (index > 0) {
      const up = (index - 1) >> 1;
      if (keys[up] <= key) break;
      items[index] = items[up];
      keys[index] = keys[up];
      index = up;
    }
    items[index] = item;
    keys[index] = key;
  }
  pop() {
    const { items, keys } = this;
    const top = items[0];
    const lastItem = items.pop();
    const lastKey = keys.pop();
    if (items.length > 0) {
      let index = 0;
      for (;;) {
        let child = index * 2 + 1;
        if (child >= items.length) break;
        if (child + 1 < items.length && keys[child + 1] < keys[child]) child += 1;
        if (keys[child] >= lastKey) break;
        items[index] = items[child];
        keys[index] = keys[child];
        index = child;
      }
      items[index] = lastItem;
      keys[index] = lastKey;
    }
    return top;
  }
  get size() {
    return this.items.length;
  }
}

/**
 * @param from {x, y, z}
 * @param to {x, y}
 * @param getFlag (x, y, z) => collision flags
 * @param isDoor (x, y, z) => true when a closed door/gate stands on that tile
 * @param exactOnly true: no near-goal fallback (a yes/no reachability question)
 * @param goalReach maximum distance from the target; 0 requires its exact tile
 * @returns {{ waypoints: {x, y, z}[], tiles: number } | null}
 */
function planRoute(options) {
  // Detours can run far past both ends (round a fenced field, back to a bridge):
  // search a small box first, and widen it only when that finds no way through.
  const span = Math.max(Math.abs(options.to.x - options.from.x), Math.abs(options.to.y - options.from.y));
  const budget = { left: options.maxExpansions ?? DEFAULT_MAX_EXPANSIONS };
  let nearest = null;
  for (let margin = Math.max(64, Math.floor(span / 2)); budget.left > 0; margin *= 2) {
    const result = planInBox(options, margin, budget);
    if (result === false) break; // box too big
    if (result.exact) return result.plan;
    nearest = result.plan ?? nearest;
    if (span + 2 * margin >= MAX_BOX_SIDE) break;
  }
  // No exact way in (a goal on water): the closest reachable tile, found only after
  // the widest search, so a wall with a gate further off is never cut short.
  return options.exactOnly ? null : nearest;
}

/** A* inside the start/goal box widened by `margin`: { exact, plan }, or false (box too big). */
function planInBox({ from, to, getFlag, isDoor = () => false, goalReach = GOAL_REACH }, margin, budget) {
  const z = from.z;
  const minX = Math.min(from.x, to.x) - margin;
  const minY = Math.min(from.y, to.y) - margin;
  const width = Math.max(from.x, to.x) + margin - minX + 1;
  const height = Math.max(from.y, to.y) + margin - minY + 1;
  if (width > MAX_BOX_SIDE || height > MAX_BOX_SIDE) {
    return false;
  }
  const cell = (x, y) => (y - minY) * width + (x - minX);
  const heuristic = (x, y) => Math.abs(x - to.x) + Math.abs(y - to.y);
  const touched = [];
  const doorMemo = new Map();
  const doorAt = (x, y) => {
    const key = x * 65536 + y;
    let value = doorMemo.get(key);
    if (value === undefined) {
      value = isDoor(x, y, z) === true;
      doorMemo.set(key, value);
    }
    return value;
  };

  const start = cell(from.x, from.y);
  gScore[start] = 0;
  parent[start] = -1;
  touched.push(start);
  const open = new Heap();
  open.push(start, heuristic(from.x, from.y));
  let best = start;
  let bestDistance = Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y));
  let found = -1;
  let expansions = 0;

  try {
    while (open.size > 0 && expansions < budget.left) {
      const current = open.pop();
      if (closed[current]) continue;
      closed[current] = 1;
      expansions += 1;
      const x = minX + (current % width);
      const y = minY + Math.floor(current / width);
      const distance = Math.max(Math.abs(x - to.x), Math.abs(y - to.y));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = current;
      }
      if (distance <= goalReach) {
        found = current;
        break;
      }
      for (const move of MOVES) {
        const nx = x + move.dx;
        const ny = y + move.dy;
        if (nx < minX || ny < minY || nx >= minX + width || ny >= minY + height) continue;
        const next = cell(nx, ny);
        if (closed[next]) continue;
        const flag = getFlag(nx, ny, z);
        if (flag & (LOC | FLOOR_BLOCKED)) continue;
        let cost = 1;
        if (flag & move.wall) {
          // Only a door or gate on either side of the wall makes it passable.
          if (!doorAt(nx, ny) && !doorAt(x, y)) continue;
          cost = DOOR_COST;
        }
        const tentative = gScore[current] + cost;
        if (gScore[next] !== -1 && tentative >= gScore[next]) continue;
        if (gScore[next] === -1) touched.push(next);
        gScore[next] = tentative;
        parent[next] = current;
        open.push(next, tentative + heuristic(nx, ny));
      }
    }
    budget.left -= expansions;
    const exact = found !== -1;
    if (!exact && bestDistance <= NEAR_GOAL_TILES && best !== start) {
      found = best;
    }
    if (found === -1) {
      return { exact: false, plan: null };
    }
    const tiles = [];
    for (let at = found; at !== -1; at = parent[at]) {
      tiles.push({ x: minX + (at % width), y: minY + Math.floor(at / width) });
    }
    tiles.reverse();
    return { exact, plan: { waypoints: toWaypoints(tiles, z, getFlag), tiles: tiles.length } };
  } finally {
    for (const index of touched) {
      gScore[index] = -1;
      closed[index] = 0;
    }
  }
}

/**
 * Every WAYPOINT_SPACING tiles, plus the tiles either side of each door crossing
 * (so the walk reaches the door, the brain opens it, and continues), plus the end.
 * A crossing is a step through a wall: A* only allows that at a door.
 */
function toWaypoints(tiles, z, getFlag) {
  const waypoints = [];
  let sinceLast = 0;
  for (let index = 1; index < tiles.length; index += 1) {
    const previous = tiles[index - 1];
    const tile = tiles[index];
    sinceLast += 1;
    const move = MOVES.find((entry) => entry.dx === tile.x - previous.x && entry.dy === tile.y - previous.y);
    const crossesDoor = !!move && (getFlag(tile.x, tile.y, z) & move.wall) !== 0;
    if (crossesDoor) {
      // The far side is marked `door`: the walker must stand on it, so the gate
      // is actually crossed instead of being "reached" from the wrong side.
      waypoints.push({ x: previous.x, y: previous.y, z });
      waypoints.push({ x: tile.x, y: tile.y, z, door: true });
      sinceLast = 0;
    } else if (sinceLast >= WAYPOINT_SPACING || index === tiles.length - 1) {
      waypoints.push({ x: tile.x, y: tile.y, z });
      sinceLast = 0;
    }
  }
  // Drop exact duplicates left by back-to-back door tiles.
  const unique = [];
  for (const point of waypoints) {
    const last = unique[unique.length - 1];
    if (last && last.x === point.x && last.y === point.y) {
      last.door = last.door || point.door;
    } else {
      unique.push(point);
    }
  }
  return unique;
}

module.exports = {
  planRoute,
};
