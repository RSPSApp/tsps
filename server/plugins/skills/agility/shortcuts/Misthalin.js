const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../constants");
const { ShortcutAnim, between, stile, hops, pipe, tunnel, climbOver } = require("./builders");

/**
 * Wall holes the player ducks through: each pair of hole tiles and the tiles either
 * side. The Piscatoris colony tunnel shares the object.
 */
const HOLES = [
  { holes: [[2344, 3651], [2344, 3654]], ends: [[2344, 3650, 0], [2344, 3655, 0]] },
  { holes: [[3050, 3506], [3050, 3510]], ends: [[3050, 3505, 0], [3050, 3511, 0]] },
  { holes: [[3132, 3470], [3136, 3470]], ends: [[3131, 3470, 0], [3137, 3470, 0]] },
  { holes: [[3108, 3425], [3108, 3429]], ends: [[3108, 3424, 0], [3108, 3430, 0]] },
  { holes: [[3042, 3444], [3046, 3444]], ends: [[3041, 3444, 0], [3047, 3444, 0]] },
  { holes: [[3004, 3447], [3004, 3451]], ends: [[3004, 3446, 0], [3004, 3452, 0]] },
  { holes: [[2983, 3496], [2987, 3496]], ends: [[2982, 3496, 0], [2988, 3496, 0]] },
];

const DRAYNOR_STEPPING_STONES = [[3150, 3363, 0], [3151, 3363, 0], [3152, 3363, 0], [3153, 3363, 0]];

/** Lumbridge Swamp Caves stepping stones: 4 tiles across, starting from the side the player is on. */
function swampCaveStones(object, start, axis) {
  return between({
    object,
    level: 1,
    ends: [start, axis === "x" ? [start[0] - 4, start[1], start[2]] : [start[0], start[1] - 4, start[2]]],
    cross: (from, to, { obj }) => hops([obj.x, obj.y], to),
  });
}

