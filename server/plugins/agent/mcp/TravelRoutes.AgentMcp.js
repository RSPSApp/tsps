// Route planning for travel_to: A* over tile collision on every floor, joined by transports
// (doors, stairs, shortcuts, boats ...) from plugins/agent/data/transports.json and closed doors
// found on the map. A transport is an edge from the tile a player clicks it from to where it
// takes them; the walk between transports follows the server's collision.
//
// Pure: collision, doors and which transports may be used are passed in.

// Collision flags, as in RsmodRouteFinding.
const WALL_NORTH_WEST = 0x1;
const WALL_NORTH = 0x2;
const WALL_NORTH_EAST = 0x4;
const WALL_EAST = 0x8;
const WALL_SOUTH_EAST = 0x10;
const WALL_SOUTH = 0x20;
const WALL_SOUTH_WEST = 0x40;
const WALL_WEST = 0x80;
const LOC = 0x100;
const FLOOR_BLOCKED = 0x200000 | 0x40000;
const BLOCKED = LOC | FLOOR_BLOCKED;

// Walls that stop a step into a tile, by the direction of the step.
const STRAIGHT = [
  { dx: 0, dy: 1, wall: WALL_SOUTH },
  { dx: 1, dy: 0, wall: WALL_WEST },
  { dx: 0, dy: -1, wall: WALL_NORTH },
  { dx: -1, dy: 0, wall: WALL_EAST },
];
const DIAGONAL = [
  { dx: 1, dy: 1, corner: WALL_SOUTH_WEST | WALL_SOUTH | WALL_WEST, x: WALL_WEST, y: WALL_SOUTH },
  { dx: -1, dy: 1, corner: WALL_SOUTH_EAST | WALL_SOUTH | WALL_EAST, x: WALL_EAST, y: WALL_SOUTH },
  { dx: 1, dy: -1, corner: WALL_NORTH_WEST | WALL_NORTH | WALL_WEST, x: WALL_WEST, y: WALL_NORTH },
  { dx: -1, dy: -1, corner: WALL_NORTH_EAST | WALL_NORTH | WALL_EAST, x: WALL_EAST, y: WALL_NORTH },
];

// Tiles searched per plan: bounds the cost of proving a goal unreachable.
const MAX_EXPANSIONS = 600000;
// A door costs a few steps more than walking past it, so open ways are preferred.
const DOOR_COST = 4;
// The goal tile may itself be blocked (a rock, a counter): this close counts.
const GOAL_REACH = 1;

const key = (x, y, z) => z * 268435456 + x * 16384 + y;
const unkey = (k) => ({ z: Math.floor(k / 268435456), x: Math.floor(k / 16384) % 16384, y: k % 16384 });
const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** Binary min-heap of keys by f-score. */
class Heap {
  constructor() {
    this.items = [];
    this.scores = [];
  }
  push(item, score) {
    const { items, scores } = this;
    let index = items.length;
    items.push(item);
    scores.push(score);
    while (index > 0) {
      const up = (index - 1) >> 1;
      if (scores[up] <= score) break;
      items[index] = items[up];
      scores[index] = scores[up];
      index = up;
    }
    items[index] = item;
    scores[index] = score;
  }
  pop() {
    const { items, scores } = this;
    const top = items[0];
    const lastItem = items.pop();
    const lastScore = scores.pop();
    if (items.length > 0) {
      let index = 0;
      for (;;) {
        let child = index * 2 + 1;
        if (child >= items.length) break;
        if (child + 1 < items.length && scores[child + 1] < scores[child]) child += 1;
        if (scores[child] >= lastScore) break;
        items[index] = items[child];
        scores[index] = scores[child];
        index = child;
      }
      items[index] = lastItem;
      scores[index] = lastScore;
    }
    return top;
  }
  get size() {
    return this.items.length;
  }
}

/** Transport rows indexed by the tile they are clicked from. */
function indexTransports(data) {
  const byOrigin = new Map();
  const [from, to, menu, id, ...fields] = data.columns;
  for (const [type, rows] of Object.entries(data.transports)) {
    for (const row of rows) {
      const transport = { type, from: row[0], to: row[1], menu: row[2], id: row[3] };
      fields.forEach((field, index) => {
        if (row[4 + index] != null) transport[field] = row[4 + index];
      });
      const at = key(...transport.from);
      if (!byOrigin.has(at)) byOrigin.set(at, []);
      byOrigin.get(at).push(transport);
    }
  }
  return byOrigin;
}

