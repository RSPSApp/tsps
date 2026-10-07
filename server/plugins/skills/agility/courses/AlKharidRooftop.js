const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../constants");
const { climb, leap, balance } = require("../steps");

module.exports = {
  key: "alkharid",
  name: "Al Kharid Rooftop",
  lapXp: 216,
  petBase: 26648, // Giant squirrel base chance (Wiki)
  marks: {
    level: 20,
    tiles: [[3275, 3186, 3], [3267, 3170, 3], [3290, 3162, 3], [3317, 3161, 1], [3317, 3177, 2], [3303, 3189, 3]],
  },
  obstacles: [
    {
      object: ObjectIds.ROUGH_WALL_2,
      index: 1,
      level: 20,
      xp: 10,
      steps: climb([3273, 3192, 3]),
    },
    {
      object: ObjectIds.TIGHTROPE_3,
      index: 2,
      level: 20,
      xp: 30,
      route: [3272, 3182, 3],
      render: Anim.BALANCE_WALK,
      steps: balance([3272, 3181], [3272, 3172]),
    },
    {
      object: ObjectIds.CABLE,
      index: 3,
      level: 20,
      xp: 40,
      route: [3266, 3166, 3],
      steps: [
        { faceDir: "east" },
        { wait: 1 },
        { msg: "You begin an almighty run-up..." },
        { move: [3269, 3166], anim: Anim.RUN_UP, speed: [0, 30], dir: "east" },
        { msg: "You gained enough momentum to swing to the other side!" },
        { move: [3284, 3166], anim: Anim.ROPE_SWING, speed: [0, 60], ticks: 2, dir: "east" },
      ],
    },
    {
      object: ObjectIds.ZIP_LINE,
      index: 4,
      level: 20,
      xp: 40,
      route: [3301, 3163, 3],
      steps: [
        { anim: Anim.LEAP, delay: 10 },
        { wait: 1 },
        { tele: [3303, 3163, 1] },
        { anim: Anim.ZIPLINE_GRIP },
        { wait: 1 },
        { move: [3314, 3163], anim: Anim.ZIPLINE_SLIDE, speed: [0, 150], ticks: 5, dir: "east" },
        { anim: -1 },
        { walk: [[3315, 3163]] },
      ],
    },
    {
      object: ObjectIds.TROPICAL_TREE_27,
      index: 5,
      level: 20,
      xp: 10,
      route: [3318, 3165, 1],
      steps: [
        { move: [3318, 3170], speed: [30, 60], ticks: 2, dir: "north" },
        { face: [3320, 3170] },
        { anim: Anim.HANG_SWING },
        { wait: 1 },
        { move: [3317, 3174, 2], anim: Anim.HANG_SWING_QUICK, speed: [15, 35], dir: "north" },
        { anim: Anim.LAND },
      ],
    },
    {
      object: ObjectIds.ROOF_TOP_BEAMS,
      index: 6,
      level: 20,
      xp: 5,
      steps: climb([3316, 3180, 3]),
    },
    {
      object: ObjectIds.TIGHTROPE_4,
      index: 7,
      level: 20,
      xp: 15,
      route: [3314, 3186, 3],
      render: Anim.BALANCE_WALK,
      steps: balance([3313, 3186], [3302, 3186]),
    },
    {
      object: ObjectIds.GAP_4,
      index: 8,
      level: 20,
      xp: 30,
      route: [3300, 3192, 3],
      steps: leap([3299, 3194, 0]),
    },
  ],
};
