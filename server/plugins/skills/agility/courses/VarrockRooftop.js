const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../constants");
const { leap, faceLoc } = require("../steps");

/** Tiles the player hangs from while shimmying along the wall (obstacle 4). */
const WALL_HOLDS = [[3190, 3414], [3190, 3413], [3190, 3412], [3190, 3411], [3190, 3410]];

function shimmyAlongWall() {
  const steps = [
    { face: [3193, 3416] },
    { move: [3193, 3416], anim: Anim.RUN_UP, speed: [0, 30], dir: "west" },
    { wait: 1 },
    { move: WALL_HOLDS[0], anim: Anim.JUMP, speed: [15, 35], dir: "west" },
    { anim: Anim.HANG_SWING },
  ];
  for (const hold of WALL_HOLDS.slice(1)) {
    steps.push({ wait: 1 }, { move: hold, speed: [10, 20], dir: "west" }, { anim: Anim.HANG_SWING });
  }
  steps.push(
    { wait: 1 },
    { move: [3190, 3409], anim: Anim.HANG_SWING_QUICK, speed: [15, 35], dir: "west" },
    { wait: 1 },
    { anim: Anim.LEDGE_TURN },
    { render: Anim.LEDGE_WALK },
    { walk: [[3190, 3407]] },
    { render: null },
    { face: [3192, 3406] },
    { move: [3192, 3406, 3], anim: Anim.JUMP, speed: [15, 35], dir: "east" },
  );
  return steps;
}

module.exports = {
  key: "varrock",
  name: "Varrock Rooftop",
  lapXp: 270,
  petBase: 24410, // Giant squirrel base chance (Wiki)
  marks: {
    level: 30,
    tiles: [[3215, 3410, 3], [3195, 3416, 1], [3193, 3395, 3], [3222, 3402, 3], [3237, 3406, 3]],
  },
  obstacles: [
    {
      object: ObjectIds.ROUGH_WALL_3,
      index: 1,
      level: 30,
      xp: 12,
      steps: (context) => [
        faceLoc(context.obj),
        { anim: Anim.CLIMB_UP },
        { wait: 1 },
        { tele: [3220, 3414, 3] },
        { move: [3219, 3414], anim: Anim.GRAB_LEDGE, speed: [0, 45], dir: "west" },
      ],
    },
    {
      object: ObjectIds.CLOTHES_LINE,
      index: 2,
      level: 30,
      xp: 21,
      steps: [
        { move: [3212, 3414], anim: Anim.JUMP, speed: [15, 35], dir: "west" },
        { wait: 1 },
        { move: [3210, 3414], anim: Anim.JUMP, speed: [15, 35], dir: "west" },
        { wait: 1 },
        { move: [3208, 3414], anim: Anim.JUMP, speed: [15, 35], dir: "west" },
      ],
    },
    {
      object: ObjectIds.GAP_5,
      index: 3,
      level: 30,
      xp: 17,
      route: [3201, 3416, 3],
      steps: leap([3197, 3416, 1], { face: [3197, 3416], land: null }),
    },
    {
      object: ObjectIds.WALL_14,
      index: 4,
      level: 30,
      xp: 25,
      route: [3194, 3416, 1],
      steps: shimmyAlongWall,
    },
    {
      object: ObjectIds.GAP_6,
      index: 5,
      level: 30,
      xp: 9,
      steps: ({ pos }) => [
        { face: [pos.x, pos.y - 3] },
        { wait: 1 },
        { move: [pos.x, pos.y - 3, 3], anim: Anim.JUMP, speed: [0, 60], dir: "south" },
        { anim: Anim.GRAB_LEDGE },
        { move: [pos.x, pos.y - 4, 3], speed: [0, 30], dir: "south" },
      ],
    },
    {
      object: ObjectIds.GAP_7,
      index: 6,
      level: 30,
      xp: 22,
      steps: [
        { face: [3215, 3399] },
        { anim: Anim.RUN_UP },
        { wait: 1 },
        { move: [3215, 3399], anim: Anim.TABLE_LEAP, speed: [0, 45], dir: 1446 },
        { move: [3217, 3399], speed: [15, 35], dir: "east" },
        { anim: Anim.GRAB_LEDGE },
        { wait: 1 },
        { move: [3218, 3399], speed: [0, 30], dir: "east" },
      ],
    },
    {
      object: ObjectIds.GAP_8,
      index: 7,
      level: 30,
      xp: 4,
      route: [3232, 3402, 3],
      steps: leap([3236, 3403, 3], { face: [3236, 3403], land: null }),
    },
    {
      object: ObjectIds.LEDGE,
      index: 8,
      level: 30,
      xp: 3,
      steps: ({ pos }) => [
        { move: [pos.x, pos.y + 2, 3], anim: Anim.JUMP_HURDLE, speed: [15, 35], dir: "north" },
      ],
    },
    {
      object: ObjectIds.EDGE,
      index: 9,
      level: 30,
      xp: 125,
      steps: ({ pos }) => [
        { move: [pos.x, pos.y + 1, 3], anim: Anim.JUMP, speed: [15, 35], dir: "north" },
        { anim: Anim.LEAP },
        { wait: 1 },
        { tele: [pos.x, pos.y + 2, 0] },
      ],
    },
  ],
};
