const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../constants");
const { ShortcutAnim, between, climbOver, hops, crevice, crawlDown, crawlUp } = require("./builders");

/** Lighthouse basalt rocks: each tile jumps to its pair across the water. */
const BASALT_JUMPS = [
  [[2522, 3597], [2522, 3595]],
  [[2522, 3600], [2522, 3602]],
  [[2518, 3611], [2516, 3611]],
  [[2514, 3613], [2514, 3615]],
  [[2514, 3617], [2514, 3619]],
];

const BASALT_OBJECTS = [
  ObjectIds.BEACH,
  ObjectIds.BASALT_ROCK,
  ObjectIds.BASALT_ROCK_2,
  ObjectIds.BASALT_ROCK_3,
  ObjectIds.BASALT_ROCK_4,
  ObjectIds.BASALT_ROCK_5,
  ObjectIds.BASALT_ROCK_6,
  ObjectIds.BASALT_ROCK_7,
  ObjectIds.BASALT_ROCK_8,
  ObjectIds.ROCKY_SHORE,
];

function tileDistance(a, x, y) {
  return Math.max(Math.abs(a[0] - x), Math.abs(a[1] - y));
}

/** The basalt jump whose take-off tile is nearest the clicked rock, from the player's side. */
function basaltJump({ obj, pos }) {
  const candidates = BASALT_JUMPS.flatMap(([a, b]) => [[a, b], [b, a]]);
  candidates.sort((left, right) =>
    tileDistance(left[1], obj.x, obj.y) + tileDistance(left[0], pos.x, pos.y) * 0.1
    - (tileDistance(right[1], obj.x, obj.y) + tileDistance(right[0], pos.x, pos.y) * 0.1));
  return candidates[0];
}

/** Troll Stronghold area rock scrambles: a pair of tiles either side of a rock tile. */
function trollRocks(object, at, ends, level, xp = 0) {
  return between({
    object,
    at,
    level,
    xp,
    ends,
    cross: (from, to) => [{ move: to, anim: Anim.CLIMB_ROCKS, speed: [0, 60] }, { anim: -1 }],
  });
}

/** Low rocks the player steps over on the paths to Trollheim. */
function rockStep({ pos, obj }) {
  const alongY = [[2888, 3660], [2856, 3611], [2834, 3628]]
    .some(([x, y]) => Math.max(Math.abs(obj.x - x), Math.abs(obj.y - y)) <= 3);
  const destination = alongY
    ? [obj.x, obj.y + (pos.y > obj.y ? -1 : 1)]
    : [obj.x + (pos.x > obj.x ? -1 : 1), obj.y];
  return [climbOver(destination)];
}