/**
 * @param from {x, y, z}
 * @param to {x, y, z}
 * @param getFlag (x, y, z) => collision flags; a tile outside the map should report BLOCKED
 * @param transportsAt (x, y, z) => transports clicked from that tile
 * @param doorAt (x, y, z) => a closed door/gate on that tile as a transport-like
 *   { menu, id, object }, or null; used where no transport row crosses the wall
 * @param usable (transport) => true when the route may take it
 * @param goalReach how close to `to` counts as there (0: the exact tile)
 * @returns {{ steps: {x, y, z, via?}[], cost, expansions } | null} where `via` is the transport
 *   that reached that step (walks have none)
 */
function planTravel({ from, to, getFlag, transportsAt, doorAt = () => null, usable = () => true, goalReach = GOAL_REACH, maxExpansions = MAX_EXPANSIONS }) {
  const g = new Map();
  const parent = new Map();
  const via = new Map();
  const closed = new Set();
  const open = new Heap();
  const start = key(from.x, from.y, from.z);
  const heuristic = (x, y) => Math.max(Math.abs(x - to.x), Math.abs(y - to.y));
  g.set(start, 0);
  open.push(start, heuristic(from.x, from.y));
  let expansions = 0;
  let found = null;

  const relax = (current, next, cost, transport) => {
    if (closed.has(next)) return;
    const tentative = g.get(current) + cost;
    const known = g.get(next);
    if (known !== undefined && tentative >= known) return;
    g.set(next, tentative);
    parent.set(next, current);
    if (transport) via.set(next, transport);
    else via.delete(next);
    const at = unkey(next);
    open.push(next, tentative + heuristic(at.x, at.y));
  };

  while (open.size > 0 && expansions < maxExpansions) {
    const current = open.pop();
    if (closed.has(current)) continue;
    closed.add(current);
    expansions += 1;
    const { x, y, z } = unkey(current);
    if (z === to.z && heuristic(x, y) <= goalReach) {
      found = current;
      break;
    }
    for (const move of STRAIGHT) {
      const nx = x + move.dx;
      const ny = y + move.dy;
      const flag = getFlag(nx, ny, z);
      if (flag & BLOCKED) continue;
      if (flag & move.wall) {
        // Through a wall only by a closed door with no transport row of its own.
        if (transportsAt(x, y, z).some(({ to: [tx, ty, tz] }) => tx === nx && ty === ny && tz === z)) continue;
        const found = doorAt(nx, ny, z) ?? doorAt(x, y, z);
        const door = found && { ...found, from: [x, y, z], to: [nx, ny, z] };
        if (door && usable(door)) relax(current, key(nx, ny, z), DOOR_COST, door);
        continue;
      }
      relax(current, key(nx, ny, z), 1, null);
    }
    for (const move of DIAGONAL) {
      const nx = x + move.dx;
      const ny = y + move.dy;
      if (getFlag(nx, ny, z) & (BLOCKED | move.corner)) continue;
      if (getFlag(nx, y, z) & (BLOCKED | move.x)) continue;
      if (getFlag(x, ny, z) & (BLOCKED | move.y)) continue;
      relax(current, key(nx, ny, z), 1, null);
    }
    for (const transport of transportsAt(x, y, z)) {
      if (!usable(transport)) continue;
      const [tx, ty, tz] = transport.to;
      const span = chebyshev({ x, y }, { x: tx, y: ty });
      relax(current, key(tx, ty, tz), Math.max(1, transport.ticks ?? span, span <= 1 ? DOOR_COST : 0), transport);
    }
  }
  if (found === null) return null;
  const steps = [];
  for (let at = found; at !== undefined; at = parent.get(at)) {
    steps.push({ ...unkey(at), ...(via.has(at) ? { via: via.get(at) } : {}) });
  }
  steps.reverse();
  return { steps, cost: g.get(found), expansions };
}

/**
 * The requirements of a transport a player doesn't meet, as readable reasons, in the
 * Shortest Path table's notation: skills "30 Agility;50 Strength"; items "COINS=30",
 * "AXE=1&MACHETE=1" (all of), "AIR_RUNE=3|DUST_RUNE=3" (any of), a quantity of 0 meaning
 * none held; quests by name; varbits/varps "538=1", ">", "<", "&" (bits set), "@" (a
 * cooldown, not checked); an item alternative UNLOCK_<NAME> is an account unlock (a stored
 * canoe axe, a diary). `player` reads the state: level(skill name) (undefined when unknown),
 * count(item ids), unlocked(name without UNLOCK_; false when the server doesn't track it),
 * questComplete(name), varbit(id), varp(id).
 */
