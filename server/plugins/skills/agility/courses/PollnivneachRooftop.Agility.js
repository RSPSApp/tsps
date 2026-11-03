const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../Constants.Agility");
const { JUMP_DOWN_SOUND, WALL_JUMP_SOUND } = require("../Steps.Agility");

/**
 * Pollnivneach Rooftop. Steps, tiles, planes, sounds and ticks follow rsprox capture 1788 (Leagues
 * V, rev 227; one lap, no failures; no main-game recording). XP is the Wiki's, which the capture's
 * `helper_agility_add_xp` values match (16x on that world). Jumps put the player a plane up while
 * they cross a stall, banner or gap, then back down on landing, as captured.
 */
const HURDLE_SOUND = 1936;
const LAND_SOUND = 2455;
const SWING_SOUND = 2459;
const SPOT_JUMP_SOUND = 2461;
const MONKEY_BARS_ON_SOUND = 2474;
const MONKEY_BARS_SOUND = 2466;
const MONKEY_BARS_OFF_SOUND = 2473;

module.exports = {
  key: "pollnivneach",
  name: "Pollnivneach Rooftop",
  helper: 17, // the Agility helper's course (enum 3507: "Pollnivneach Rooftops")
  lapXp: 890,
  petBase: 33422, // Giant squirrel base chance (Wiki)
  // Desert Diary hard: "Complete a lap of the Pollnivneach agility course." (capture 1788: completed with the lap)
  diaryTask: {
    diary: "desert",
    task: "complete-a-lap-of-the-pollnivneach-agility-cours",
  },
  // The hard Desert diary makes 1 cooldown in 3 two minutes (Wiki: Mark of Grace). Tiles: the Wiki's
  // spawn map (Template:Mark of grace spawns), planes from the roofs' obstacles in capture 1788.
  marks: {
    level: 70,
    shortCooldown: [{ diary: "desert", tier: "hard", chance: 1 / 3 }],
    tiles: [[3347, 2969, 1], [3353, 2975, 1], [3359, 2983, 2], [3362, 2993, 2], [3357, 3002, 2]],
  },
  obstacles: [
    {
      object: ObjectIds.BASKET_4,
      index: 1,
      level: 70,
      xp: 10,
      route: [3351, 2961, 0],
      // Onto the basket a tick after turning, a second jump up the wall, on the roof a tick later.
      steps: [
        { faceDir: "north" },
        { wait: 1 },
        { sound: WALL_JUMP_SOUND, delay: 20 },
        { move: [3351, 2962, 1], anim: Anim.JUMP_SHORT, delay: 20, speed: [25, 30], dir: "north" },
        { anim: Anim.JUMP_SHORT, delay: 20 },
        { sound: WALL_JUMP_SOUND, delay: 20 },
        { wait: 1 },
        { tele: [3351, 2964, 1] },
        { anim: Anim.LAND },
        { wait: 1 },
      ],
    },
    {
      object: ObjectIds.MARKET_STALL_13,
      index: 2,
      level: 70,
      xp: 45,
      route: [3350, 2968, 1],
      // A run-up onto 3350,2967, the hurdle over the stall (on plane 2), a jump onto the next roof
      // two ticks later and down onto it two ticks after that.
      steps: [
        { move: [3350, 2967], anim: Anim.RUN_UP, delay: 15, speed: [15, 29], dir: "north" },
        { sound: HURDLE_SOUND },
        { move: [3350, 2971, 2], anim: Anim.JUMP_HURDLE, speed: [8, 50], ticks: 2, dir: "north" },
        { sound: WALL_JUMP_SOUND },
        { move: [3352, 2973], anim: Anim.JUMP_SHORT, speed: [25, 59], ticks: 0, dir: "north" },
        { wait: 2 },
        { tele: [3352, 2973, 1] },
        { anim: Anim.LAND },
        { sound: LAND_SOUND },
        { wait: 1 },
      ],
    },
    {
      object: ObjectIds.BANNER_13,
      index: 3,
      level: 70,
      xp: 65,
      route: [3354, 2976, 1],
      // A run-up, the jump onto the banner (plane 2), hanging along it two ticks later, down two after.
      steps: [
        { anim: Anim.RUN_UP, delay: 15 },
        { face: [3355, 2977] },
        { wait: 1 },
        { sound: WALL_JUMP_SOUND, delay: 10 },
        { move: [3357, 2977, 2], anim: Anim.JUMP_SHORT, delay: 10, speed: [35, 59], ticks: 2, dir: "north" },
        { sound: SWING_SOUND, delay: 35 },
        { move: [3360, 2977, 2], anim: Anim.HANG, speed: [34, 59], ticks: 0, dir: "north" },
        { wait: 2 },
        { tele: [3360, 2977, 1] },
        { anim: Anim.LAND },
        { sound: LAND_SOUND },
        { wait: 1 },
        { face: [3361, 2978] },
      ],
    },
    {
      object: ObjectIds.GAP_30,
      index: 4,
      level: 70,
      xp: 35,
      route: [3362, 2977, 1],
      // The jump a tick after turning (plane 2), the grab two ticks later, on the roof the tick after.
      steps: [
        { face: [3365, 2976] },
        { wait: 1 },
        { sound: WALL_JUMP_SOUND, delay: 15 },
        { move: [3365, 2976, 2], anim: Anim.JUMP_SHORT, delay: 15, speed: [40, 49], ticks: 2, dir: "east" },
        { move: [3366, 2976, 1], anim: Anim.GRAB_LEDGE, speed: [25, 30], dir: "east" },
      ],
    },
    {
      object: ObjectIds.TREE_53,
      index: 5,
      level: 70,
      xp: 75,
      route: [3368, 2976, 1],
      // Onto the tree (plane 2), two swings two ticks apart, down onto the roof two ticks after.
      steps: [
        { faceDir: "north" },
        { wait: 1 },
        { sound: WALL_JUMP_SOUND, delay: 10 },
        { move: [3368, 2978, 2], anim: Anim.JUMP_SHORT, delay: 10, speed: [35, 49], ticks: 2, dir: "north" },
        { sound: SWING_SOUND, delay: 35 },
        { move: [3368, 2979, 2], anim: Anim.HANG_SWING, speed: [34, 52], ticks: 2, dir: "east" },
        { sound: SWING_SOUND, delay: 35 },
        { move: [3368, 2982, 2], anim: Anim.HANG_SWING_QUICK, speed: [34, 52], ticks: 0, dir: "east" },
        { wait: 2 },
        { tele: [3368, 2982, 1] },
        { anim: Anim.LAND },
        { sound: LAND_SOUND },
        { wait: 1 },
        { faceDir: "north" },
      ],
    },
    {
      object: ObjectIds.ROUGH_WALL_5,
      index: 6,
      level: 70,
      xp: 5,
      // The climb a tick after arriving, on the roof two ticks later.
      steps: [
        { wait: 1 },
        { faceDir: "north" },
        { anim: Anim.CLIMB_UP, delay: 15 },
        { wait: 2 },
        { tele: [3365, 2983, 2] },
        { anim: -1 },
      ],
    },
    {
      object: ObjectIds.MONKEYBARS,
      index: 7,
      level: 70,
      xp: 55,
      route: [3358, 2984, 2],
      // Onto the bars a tick after turning, a tile a tick to 3358,2991, the drop two ticks after.
      steps: [
        { faceDir: "north" },
        { wait: 1 },
        { anim: Anim.MONKEY_BARS_JUMP },
        { render: Anim.MONKEY_BARS_CROSS },
        { sound: MONKEY_BARS_ON_SOUND },
        { sound: MONKEY_BARS_SOUND, loops: 13, delay: 40 },
        { walk: [[3358, 2991]] },
        { wait: 1 },
        { render: null },
        { anim: Anim.MONKEY_BARS_DROP },
        { sound: MONKEY_BARS_OFF_SOUND },
        { wait: 1 },
      ],
    },
    {
      object: ObjectIds.TREE_126,
      index: 8,
      level: 70,
      xp: 60,
      route: [3360, 2995, 2],
      // Two hurdles two ticks apart (plane 3), down onto the roof two ticks after the second.
      steps: [
        { faceDir: "north" },
        { wait: 1 },
        { sound: HURDLE_SOUND },
        { move: [3360, 2997, 3], anim: Anim.JUMP_HURDLE, speed: [8, 50], ticks: 2, dir: "north" },
        { sound: HURDLE_SOUND, delay: 10 },
        { move: [3359, 3000, 3], anim: Anim.JUMP_HURDLE, delay: 10, speed: [18, 60], ticks: 0, dir: "north" },
        { wait: 2 },
        { tele: [3359, 3000, 2] },
        { wait: 1 },
      ],
    },
    {
      object: ObjectIds.DRYING_LINE,
      index: 9,
      level: 70,
      xp: 540,
      // Wiki: 666 with the hard Desert diary (needs the Agility plugin to read `diaryXp`).
      diaryXp: { diary: "desert", tier: "hard", xp: 666 },
      route: [3362, 3002, 2],
      // A jump onto the line (plane 3) a tick after turning, the leap off two ticks later, on the
      // ground with the lap a tick after that.
      steps: [
        { face: [3363, 3000] },
        { wait: 1 },
        { sound: SPOT_JUMP_SOUND },
        { move: [3363, 3000, 3], anim: Anim.JUMP, speed: [15, 45], ticks: 2, dir: "south" },
        { anim: Anim.LEAP, delay: 15 },
        { sound: JUMP_DOWN_SOUND, delay: 15 },
        { wait: 1 },
        { tele: [3363, 2998, 0] },
        { anim: Anim.LAND },
      ],
    },
  ],
};
