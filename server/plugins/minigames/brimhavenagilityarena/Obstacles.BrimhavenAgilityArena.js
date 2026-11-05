"use strict";

/**
 * The arena's clickable obstacles. Each one spans the eight-tile gap between two pillars, and one
 * click crosses the whole of it: the player stands on the gap's near tile, is carried to its far
 * tile and is paid the Wiki's XP once, the tick after landing (rsprox 75, 1102, 1735, 1738, 1863,
 * 4308 all agree; a log, rope or line of pillars never pays per tile). The rope swing swings the
 * player from two tiles before the rope to three past it. Blade and trap obstacles have no click
 * option; the Area unit handles those.
 */

const Shared = require("./Shared.BrimhavenAgilityArena");
const ObstacleRunner = require("../../skills/agility/ObstacleRunner.Agility");

/** The rope swing's own animation, sound and how far past the rope it lands (rsprox captures). */
const ROPE_SWING = { ANIM: 751, ROPE_ANIM: 497, SOUND: 2494, PAST: 3, BEFORE: 2 };
/** 0 west, 1 north, 2 east, 3 south, as the agility steps' wall facings. */
const ROTATION_VECTORS = [[-1, 0], [0, 1], [1, 0], [0, -1]];
const BROKEN_PLANK_ID = 3576;
const PLANK_FALL_ANIMATION = 768;
const PLANK_FALL_SOUNDS = [2479, 2493];
const PLANK_LAND_SOUND = 2455;
const PLANK_FAIL_MESSAGE = "You stepped on a broken piece of plank!";

/** The four changeable planks in each of the arena's two three-lane plank banks. */
const PLANK_BANKS = [
  { lanes: [
    [[2765, 9556], [2766, 9556], [2767, 9556], [2768, 9556]],
    [[2765, 9557], [2766, 9557], [2767, 9557], [2768, 9557]],
    [[2765, 9558], [2766, 9558], [2767, 9558], [2768, 9558]],
  ] },
  { lanes: [
    [[2798, 9589], [2799, 9589], [2800, 9589], [2801, 9589]],
    [[2798, 9590], [2799, 9590], [2800, 9590], [2801, 9590]],
    [[2798, 9591], [2799, 9591], [2800, 9591], [2801, 9591]],
  ] },
];

/** Dispenser pillars stand every 11 tiles; a gap runs from 2 to 9 past one (cache). */
const GRID = { x: 2761, y: 9546, step: 11 };

/**
 * Where each obstacle runs, from the cache's placements (rev 241): `axis` is the way the player
 * moves, `at` the other coordinate of the tiles they move over, `ends` the clicked locs' spread
 * along the axis (end pieces included). Planks are three parallel lanes. The low walls (1x2) are
 * listed by the two tiles they cover.
 */
const LINES = [
  { kind: "BALANCING_ROPE", axis: "y", at: 2772, ends: [9559, 9566] },
  { kind: "BALANCING_ROPE", axis: "y", at: 2783, ends: [9581, 9588] },
  { kind: "BALANCING_ROPE", axis: "y", at: 2794, ends: [9548, 9555] },
  { kind: "LOG_BALANCE", axis: "x", at: 9579, ends: [2764, 2769] },
  { kind: "LOG_BALANCE", axis: "y", at: 2794, ends: [9582, 9587] },
  { kind: "LOG_BALANCE", axis: "y", at: 2805, ends: [9549, 9554] },
  { kind: "BALANCING_LEDGE", axis: "x", at: 9546, ends: [2764, 2769], wall: "south" },
  { kind: "BALANCING_LEDGE", axis: "x", at: 9590, ends: [2764, 2769], wall: "north" },
  { kind: "BALANCING_LEDGE", axis: "x", at: 9546, ends: [2797, 2802], wall: "south" },
  // The bars' end pieces (3564) stand one tile off the line the player swings along.
  { kind: "MONKEY_BARS", axis: "y", at: 2772, ends: [9570, 9577], side: 2771 },
  { kind: "MONKEY_BARS", axis: "x", at: 9546, ends: [2774, 2781], side: 9545 },
  { kind: "MONKEY_BARS", axis: "y", at: 2794, ends: [9559, 9566], side: 2793 },
  { kind: "PLANK", axis: "x", at: 9556, ends: [2764, 2769] },
  { kind: "PLANK", axis: "x", at: 9557, ends: [2764, 2769] },
  { kind: "PLANK", axis: "x", at: 9558, ends: [2764, 2769] },
  { kind: "PLANK", axis: "x", at: 9589, ends: [2797, 2802] },
  { kind: "PLANK", axis: "x", at: 9590, ends: [2797, 2802] },
  { kind: "PLANK", axis: "x", at: 9591, ends: [2797, 2802] },
  { kind: "PILLAR", axis: "y", at: 2761, ends: [9549, 9554] },
  { kind: "PILLAR", axis: "x", at: 9568, ends: [2786, 2791] },
  { kind: "PILLAR", axis: "y", at: 2805, ends: [9571, 9576] },
  { kind: "HAND_HOLDS", axis: "y", at: 2759, ends: [9559, 9566], wall: "west" },
  { kind: "HAND_HOLDS", axis: "x", at: 9544, ends: [2785, 2792], wall: "south" },
  { kind: "HAND_HOLDS", axis: "x", at: 9592, ends: [2785, 2792], wall: "north" },
  { kind: "LOW_WALL", axis: "y", at: 2783, ends: [9562, 9563] },
  { kind: "LOW_WALL", axis: "y", at: 2805, ends: [9562, 9563] },
  { kind: "LOW_WALL", axis: "x", at: 9590, ends: [2777, 2778] },
];

