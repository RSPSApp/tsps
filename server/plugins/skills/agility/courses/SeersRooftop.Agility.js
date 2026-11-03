const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../Constants.Agility");
const { leap, balance } = require("../Steps.Agility");

/**
 * Seers' Village Rooftop. No rsprox capture exists (searched every obstacle loc id, the lap count
 * line); the movement is a guess from the cache's locs. XP per obstacle is the Wiki's (course and
 * Gap pages agree), adding up to the 570 lap with no bonus.
 */
module.exports = {
  key: "seers",
  name: "Seers' Village Rooftop",
  helper: 15, // the Agility helper's course (enum 3507: "Seers' Village Rooftops")
  lapXp: 570,
  petBase: 35205, // Giant squirrel base chance (Wiki)
  // Kandarin Diary hard: "Complete a lap of the Seers' Village agility course."
  diaryTask: {
    diary: "kandarin",
    task: "complete-a-lap-of-the-seers-village-agility-cour",
  },
  // The Kandarin diary rerolls a miss: 5%, 10% or 15% for its easy, medium or hard tier (Wiki: Mark of Grace).
  marks: {
    level: 60,
    rerolls: [
      { diary: "kandarin", tier: "hard", chance: 0.15 },
      { diary: "kandarin", tier: "medium", chance: 0.1 },
      { diary: "kandarin", tier: "easy", chance: 0.05 },
    ],
    // The Wiki's spawn map (Template:Mark of grace spawns); planes from the roofs' obstacles.
    tiles: [[2727, 3498, 3], [2707, 3493, 2], [2710, 3493, 2], [2712, 3481, 2], [2698, 3465, 2]],
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
      xp: 35,
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
      xp: 15,
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