module.exports = [
  {
    // Rellekka: the broken fence into the town from the west.
    object: ObjectIds.BROKEN_FENCE,
    level: 57,
    xp: 0,
    end: "You climb over the fence.",
    precondition: ({ pos }) => (pos.x >= 2691 ? "You can't climb the fence from this side." : null),
    steps: ({ obj }) => [climbOver([obj.x + 2, obj.y])],
  },
  {
    // Rellekka: the broken bridge to the Fremennik Slayer Dungeon side.
    object: [ObjectIds.BROKEN_BRIDGE, ObjectIds.BROKEN_BRIDGE_2],
    level: 1,
    xp: 0,
    route: ({ obj }) => [obj.x, obj.y, obj.z],
    steps: ({ pos }) => {
      const fromEast = pos.x === 2598 && pos.y === 3608;
      const dx = fromEast ? -1 : 1;
      return [
        fromEast ? null : { anim: Anim.LEDGE_TURN, delay: 10 },
        { wait: 1 },
        { render: fromEast ? Anim.LEDGE_WALK_BACK : Anim.LEDGE_WALK },
        { walk: [[pos.x + dx * 2, pos.y]] },
        { render: null },
        fromEast ? { anim: ShortcutAnim.LEDGE_FINISH } : null,
        { walk: [[pos.x + dx * 3, pos.y]] },
      ];
    },
  },
  {
    // Neitiznot: the rope bridges to the yak field and back.
    object: [
      ObjectIds.ROPE_BRIDGE_2, ObjectIds.ROPE_BRIDGE_3, ObjectIds.ROPE_BRIDGE_4, ObjectIds.ROPE_BRIDGE_5,
      ObjectIds.ROPE_BRIDGE_6, ObjectIds.ROPE_BRIDGE_7, ObjectIds.ROPE_BRIDGE_8, ObjectIds.ROPE_BRIDGE_9,
      ObjectIds.ROPE_BRIDGE_10, ObjectIds.ROPE_BRIDGE_11,
    ],
    level: 40,
    xp: 0,
    render: Anim.BALANCE_WALK,
    steps: ({ pos, obj }) => [{ walk: [[pos.x, pos.y + (pos.y > obj.y ? -9 : 9)]] }],
  },
  between({
    object: ObjectIds.STEPPING_STONE_6,
    level: 55,
    ends: [[2573, 3859, 0], [2575, 3861, 0]],
    cross: (from, to, { obj }) => hops([obj.x, obj.y], to),
  }),
  {
    object: BASALT_OBJECTS,
    level: 1,
    xp: 0,
    precondition: ({ obj, pos }) => {
      if (obj.id === ObjectIds.BEACH && pos.y <= 3595) return "You're already at the beach.";
      if (obj.id === ObjectIds.ROCKY_SHORE && pos.y >= 3619) return "You're already at the shore.";
      return null;
    },
    route: (context) => [...basaltJump(context)[0], 0],
    steps: (context) => [{ move: basaltJump(context)[1], anim: Anim.FAIL_JUMP, speed: [15, 35] }],
  },
  between({
    object: ObjectIds.CREVICE_17,
    level: 62,
    ends: [[2730, 10008, 0], [2735, 10008, 0]],
    end: "You climb your way through the narrow crevice.",
    cross: (from, to) => (to[0] > from[0]
      ? crevice([2731, 10008], [2734, 10008], to)
      : crevice([2734, 10008], [2731, 10008], to)),
  }),
  {
    // Fremennik Slayer Dungeon: leap the strange floor to the pyrefiends.
    object: ObjectIds.STRANGE_FLOOR_2,
    level: 81,
    xp: 5,
    route: ({ pos, obj }) => {
      const westCrack = obj.x === 2769 && obj.y === 10002;
      if (pos.x < obj.x) return westCrack ? [2766, 10002, 0] : [2771, 10002, 0];
      return westCrack ? [2772, 10002, 0] : [2777, 10003, 0];
    },
    steps: ({ pos, obj }) => {
      const westCrack = obj.x === 2769 && obj.y === 10002;
      const east = pos.x < obj.x;
      const finish = westCrack ? (east ? [2770, 10002] : [2768, 10002]) : (east ? [2775, 10003] : [2773, 10003]);
      return [
        { face: [obj.x, obj.y] },
        { move: [obj.x, obj.y], anim: Anim.RUN_UP, speed: [0, 60] },
        { anim: Anim.JUMP_HURDLE },
        { wait: 1 },
        { move: finish, speed: [0, 15] },
      ];
    },
  },
  between({
    object: ObjectIds.LITTLE_BOULDER,
    level: 1,
    ends: [[2850, 3936, 0], [2852, 3936, 0]],
    end: "You climb over the rocks.",
    cross: (from, to) => [climbOver(to)],
  }),
  {
    // Death Plateau: the rocks between the plateau and the path.
    object: [ObjectIds.ROCKS_10, ObjectIds.ROCKS_11],
    level: 1,
    xp: 0,
    steps: ({ pos, obj }) => [
      { move: [pos.x, obj.id === ObjectIds.ROCKS_10 ? 3593 : 3596], anim: Anim.CLIMB_ROCKS, speed: [0, 90], ticks: 2 },
      { anim: -1 },
    ],
  },
  {
    object: [ObjectIds.ROCKS_13, ObjectIds.ROCKS_14],
    level: 1,
    xp: 0,
    steps: ({ pos, obj }) => {
      const east = pos.x >= 2862;
      const step = (east ? obj.id === ObjectIds.ROCKS_14 : obj.id === ObjectIds.ROCKS_13) ? 3 : -3;
      return [{ move: [pos.x + step, pos.y], anim: Anim.CLIMB_ROCKS, speed: [0, 60] }, { anim: -1 }];
    },
  },
  {
    // Troll Stronghold: the long climb down from the stronghold towards the lower path.
    object: ObjectIds.ROCKS_71,
    at: [2843, 3693, 0],
    level: 73,
    xp: 0,
    route: [2844, 3693, 0],
    steps: crawlUp([2843, 3693], [2839, 3693], [2838, 3693]),
  },
  {
    object: ObjectIds.ROCKS_71,
    level: 73,
    xp: 0,
    steps: crawlDown([2837, 3693], [2844, 3693], "west"),
  },
  {
    object: [ObjectIds.ROCKS_15, ObjectIds.ROCKS_16, ObjectIds.ROCKS_12, ObjectIds.ROCKS_76],
    level: ({ obj }) => (obj.id === ObjectIds.ROCKS_12 || obj.id === ObjectIds.ROCKS_76 ? 44 : 43),
    xp: 0,
    end: "You climb over the rocks.",
    steps: rockStep,
  },
  {
    object: [ObjectIds.ROCKY_HANDHOLDS_3, ObjectIds.ROCKY_HANDHOLDS_4, ObjectIds.ROCKY_HANDHOLDS_5],
    level: 60,
    xp: 0,
    route: ({ obj }) => (obj.y >= 3760 ? [2928, 3760, 0] : [obj.x, obj.y, obj.z]),
    end: "You climb over the rocks.",
    steps: ({ pos, obj }) => [climbOver(obj.y >= 3760 ? [2928, 3757] : [obj.x, obj.y + (pos.y > obj.y ? -2 : 2)])],
  },
  trollRocks([ObjectIds.ROCKS_74, ObjectIds.ROCKS_75, ObjectIds.ROCKS_77], [2871, 3671, 0], [[2869, 3671, 0], [2872, 3671, 0]], 41),
  trollRocks([ObjectIds.ROCKS_74, ObjectIds.ROCKS_75, ObjectIds.ROCKS_77], [2870, 3671, 0], [[2869, 3671, 0], [2872, 3671, 0]], 41),
  trollRocks([ObjectIds.ROCKS_74, ObjectIds.ROCKS_75, ObjectIds.ROCKS_77], [2878, 3667, 0], [[2878, 3665, 0], [2878, 3668, 0]], 43),
  trollRocks([ObjectIds.ROCKS_74, ObjectIds.ROCKS_75, ObjectIds.ROCKS_77], [2878, 3666, 0], [[2878, 3665, 0], [2878, 3668, 0]], 43),
  trollRocks([ObjectIds.ROCKS_74, ObjectIds.ROCKS_75, ObjectIds.ROCKS_77], [2901, 3680, 0], [[2900, 3680, 0], [2903, 3680, 0]], 47, 8),
  trollRocks([ObjectIds.ROCKS_74, ObjectIds.ROCKS_75, ObjectIds.ROCKS_77], [2902, 3680, 0], [[2900, 3680, 0], [2903, 3680, 0]], 47, 8),
  between({
    object: ObjectIds.STILE_2,
    level: 1,
    ends: [[2817, 3561, 0], [2817, 3564, 0]],
    end: "You climb over the stile.",
    cross: (from, to) => [climbOver(to)],
  }),
  trollRocks(ObjectIds.ROCKS_80, [2917, 3672, 0], [[2915, 3672, 0], [2918, 3672, 0]], 64),
  trollRocks(ObjectIds.ROCKS_80, [2916, 3672, 0], [[2915, 3672, 0], [2918, 3672, 0]], 64),
  trollRocks(ObjectIds.ROCKS_80, [2922, 3672, 0], [[2921, 3672, 0], [2924, 3673, 0]], 64),
  trollRocks(ObjectIds.ROCKS_80, [2923, 3673, 0], [[2921, 3672, 0], [2924, 3673, 0]], 64),
  {
    object: ObjectIds.ROCKS_80,
    at: [2947, 3678, 0],
    level: 64,
    xp: 0,
    steps: [
      { move: [2949, 3679], anim: Anim.CLIMB_ROCKS, speed: [0, 60] },
      { move: [2949, 3681], anim: Anim.CLIMB_ROCKS, speed: [0, 30] },
      { anim: -1 },
    ],
  },
  trollRocks(ObjectIds.ROCKS_80, [2948, 3679, 0], [[2946, 3678, 0], [2949, 3679, 0]], 64),
  {
    object: ObjectIds.ROCKS_80,
    at: [2949, 3680, 0],
    level: 64,
    xp: 0,
    precondition: () => "You can't go up that way!",
    steps: [],
  },
  {
    object: [ObjectIds.ROCKY_HANDHOLDS_7, ObjectIds.ROCKY_HANDHOLDS_8],
    level: 60,
    xp: 0,
    steps: [{ move: [2950, 3767], anim: Anim.CLIMB_ROCKS, speed: [0, 210], ticks: 6, dir: "west" }, { anim: -1 }],
  },
  {
    object: ObjectIds.ROCKY_HANDHOLDS_6,
    level: 60,
    xp: 0,
    precondition: () => "You can't go up that way!",
    steps: [],
  },
  {
    // Mountain Camp: climb over the rockslide.
    object: ObjectIds.ROCKSLIDE_2,
    level: 1,
    xp: 0,
    end: "You climb over the rockslide.",
    steps: ({ pos, obj }) => [climbOver([pos.x, pos.y < obj.y ? 3660 : 3657])],
  },
];
