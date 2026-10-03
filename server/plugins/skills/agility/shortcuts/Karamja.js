const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../constants");
const { between, hops, pipe, ropeSwing } = require("./builders");

/** Brimhaven Dungeon stepping stones between the start and end tiles. */
const BRIMHAVEN_STONES = [[2649, 9561], [2649, 9560], [2648, 9560], [2647, 9560], [2647, 9559], [2647, 9558]];

/**
 * Brimhaven Dungeon's two river crossings near the red dragons: each has a shore,
 * three rocks and the far shore, keyed by the first rock the player clicks.
 */
function brimhavenRiver({ obj }) {
  const north = obj.y > 9531;
  const side = north ? obj.x === 2688 : obj.x === 2695;
  if (north) {
    return side
      ? { start: [2690, 9547, 0], rocks: [[2688, 9547], [2686, 9548], [2684, 9548]], shore: [2682, 9548] }
      : { start: [2682, 9548, 0], rocks: [[2684, 9548], [2686, 9548], [2688, 9547]], shore: [2690, 9547] };
  }
  return side
    ? { start: [2695, 9533, 0], rocks: [[2695, 9531], [2695, 9529], [2696, 9527]], shore: [2697, 9525] }
    : { start: [2697, 9525, 0], rocks: [[2696, 9527], [2695, 9529], [2695, 9531]], shore: [2695, 9533] };
}

module.exports = [
  between({
    object: ObjectIds.PIPE_6,
    level: 1,
    ends: [[2698, 9492, 0], [2698, 9500, 0]],
    cross: (from, to) => pipe([2698, 9496], to),
  }),
  {
    object: [ObjectIds.LOG_BALANCE_18, ObjectIds.LOG_BALANCE_19],
    level: 30,
    xp: 10,
    render: Anim.BALANCE_WALK,
    steps: ({ obj }) => [{ walk: [[obj.id === ObjectIds.LOG_BALANCE_18 ? 2687 : 2682, 9506]] }],
  },
  between({
    object: [ObjectIds.STEPPING_STONE_31, ObjectIds.STEPPING_STONE_32],
    level: 12,
    xp: 7,
    ends: [[2649, 9562, 0], [2647, 9557, 0]],
    cross: (from, to) => {
      const stones = from[1] > to[1] ? BRIMHAVEN_STONES : [...BRIMHAVEN_STONES].reverse();
      return hops(...stones, to);
    },
  }),
  {
    object: ObjectIds.STEPPING_STONE_16,
    level: 83,
    xp: 0,
    route: (context) => brimhavenRiver(context).start,
    steps: (context) => {
      const { rocks, shore } = brimhavenRiver(context);
      return hops(...rocks, shore);
    },
  },
  {
    // Brimhaven Dungeon vines up to (and down from) the upper level.
    object: ObjectIds.VINE_24,
    level: 87,
    xp: 0,
    steps: [{ anim: Anim.CLIMB_UP }, { wait: 1 }, { tele: [2672, 9583, 2] }, { walk: [[2670, 9583]] }],
  },
  {
    object: ObjectIds.VINE_25,
    level: 87,
    xp: 0,
    steps: [{ walk: [[2672, 9583]] }, { anim: Anim.CLIMB_DOWN }, { wait: 1 }, { tele: [2673, 9583, 0] }],
  },
  {
    // Karamja volcano stepping stones: one stone per click.
    object: [ObjectIds.STEPPING_STONES, ObjectIds.STEPPING_STONES_2, ObjectIds.STEPPING_STONES_3],
    level: 30,
    xp: 0,
    steps: ({ obj }) => hops([obj.x, obj.y]),
  },
  {
    // Karamja: climb the vines between the north and south of the island.
    object: [ObjectIds.VINE_22, ObjectIds.VINE_23],
    level: 79,
    xp: 0,
    steps: ({ obj }) => [
      { move: obj.y <= 2938 ? [2899, 2942] : [2899, 2937], anim: Anim.CLIMB_ROCKS, speed: [0, 180], ticks: 5 },
      { anim: -1 },
    ],
  },
  {
    object: ObjectIds.A_WOODEN_LOG,
    level: 1,
    xp: 1,
    render: Anim.BALANCE_WALK,
    steps: ({ obj }) => [{ walk: [[obj.x === 2907 ? 2910 : 2906, 3049]] }],
  },
  between({
    object: ObjectIds.STEPPING_STONE_13,
    level: 77,
    ends: [[2863, 2971, 0], [2863, 2976, 0]],
    cross: (from, to, { obj }) => hops([obj.x, obj.y], to),
  }),
  {
    // Cairn Isle: scramble along the rocks to the island.
    object: ObjectIds.ROCKS_2,
    level: 15,
    xp: 0,
    steps: ({ pos, obj }) => [
      { move: [obj.x <= 2792 ? 2795 : 2791, pos.y], anim: Anim.CLIMB_ROCKS, speed: [0, 120], ticks: 3 },
      { anim: -1 },
    ],
  },
  {
    object: ObjectIds.ROPESWING_7,
    level: 10,
    xp: 8,
    route: [2709, 3209, 0],
    steps: ropeSwing([2704, 3209]),
  },
  {
    object: ObjectIds.ROPESWING_8,
    level: 10,
    xp: 8,
    route: [2705, 3205, 0],
    steps: ropeSwing([2709, 3205]),
  },
];