/** objectId -> obstacle family key. */
const FAMILY = new Map();
for (const [kind, ids] of Object.entries(Shared.OBSTACLE_IDS)) {
  for (const id of ids) FAMILY.set(id, kind);
}

let plankObjects = new Map();
let plankIds = new Map();
let plankTemplates = null;
let plankSafeLanes = null;

function plankKey(x, y) {
  return `${x},${y}`;
}

/** Read the map's initial plank layout once so its models and rotations stay cache-accurate. */
function initializePlanks() {
  if (plankTemplates) return true;
  const core = Shared.core();
  const objects = new Map();
  const ids = new Map();
  const templates = [];
  const safeLanes = [];
  for (const bank of PLANK_BANKS) {
    const patterns = [];
    for (const lane of bank.lanes) {
      const pattern = [];
      for (const [x, y] of lane) {
        const object = core.MapObjects.getType(new core.Location(x, y, Shared.ARENA_PLANE), 22, null);
        if (!object) return false;
        const key = plankKey(x, y);
        objects.set(key, object);
        ids.set(key, object.getId());
        pattern.push(object.getId());
      }
      patterns.push(pattern);
    }
    const safeLane = patterns.findIndex((pattern) => pattern.every((id) => id !== BROKEN_PLANK_ID));
    if (safeLane < 0 || patterns.filter((pattern) => pattern.every((id) => id !== BROKEN_PLANK_ID)).length !== 1) {
      return false;
    }
    templates.push(patterns);
    safeLanes.push(safeLane);
  }
  plankObjects = objects;
  plankIds = ids;
  plankTemplates = templates;
  plankSafeLanes = safeLanes;
  return true;
}

function replacePlank(x, y, id) {
  const core = Shared.core();
  const key = plankKey(x, y);
  const current = plankObjects.get(key);
  if (!current || current.getId() === id) {
    plankIds.set(key, current?.getId() ?? id);
    return;
  }
  core.ObjectManager.deregister(current, true);
  const replacement = new core.GameObject(
    id,
    new core.Location(x, y, Shared.ARENA_PLANE),
    current.getType(),
    current.getFace(),
    current.getPrivateArea?.() ?? null,
  );
  core.ObjectManager.register(replacement, true);
  plankObjects.set(key, replacement);
  plankIds.set(key, id);
}