function unmetRequirements(transport, itemGroups, player) {
  const reasons = [];
  const list = (text) => String(text ?? "").split(";").map((entry) => entry.trim()).filter(Boolean);
  for (const entry of list(transport.skills)) {
    const [level, ...name] = entry.split(/\s+/);
    const current = player.level(name.join(" "));
    if (current === undefined) reasons.push(`skill ${entry} (unknown here)`);
    else if (current < Number(level)) reasons.push(entry);
  }
  for (const all of String(transport.items ?? "").replace(/\s+/g, "").toUpperCase().split("&").filter(Boolean)) {
    const met = all.split("|").filter(Boolean).some((option) => {
      const [name, quantity] = option.split("=");
      if (name.startsWith("UNLOCK_")) return player.unlocked(name.slice("UNLOCK_".length)) === true;
      const ids = itemGroups[name] ?? (Number.isInteger(Number(name)) ? [Number(name)] : []);
      const required = Number(quantity) || 0;
      const held = player.count(ids);
      return required === 0 ? held === 0 : held >= required;
    });
    if (!met) reasons.push(`items ${all}`);
  }
  for (const name of list(transport.quests)) {
    if (!player.questComplete(name)) reasons.push(`quest ${name}`);
  }
  for (const [field, read, label] of [["varbits", player.varbit, "varbit"], ["varps", player.varp, "varp"]]) {
    for (const entry of list(transport[field])) {
      const match = /^(\d+)([=&@<>])(\d+)$/.exec(entry);
      if (!match || match[2] === "@") continue;
      const value = Number(read(Number(match[1])) ?? 0);
      const wanted = Number(match[3]);
      const met = match[2] === "=" ? value === wanted : match[2] === ">" ? value > wanted
        : match[2] === "<" ? value < wanted : (value & wanted) !== 0;
      if (!met) reasons.push(`${label} ${entry} (is ${value})`);
    }
  }
  return reasons;
}

/** The steps split into walks (tile lists) and the transports between them. */
function toLegs(steps) {
  const legs = [];
  let walk = [steps[0]];
  for (const step of steps.slice(1)) {
    if (!step.via) {
      walk.push(step);
      continue;
    }
    if (walk.length > 1) legs.push({ kind: "walk", tiles: walk });
    legs.push({ kind: "transport", transport: step.via, arrive: { x: step.x, y: step.y, z: step.z } });
    walk = [{ x: step.x, y: step.y, z: step.z }];
  }
  if (walk.length > 1) legs.push({ kind: "walk", tiles: walk });
  return legs;
}

// skipWalks: tiles walked either side of an area change, so its enter and leave hooks run on a
// real step; and the shortest stretch worth moving over in one hop instead of walking.
const SKIP_MARGIN = 3;
const MIN_SKIP = 5;

/**
 * A walk leg's tiles split into stretches to skip and stretches to walk, as steps from tiles[0]:
 * `{ skip: i }` moves straight to tiles[i]; `{ walk: i }` walks to it. A walk covers `margin`
 * tiles either side of every change of `areaAt` (an Area's hooks, a multi-combat or wilderness
 * edge) and every tile `unsafe` marks; a skip shorter than `minSkip` is walked instead.
 */
function skipPlan(tiles, { areaAt, unsafe = () => false, margin = SKIP_MARGIN, minSkip = MIN_SKIP }) {
  const last = tiles.length - 1;
  const areas = tiles.map(areaAt);
  const walk = tiles.map(unsafe);
  for (let i = 1; i <= last; i++) {
    if (areas[i] === areas[i - 1]) continue;
    for (let j = Math.max(0, i - margin); j <= Math.min(last, i + margin - 1); j++) walk[j] = true;
  }
  const steps = [];
  for (let at = 0; at < last;) {
    let end = at + 1;
    const skipping = !walk[end];
    while (end < last && !walk[end + 1] === skipping) end++;
    const kind = skipping && end - at >= minSkip ? "skip" : "walk";
    const previous = steps[steps.length - 1];
    if (kind === "walk" && previous && "walk" in previous) previous.walk = end;
    else steps.push({ [kind]: end });
    at = end;
  }
  return steps;
}

module.exports = { planTravel, toLegs, indexTransports, unmetRequirements, skipPlan, key, BLOCKED };
