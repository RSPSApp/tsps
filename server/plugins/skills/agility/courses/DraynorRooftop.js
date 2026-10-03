const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../constants");
const { climb, leap, balance } = require("../steps");

module.exports = {
  key: "draynor",
  name: "Draynor Village Rooftop",
  lapXp: 120,
  petBase: 33005, // Giant squirrel base chance (Wiki)
  marks: {
    level: 10,
    tiles: [[3101, 3278, 3], [3091, 3275, 3], [3093, 3266, 3], [3098, 3259, 3]],
  },
  obstacles: [
    {
      object: ObjectIds.ROUGH_WALL,
      index: 1,
      level: 10,
      xp: 5,
      steps: climb([3102, 3279, 3]),
    },
    {
      object: ObjectIds.TIGHTROPE,
      index: 2,
      level: 10,
      xp: 8,
      route: [3099, 3277, 3],
      render: Anim.BALANCE_WALK,
      steps: balance([3098, 3277], [3090, 3277]),
    },
    {
      object: ObjectIds.TIGHTROPE_2,
      index: 3,
      level: 10,
      xp: 7,
      route: [3091, 3276, 3],
      render: Anim.BALANCE_WALK,
      steps: balance([3092, 3276], [3092, 3267]),
    },
    {
      object: ObjectIds.NARROW_WALL,
      index: 4,
      level: 10,
      xp: 7,
      route: [3089, 3265, 3],
      render: Anim.LEDGE_WALK,
      steps: [{ anim: Anim.LEDGE_TURN }, { walk: [[3089, 3262], [3088, 3261]] }],
    },
    {
      object: ObjectIds.WALL_13,
      index: 5,
      level: 10,
      xp: 10,
      route: [3088, 3257, 3],
      steps: [
        { move: [3088, 3256], anim: Anim.JUMP_SHORT, speed: [0, 35], dir: "south" },
        { anim: Anim.GRAB_LEDGE },
        { wait: 1 },
        { tele: [3088, 3255, 3] },
      ],
    },
    {
      object: ObjectIds.GAP_3,
      index: 6,
      level: 10,
      xp: 4,
      route: [3094, 3255, 3],
      steps: leap([3096, 3256, 3]),
    },
    {
      object: ObjectIds.CRATE_120,
      index: 7,
      level: 10,
      xp: 79,
      route: [3101, 3261, 3],
      steps: [
        ...leap([3102, 3261, 1]),
        { wait: 2 },
        ...leap([3103, 3261, 0]),
      ],
    },
  ],
};