/** Choose a different safe lane in each bank when the arena's one-minute cycle advances. */
function advancePlanks() {
  if (!initializePlanks()) return false;
  for (let bankIndex = 0; bankIndex < PLANK_BANKS.length; bankIndex++) {
    const lanes = PLANK_BANKS[bankIndex].lanes;
    const templates = plankTemplates[bankIndex];
    const safeTemplate = templates[plankSafeLanes[bankIndex]];
    const brokenTemplates = templates.filter((pattern) => pattern.some((id) => id === BROKEN_PLANK_ID));
    const shift = Shared.roll(0.5) ? 1 : 2;
    const nextSafeLane = (plankSafeLanes[bankIndex] + shift) % lanes.length;
    let brokenTemplateIndex = 0;
    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex++) {
      const pattern = laneIndex === nextSafeLane ? safeTemplate : brokenTemplates[brokenTemplateIndex++];
      for (let tileIndex = 0; tileIndex < lanes[laneIndex].length; tileIndex++) {
        const [x, y] = lanes[laneIndex][tileIndex];
        replacePlank(x, y, pattern[tileIndex]);
      }
    }
    plankSafeLanes[bankIndex] = nextSafeLane;
  }
  return true;
}

function brokenPlankOn(path) {
  const core = Shared.core();
  for (const [x, y] of path) {
    const key = plankKey(x, y);
    let id = plankIds.get(key);
    if (id == null) {
      id = core.MapObjects.getType(new core.Location(x, y, Shared.ARENA_PLANE), 22, null)?.getId();
    }
    if (id === BROKEN_PLANK_ID) return [x, y];
  }
  return null;
}

/** Fall, land on the lower arena floor, then reproduce the captured message and damage timing. */
function plankFailureSteps(path, brokenTile) {
  const tileIndex = path.findIndex(([x, y]) => x === brokenTile[0] && y === brokenTile[1]);
  const walked = path.slice(0, tileIndex + 1);
  return [
    { face: path[path.length - 1] },
    { wait: 1 },
    ...walkWithCues(walked, {
      1: [{ sound: 2480, loops: 2, delay: 10 }],
      3: [{ sound: 2480, loops: 4, delay: 10 }],
    }),
    { wait: 1 },
    { anim: PLANK_FALL_ANIMATION },
    { sound: PLANK_FALL_SOUNDS[0] },
    { sound: PLANK_FALL_SOUNDS[1], loops: 10 },
    { wait: 1 },
    { tele: [brokenTile[0], brokenTile[1], 0] },
    { sound: PLANK_LAND_SOUND },
    { wait: 1 },
    { msg: { spam: PLANK_FAIL_MESSAGE } },
    { wait: 1 },
    { run: ({ player }) => Shared.hit(player, Shared.trapDamage(player.getHitpoints())) },
  ];
}

function familyAt(objectId) {
  return FAMILY.get(objectId) ?? null;
}

function obstacleXp(kind) {
  return Shared.OBSTACLE_XP[kind] ?? 0;
}

/** The line a clicked loc belongs to: its own lane first, then one off it (the bars' ends). */
function lineAt(kind, x, y) {
  const candidates = LINES.filter((line) => {
    if (line.kind !== kind) return false;
    const along = line.axis === "x" ? x : y;
    const across = line.axis === "x" ? y : x;
    return along >= line.ends[0] && along <= line.ends[1] && (across === line.at || across === line.side);
  });
  return candidates[0] ?? null;
}

/** The eight gap tiles' coordinates along the line, between the two pillars' platforms. */
function gapOf(line) {
  const origin = line.axis === "x" ? GRID.x : GRID.y;
  const pillar = origin + GRID.step * Math.floor((line.ends[0] - origin) / GRID.step);
  return [pillar + 2, pillar + 9];
}

function tileOn(line, along) {
  return line.axis === "x" ? [along, line.at] : [line.at, along];
}

/**
 * A crossing from the player's side: `approach` is where the obstacle starts, `path` the tiles
 * the player is then carried over (the rope starts on the platform's edge and walks its first
 * tile, the bars end on the far platform; rsprox 1735, 1863). `entry`, when given, is where a
 * click walks the player to: the bars' first tile is blocked, so the player walks to the platform
 * beside it and is stepped onto it (rsprox 1735 1251-1252: 2782,9547, then a forced step onto
 * 2781,9546).
 */
