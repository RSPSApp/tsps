const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../constants");
const { balance } = require("../steps");

function runningLeap(object, index, landing, xp) {
  return {
    object,
    index,
    level: 80,
    xp,
    steps: ({ obj }) => [
      { face: [obj.x, obj.y] },
      { wait: 1 },
      { anim: Anim.RUN_UP, delay: 15 },
      { wait: 1 },
      { move: landing, anim: Anim.JUMP_HURDLE, speed: [8, 50], ticks: 2 },
    ],
  };
}

module.exports = {
  key: "rellekka",
  name: "Rellekka Rooftop",
  lapXp: 780,
  petBase: 31063, // Giant squirrel base chance (Wiki)
  marks: {
    level: 80,
    tiles: [
      [2622, 3676, 3], [2617, 3664, 3], [2618, 3660, 3], [2628, 3652, 3], [2628, 3655, 3], [2641, 3649, 3],
      [2643, 3651, 3], [2649, 3659, 3], [2644, 3662, 3], [2658, 3674, 3], [2656, 3681, 3],
    ],
  },
  obstacles: [
    {
      object: ObjectIds.ROUGH_WALL_6,
      index: 1,
      level: 80,
      xp: 20,
      steps: [{ anim: Anim.CLIMB_UP, delay: 15 }, { wait: 2 }, { tele: [2626, 3676, 3] }, { anim: -1 }],
    },
    runningLeap(ObjectIds.GAP_31, 2, [2622, 3668, 3], 30),
    {
      object: ObjectIds.TIGHTROPE_10,
      index: 3,
      level: 80,
      xp: 40,
      render: Anim.BALANCE_WALK,
      steps: balance([2626, 3654]),
    },
    {
      object: ObjectIds.GAP_32,
      index: 4,
      level: 80,
      xp: 85,
      steps: ({ obj, pos }) => [
        { face: [obj.x, obj.y] },
        { wait: 1 },
        { move: [pos.x, pos.y + 3], speed: [0, 30], dir: "north" },
        { anim: Anim.LEDGE_STEP_OFF },
        { render: Anim.LEDGE_WALK_BACK },
        { walk: [[2635, 3658]] },
        { render: Anim.BALANCE_WALK },
        { walk: [[2640, 3653]] },
      ],
    },
    runningLeap(ObjectIds.GAP_33, 5, [2643, 3656, 3], 25),
    {
      object: ObjectIds.TIGHTROPE_11,
      index: 6,
      level: 80,
      xp: 105,
      render: Anim.BALANCE_WALK,
      steps: balance([2647, 3663], [2654, 3670]),
    },
    {
      object: ObjectIds.PILE_OF_FISH,
      index: 7,
      level: 80,
      xp: 475,
      steps: ({ obj }) => [
        { face: [obj.x, obj.y] },
        { wait: 1 },
        { anim: Anim.LEAP, delay: 15 },
        { wait: 1 },
        { tele: [2653, 3676, 0] },
        { anim: Anim.LAND },
        { wait: 1 },
        { walk: [[2652, 3676]] },
      ],
    },
  ],
};
