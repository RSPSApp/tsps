const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../constants");
const { leap, balance } = require("../steps");

module.exports = {
  key: "seers",
  name: "Seers' Village Rooftop",
  lapXp: 570,
  petBase: 35205, // Giant squirrel base chance (Wiki)
  marks: {
    level: 60,
    tiles: [[2725, 3494, 3], [2708, 3492, 2], [2712, 3478, 2], [2702, 3473, 3], [2699, 3462, 2]],
  },
  obstacles: [
    {
      object: ObjectIds.WALL_15,
      index: 1,
      level: 60,
      xp: 45,
      start: "You climb up the wall...",
      steps: [
        { anim: Anim.CLIMB_WALL },
        { wait: 1 },
        { tele: [2729, 3488, 1] },
        { anim: Anim.HANG },
        { msg: "...jump, and grab hold of the sign!" },
        { wait: 2 },
        { anim: -1 },
        { tele: [2729, 3491, 3] },
      ],
    },
    {
      object: ObjectIds.GAP_27,
      index: 2,
      level: 60,
      xp: 20,
      route: [2721, 3494, 3],
      steps: [
        ...leap([2719, 3495, 2]),
        { wait: 1 },
        ...leap([2713, 3494, 2]),
      ],
    },
    {
      object: ObjectIds.TIGHTROPE_9,
      index: 3,
      level: 60,
      xp: 20,
      route: [2710, 3490, 2],
      render: Anim.BALANCE_WALK,
      steps: balance([2710, 3489], [2710, 3481]),
    },
    {
      object: ObjectIds.GAP_28,
      index: 4,
      level: 60,
      xp: 20,
      steps: ({ pos }) => [
        { face: [pos.x, pos.y - 3] },
        { anim: Anim.LEAP },
        { wait: 1 },
        { tele: [pos.x, pos.y - 3, 3] },
        { anim: Anim.GRAB_LEDGE },
        { wait: 2 },
        { tele: [pos.x, pos.y - 4, 3] },
      ],
    },
    {
      object: ObjectIds.GAP_29,
      index: 5,
      level: 60,
      xp: 25,
      steps: ({ pos }) => leap([2701, 3465, 2], { face: [pos.x, pos.y - 1] }),
    },
    {
      object: ObjectIds.EDGE_3,
      index: 6,
      level: 60,
      xp: 435,
      steps: leap([2704, 3464, 0], { face: [2704, 3464] }),
    },
  ],
};