function crossing(line, player) {
  const pos = player.getLocation();
  const along = line.axis === "x" ? pos.getX() : pos.getY();
  if (line.kind === "LOW_WALL") {
    const dir = along <= line.ends[0] ? 1 : along >= line.ends[1] ? -1 : (along - line.ends[0] <= line.ends[1] - along ? 1 : -1);
    const near = dir > 0 ? line.ends[0] - 1 : line.ends[1] + 1;
    const far = dir > 0 ? line.ends[1] + 1 : line.ends[0] - 1;
    return { dir, approach: tileOn(line, near), path: [tileOn(line, far)] };
  }
  const [low, high] = gapOf(line);
  const dir = along - low <= high - along ? 1 : -1;
  const first = dir > 0 ? low : high;
  const path = [];
  for (let i = 1; i <= 7; i++) path.push(tileOn(line, first + dir * i));
  if (line.kind === "BALANCING_ROPE") {
    return { dir, approach: tileOn(line, first - dir), path: [tileOn(line, first), ...path] };
  }
  if (line.kind === "MONKEY_BARS") {
    return { dir, approach: tileOn(line, first), entry: tileOn(line, first - dir), path: [...path, tileOn(line, first + dir * 8)] };
  }
  return { dir, approach: tileOn(line, first), path };
}

/** A forced walk, one tile a tick, with each tile's extra steps on the tick it is reached. */
function walkWithCues(path, cues = {}) {
  const steps = [];
  path.forEach((tile, index) => {
    steps.push({ walk: [tile], arrive: true });
    steps.push(...(cues[index + 1] ?? []));
    if (index < path.length - 1) steps.push({ wait: 1 });
  });
  return steps;
}

/** Facing the wall, is the player moving to their right? (Hand holds and ledges.) */
function movesRight(wall, axis, dir) {
  const right = { north: [1, 0], east: [0, -1], south: [-1, 0], west: [0, 1] }[wall];
  const move = axis === "x" ? [dir, 0] : [0, dir];
  return right[0] === move[0] && right[1] === move[1];
}

const OPPOSITE = { north: "south", south: "north", east: "west", west: "east" };

/**
 * Each family's steps after the player reaches the approach tile, as captured. Tick 0 turns the
 * player to face the far end; the first move is on the tick after.
 */
function crossingSteps(line, { dir, path }) {
  const z = Shared.ARENA_PLANE;
  const far = path[path.length - 1];
  const face = { face: far };
  switch (line.kind) {
    case "BALANCING_ROPE":
      // rsprox 1863 2628-2638: the first tile walked, then 762 from the second; 2495 at 2, 5, 7.
      return [face, { wait: 1 }, ...walkWithCues(path, {
        2: [{ render: 762 }, { sound: 2495, loops: 2 }],
        5: [{ sound: 2495, loops: 2 }],
        7: [{ sound: 2495, loops: 1 }],
        8: [{ render: null }],
      }), { wait: 1 }];
    case "LOG_BALANCE":
      // rsprox 1738 311, 1863 2017: render 762, 2470 on the 1st, 4th and 7th tiles.
      return [face, { wait: 1 }, ...walkWithCues(path, {
        1: [{ render: 762 }, { sound: 2470, loops: 2 }],
        4: [{ sound: 2470, loops: 2 }],
        7: [{ sound: 2470, loops: 1 }, { render: null }],
      }), { wait: 1 }];
    case "PLANK":
      // rsprox 1738 113, 1863 2007: walked at walking pace, 2480 on the 1st and 3rd tiles.
      return [face, { wait: 1 }, ...walkWithCues(path, {
        1: [{ sound: 2480, loops: 2, delay: 10 }],
        3: [{ sound: 2480, loops: 4, delay: 10 }],
      }), { wait: 1 }];
    case "BALANCING_LEDGE": {
      // Back to the wall. Sidling to the left: 753 then render 756; to the right: render 754 and
      // 758 on stepping off (rsprox 1738 692 and 2656, both on the south ledge; the north
      // ledge is mirrored).
      const right = movesRight(OPPOSITE[line.wall], line.axis, dir);
      const first = right ? [{ render: 754 }] : [{ anim: 753 }, { render: 756 }];
      const after = right ? [{ wait: 1 }, { render: null }, { anim: 758, delay: 20 }, { wait: 1 }] : [{ wait: 1 }, { render: null }];
      return [face, { wait: 1 }, ...walkWithCues(path, {
        1: [...first, { sound: 2451, loops: 3, delay: 10 }],
        4: [{ sound: 2451, loops: 2 }],
        6: [{ sound: 2451, loops: 2 }],
      }), ...after];
    }
    case "MONKEY_BARS":
      // rsprox 1735 2638/4405: 742 + render 744 two ticks before the first swing, 743 dropping
      // onto the far platform; 2474, then 2466 on the 1st, 4th and 6th bars, 2473 on landing.
      return [{ wait: 1 }, face, { anim: 742 }, { render: 744 }, { sound: 2474 }, { wait: 2 }, ...walkWithCues(path, {
        1: [{ sound: 2466, loops: 6 }],
        4: [{ sound: 2466, loops: 4, delay: 10 }],
        6: [{ sound: 2466, loops: 3, delay: 5 }],
        8: [{ anim: 743 }, { render: null }, { sound: 2473 }],
      }), { wait: 1 }];
    case "PILLAR":
      // rsprox 75 13517, 1735 3198: one 741 jump a tick, 15-30 cycles each, 2462 with each.
      return [face, { wait: 1 }, ...path.flatMap((tile) => [
        { sound: 2462 },
        { move: [...tile, z], anim: 741, speed: [15, 30], ticks: 1 },
      ])];
    case "HAND_HOLDS": {
      // Facing the wall: 1121/1122/1124 shuffling left, 1117/1118/1120 right (rsprox 1738 123 on
      // the north wall, 1735 4084 on the south; the west wall is derived). The first move takes
      // two ticks (46-60 cycles), the rest one (4-22).
      const right = movesRight(line.wall, line.axis, dir);
      const [start, mid, end] = right ? [1117, 1118, 1120] : [1121, 1122, 1124];
      return [{ faceDir: line.wall }, { wait: 1 }, ...path.flatMap((tile, index) => {
        const last = index === path.length - 1;
        if (index === 0) {
          return [{ sound: 2450 }, { move: [...tile, z], anim: start, speed: [46, 60], dir: line.wall, ticks: 2 }];
        }
        return [
          { sound: last ? 2460 : 2459, delay: last ? 0 : 5 },
          { move: [...tile, z], anim: last ? end : mid, speed: [4, 22], dir: line.wall, ticks: 1 },
        ];
      })];
    }
    case "LOW_WALL":
      // rsprox 1735 750: 1252 over the wall's two tiles in one 144-cycle move; XP four ticks on.
      return [face, { sound: 2453, delay: 40 }, { move: [...far, z], anim: 1252, speed: [0, 144], ticks: 4 }];
    default:
      return null;
  }
}