module.exports = [
  ...HOLES.map(({ holes, ends }) => between({
    object: ObjectIds.HOLE_14,
    at: [...holes[0], 0],
    level: 1,
    ends,
    cross: (from, to) => tunnel(to),
  })),
  ...HOLES.map(({ holes, ends }) => between({
    object: ObjectIds.HOLE_14,
    at: [...holes[1], 0],
    level: 1,
    ends,
    cross: (from, to) => tunnel(to),
  })),
  {
    // Lumbridge castle basement: crawl through the hole.
    object: ObjectIds.HOLE_9,
    level: 1,
    xp: 0,
    steps: ({ pos, obj }) => {
      const north = pos.y <= obj.y;
      return [{ move: [obj.x, north ? obj.y + 3 : obj.y - 1], anim: Anim.SQUEEZE_PIPE, speed: [0, 90], ticks: 2 }];
    },
  },
  stile({ object: ObjectIds.STILE_4, level: 1, axis: "y" }),
  stile({ object: ObjectIds.BROKEN_FENCE_2, level: 1, axis: "y", end: "You climb over the broken fence." }),
  between({
    object: ObjectIds.STEPPING_STONE_14,
    level: 66,
    ends: [[3212, 3137, 0], [3214, 3132, 0]],
    cross: (from, to, { obj }) => hops([obj.x, obj.y], to),
  }),
  swampCaveStones(ObjectIds.STEPPING_STONE_3, [3221, 9556, 0], "y"),
  swampCaveStones(ObjectIds.STEPPING_STONE_2, [3208, 9572, 0], "x"),
  between({
    // Draynor Manor's stile runs east-west, the Falador road stile north-south.
    object: ObjectIds.STILE_3,
    level: 1,
    end: "You climb over the stile.",
    ends: ({ obj }) => (obj.x === 3043
      ? [[obj.x - 1, obj.y, obj.z], [obj.x + 2, obj.y, obj.z]]
      : [[obj.x, obj.y - 1, obj.z], [obj.x, obj.y + 2, obj.z]]),
    cross: (from, to) => [climbOver(to)],
  }),
  between({
    object: [ObjectIds.UNDERWALL_TUNNEL_5, ObjectIds.UNDERWALL_TUNNEL_6],
    level: 42,
    ends: [[3065, 3260, 0], [3070, 3260, 0]],
    cross: (from, to) => tunnel(to),
  }),
  {
    // Draynor stepping stones across the River Lum, one stone per click.
    object: ObjectIds.STEPPING_STONE_15,
    level: 31,
    xp: 3,
    start: "You attempt to balance on the stepping stone.",
    end: "You manage to make the jump.",
    steps: ({ pos, obj }) => {
      const steps = hops([obj.x, obj.y]);
      const west = obj.x < pos.x;
      const lastStone = DRAYNOR_STEPPING_STONES[west ? 0 : DRAYNOR_STEPPING_STONES.length - 1];
      if (obj.x === lastStone[0] && obj.y === lastStone[1]) {
        steps.push({ wait: 1 }, { walk: [[west ? 3149 : 3154, 3363]] });
      }
      return steps;
    },
  },
  between({
    object: ObjectIds.FENCE_3,
    level: 13,
    ends: [[3240, 3338, 0], [3240, 3331, 0]],
    cross: (from, to) => {
      const north = from[1] > to[1];
      const near = [3240, north ? 3335 : 3334];
      const far = [3240, north ? 3334 : 3335];
      return [
        { face: near },
        { move: near, anim: Anim.RUN_UP, speed: [0, 60] },
        { anim: Anim.JUMP_HURDLE },
        { wait: 1 },
        { move: far, speed: [0, 15] },
      ];
    },
  }),
  {
    // Grand Exchange underwall tunnel: each side's tunnel leads through to the other.
    object: ObjectIds.UNDERWALL_TUNNEL_3,
    level: 21,
    xp: 0,
    steps: [
      { move: [3138, 3516], anim: ShortcutAnim.DUCK, speed: [0, 60] },
      { move: [3141, 3513], anim: ShortcutAnim.INVISIBLE, speed: [0, 120], ticks: 4 },
      { move: [3142, 3513], anim: ShortcutAnim.EMERGE, speed: [0, 60], ticks: 2 },
    ],
  },
  {
    object: ObjectIds.UNDERWALL_TUNNEL_4,
    level: 21,
    xp: 0,
    steps: [
      { move: [3141, 3513], anim: ShortcutAnim.DUCK, speed: [0, 60] },
      { move: [3138, 3516], anim: ShortcutAnim.INVISIBLE, speed: [0, 120], ticks: 4 },
      { move: [3137, 3516], anim: ShortcutAnim.EMERGE, speed: [0, 60], ticks: 2 },
    ],
  },
  {
    // Edgeville Dungeon monkey bars, north <-> south.
    object: ObjectIds.MONKEYBARS_5,
    level: 15,
    xp: 20,
    route: ({ obj }) => [obj.x + 1, obj.y, obj.z],
    steps: ({ obj }) => [
      { anim: Anim.MONKEY_BARS_JUMP },
      { render: Anim.MONKEY_BARS_CROSS },
      { walk: [[obj.x + 1, obj.y === 9964 ? 9969 : 9964]] },
      { render: null },
      { anim: Anim.MONKEY_BARS_DROP },
    ],
  },
  between({
    object: ObjectIds.OBSTACLE_PIPE_6,
    level: 51,
    ends: [[3149, 9906, 0], [3155, 9906, 0]],
    cross: (from, to) => pipe([3152, 9906], to),
  }),
  {
    // Zanaris jutting walls: shimmy past the wall to the other side.
    object: ObjectIds.JUTTING_WALL_2,
    level: ({ obj }) => (obj.x >= 2408 ? 66 : 46),
    xp: 0,
    steps: ({ pos, obj }) => {
      const pivot = obj.x >= 2408 ? 4401 : 4403;
      const southward = pos.y >= pivot;
      return [
        {
          move: [obj.x, southward ? obj.y - 1 : obj.y + 1],
          anim: southward ? ShortcutAnim.JUTTING_WALL_LEFT : ShortcutAnim.JUTTING_WALL_RIGHT,
          speed: [0, 120],
          ticks: 4,
        },
      ];
    },
  },
];

