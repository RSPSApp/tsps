const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../Constants.Agility");
const { leap, gapJump, wallScramble } = require("../Steps.Agility");

/**
 * Draynor Village Rooftop. Steps, sounds and ticks follow rsprox captures 91, 1718 and 1723
 * (Leagues V, rev 227; no main-game recording), tiles walked from 1723. XP is the Wiki's.
 */
const TIGHTROPE_SOUND = 2495;
const SIDESTEP_SOUND = 2451;

module.exports = {
  key: "draynor",
  name: "Draynor Village Rooftop",
  helper: 3, // the Agility helper's course (enum 3507: "Draynor Village Rooftops")
  lapXp: 120,
  petBase: 33005, // Giant squirrel base chance (Wiki)
  diaryTask: {
    diary: "lumbridge",
    task: "complete-a-lap-of-the-draynor-village-agility-co",
  },
  marks: {
    level: 1,
    // The Wiki's four spots (Mark of grace spawns): the start roof (3098,3281, capture 1723),
    // Diango's workshop, the Slayer shop and Ned's shop (3100,3257, capture 1718). The middle two
    // aren't captured.
    tiles: [[3098, 3281, 3], [3091, 3275, 3], [3093, 3266, 3], [3100, 3257, 3]],
  },
  obstacles: [
    {
      object: ObjectIds.ROUGH_WALL,
      index: 1,
      level: 1,
      xp: 5,
      steps: [{ wait: 1 }, { anim: Anim.CLIMB_UP, delay: 15 }, { wait: 2 }, { tele: [3102, 3279, 3] }],
    },
    {
      object: ObjectIds.TIGHTROPE,
      index: 2,
      level: 1,
      xp: 8,
      route: [3099, 3277, 3],
      render: Anim.BALANCE_WALK,
      // A tile a tick from the tick after arriving, the rope's creak every four; the XP comes on
      // the last tile, a step down off the rope.
      steps: [
        { wait: 1 },
        { walk: [[3098, 3277]] },
        { sound: TIGHTROPE_SOUND, loops: 3 },
        { walk: [[3094, 3277]] },
        { sound: TIGHTROPE_SOUND, loops: 3 },
        { walk: [[3090, 3277], [3090, 3276]], arrive: true },
      ],
    },
    {
      object: ObjectIds.TIGHTROPE_2,
      index: 3,
      level: 1,
      xp: 7,
      route: [3091, 3276, 3],
      render: Anim.BALANCE_WALK,
      steps: [
        { wait: 1 },
        { walk: [[3092, 3276]] },
        { sound: TIGHTROPE_SOUND, loops: 7 },
        { walk: [[3092, 3266]], arrive: true },
      ],
    },
    {
      object: ObjectIds.NARROW_WALL,
      index: 4,
      level: 1,
      xp: 7,
      route: [3089, 3265, 3],
      render: Anim.LEDGE_WALK,
      steps: [
        { wait: 1 },
        { anim: Anim.LEDGE_TURN },
        { walk: [[3089, 3264]] },
        { sound: SIDESTEP_SOUND, loops: 3 },
        { walk: [[3089, 3262], [3088, 3261]] },
        { anim: Anim.LEDGE_TURN_BACK },
      ],
    },
    {
      object: ObjectIds.WALL_13,
      index: 5,
      level: 1,
      xp: 10,
      route: [3088, 3257, 3],
      steps: wallScramble([3088, 3256], [3088, 3255], "south"),
    },
    {
      object: ObjectIds.GAP_3,
      index: 6,
      level: 1,
      xp: 4,
      route: [3094, 3255, 3],
      steps: gapJump([3096, 3256, 3], { face: [3096, 3256] }),
    },
    {
      object: ObjectIds.CRATE_120,
      index: 7,
      level: 1,
      xp: 79,
      route: [3101, 3261, 3],
      // Down onto the crate a tick after arriving, and down to the ground three ticks later.
      steps: [
        ...leap([3102, 3261, 1], { windup: 1 }),
        { wait: 1 },
        { anim: -1 },
        ...leap([3103, 3261, 0], { windup: 1 }),
      ],
    },
  ],
};