/**
 * `past` steps beyond the clicked tile, away from where the player stood. With `alongFace`, the
 * crossing runs across the loc's facing (the rope swings: rotation 0/2 swing north-south, 1/3
 * east-west in the cache), so a diagonal click still picks the swing's own axis.
 */
function crossingTarget(player, object, past = 1, alongFace = false) {
  const at = object.getLocation();
  const pos = player.getLocation();
  let dx = at.getX() - pos.getX();
  let dy = at.getY() - pos.getY();
  if (alongFace) {
    const [ax, ay] = ROTATION_VECTORS[((object.getFace?.() ?? 0) + 1) & 3];
    const side = Math.sign(dx * ax + dy * ay) || 1;
    return { x: at.getX() + ax * side * past, y: at.getY() + ay * side * past, z: at.getZ() };
  }
  if (dx === 0 && dy === 0) {
    const [fx, fy] = ROTATION_VECTORS[(object.getFace?.() ?? 0) & 3];
    return { x: at.getX() + fx * past, y: at.getY() + fy * past, z: at.getZ() };
  }
  if (Math.abs(dx) >= Math.abs(dy)) {
    dx = Math.sign(dx);
    dy = 0;
  } else {
    dx = 0;
    dy = Math.sign(dy);
  }
  return { x: at.getX() + dx * past, y: at.getY() + dy * past, z: at.getZ() };
}

/** One swing, the tick after arriving: a 5-tile exact move, the rope animating with it. */
function ropeSwingSteps(target) {
  return [
    { anim: ROPE_SWING.ANIM, delay: 5 },
    { objAnim: ROPE_SWING.ROPE_ANIM },
    { sound: ROPE_SWING.SOUND, delay: 5 },
    { move: [target.x, target.y, target.z], speed: [30, 55], ticks: 2 },
  ];
}

function useObstacle(event) {
  const kind = familyAt(event.objectId);
  if (!kind) return false;
  const player = event.player;
  if (ObstacleRunner.isBusy(player)) return true;
  const requirement = Shared.OBSTACLE_LEVEL[kind];
  if (requirement && Shared.agilityLevel(player) < requirement) {
    player.sendMessage(Shared.levelRefusal(requirement));
    return true;
  }
  const object = event.object;
  const at = object.getLocation();
  let steps;
  let failed = false;
  if (kind === "ROPE_SWING") {
    steps = ropeSwingSteps(crossingTarget(player, object, ROPE_SWING.PAST, true));
  } else {
    const line = lineAt(kind, at.getX(), at.getY());
    if (!line) return true;
    const route = crossing(line, player);
    const pos = player.getLocation();
    const [ax, ay] = route.approach;
    const off = Math.max(Math.abs(pos.getX() - ax), Math.abs(pos.getY() - ay));
    // The route hook brings the player to the approach tile; a click from beside it steps on.
    if (off > 1) return true;
    if (kind === "PLANK" && Shared.agilityLevel(player) < 99) {
      initializePlanks();
      const brokenTile = brokenPlankOn(route.path);
      if (brokenTile) {
        failed = true;
        steps = plankFailureSteps(route.path, brokenTile);
      }
    }
    steps ??= crossingSteps(line, route);
    if (off === 1) steps = [{ walk: [route.approach], arrive: true }, ...steps];
  }
  const context = {
    player,
    object,
    core: Shared.core(),
    obj: {
      x: at.getX(), y: at.getY(), z: at.getZ(),
      face: object.getFace?.() ?? 0, type: object.getType?.() ?? 10, id: event.objectId,
    },
    pos: (() => {
      const pos = player.getLocation();
      return { x: pos.getX(), y: pos.getY(), z: pos.getZ() };
    })(),
  };
  ObstacleRunner.run(context, steps, {
    onFinish: (completed) => {
      if (completed && !failed) Shared.addObstacleXp(player, kind);
    },
  });
  return true;
}

/**
 * Clicks from far away walk to the obstacle's approach tile on the player's side: the near end
 * of its gap (the rope: the platform's edge before it; the bars: the platform beside their first
 * tile, which can't be walked onto). The rope swing hangs over a gap nobody
 * can stand in, so it is walked to two tiles before the rope, where the captures show players
 * arriving.
 */
function routeToObstacle(event) {
  const kind = familyAt(event.objectId);
  if (event.clickType !== 1 || !kind) return;
  const at = event.object.getLocation();
  if (kind === "ROPE_SWING") {
    event.destination = crossingTarget(event.player, event.object, -ROPE_SWING.BEFORE, true);
    return;
  }
  const line = lineAt(kind, at.getX(), at.getY());
  if (!line) {
    event.destination = { x: at.getX(), y: at.getY(), z: at.getZ() };
    return;
  }
  const route = crossing(line, event.player);
  const [x, y] = route.entry ?? route.approach;
  event.destination = { x, y, z: at.getZ() };
}

module.exports = (api) => {
  ObstacleRunner.init(api);
  api.onObjectInteraction("Balancing rope", { "Walk-on": useObstacle });
  api.onObjectInteraction("Log balance", { "Walk-on": useObstacle });
  api.onObjectInteraction("Balancing ledge", { "Walk-across": useObstacle });
  api.onObjectInteraction("Monkey bars", { "Swing-across": useObstacle });
  api.onObjectInteraction("Low wall", { "Climb-over": useObstacle });
  api.onObjectInteraction("Rope swing", { "Swing-on": useObstacle });
  api.onObjectInteraction("Plank", { "Walk-on": useObstacle });
  api.onObjectInteraction("Pillar", { "Jump-on": useObstacle });
  api.onObjectInteraction("Hand holds", { "Climb-across": useObstacle });
  api.onObjectRoute(routeToObstacle);
};

module.exports.useObstacle = useObstacle;
module.exports.routeToObstacle = routeToObstacle;
module.exports.crossingTarget = crossingTarget;
module.exports.ropeSwingSteps = ropeSwingSteps;
module.exports.familyAt = familyAt;
module.exports.obstacleXp = obstacleXp;
module.exports.lineAt = lineAt;
module.exports.crossing = crossing;
module.exports.crossingSteps = crossingSteps;
module.exports.advancePlanks = advancePlanks;
module.exports.plankFailureSteps = plankFailureSteps;
module.exports.LINES = LINES;
