const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../Constants.Agility");
const { JUMP_DOWN_SOUND, WALL_JUMP_SOUND } = require("../Steps.Agility");

/**
 * Al Kharid Rooftop. Steps, sounds and ticks follow rsprox capture 1858 (one lap, Leagues V,
 * rev 227; no main-game recording of a lap). XP is the Wiki's since 8 May 2024, all of it on the
 * obstacles (no lap bonus): the capture's `helper_agility_add_xp` amounts are those times 16.
 */
const TIGHTROPE_SOUND = 2495;
const HOLD_SOUND = 2459;
const LAND_SOUND = 2455;
const ZIPLINE_GRIP_SOUND = 1933;
const ZIPLINE_SLIDE_SOUND = 1934;

/** The zip line's slide: a tile a tick from 3303,3163 to 3314,3163, the last one quicker. */
function zipSlide() {
  const steps = [];
  for (let x = 3304; x <= 3314; x++) {
    steps.push({ move: [x, 3163], anim: x === 3304 ? Anim.ZIPLINE_SLIDE : undefined, speed: [0, x === 3314 ? 15 : 30], dir: "east" });
  }
  return steps;
}

module.exports = {
  key: "alkharid",
  name: "Al Kharid Rooftop",
  helper: 4, // the Agility helper's course (enum 3507: "Al Kharid Rooftops")
  lapXp: 216,
  petBase: 26648, // Giant squirrel base chance (Wiki)
  diaryTask: {
    diary: "lumbridge",
    task: "complete-a-lap-of-the-al-kharid-agility-course",
  },
  marks: {
    level: 20,
    // The Wiki's five spots (Mark of grace spawns): the furnace, bank, water source, plateskirt
    // shop and last house roofs. No capture has a mark here, so the tiles are unverified.
    tiles: [[3275, 3186, 3], [3267, 3170, 3], [3290, 3162, 3], [3317, 3161, 1], [3303, 3189, 3]],
  },
  obstacles: [
    {
      object: ObjectIds.ROUGH_WALL_2,
      index: 1,
      level: 20,
      xp: 12,
      // The climb two ticks after arriving, on the roof two ticks later.
      steps: [{ wait: 1 }, { faceDir: "south" }, { anim: Anim.CLIMB_UP, delay: 15 }, { wait: 2 }, { tele: [3273, 3192, 3] }],
    },
    {
      object: ObjectIds.TIGHTROPE_3,
      index: 2,
      level: 20,
      xp: 36,
      route: [3272, 3182, 3],
      render: Anim.BALANCE_WALK,
      // Onto the rope two ticks after arriving, then a tile a tick; the XP comes on the last tile.
      steps: [
        { faceDir: "south" },
        { wait: 1 },
        { walk: [[3272, 3181]] },
        { sound: TIGHTROPE_SOUND, loops: 6 },
        { walk: [[3272, 3172]], arrive: true },
      ],
    },
    {
      object: ObjectIds.CABLE,
      index: 3,
      level: 20,
      xp: 48,
      route: [3266, 3166, 3],
      // The run-up two ticks after arriving and the swing a tick later, which pays as it starts.
      steps: [
        { faceDir: "east" },
        { wait: 1 },
        { msg: { spam: "You begin an almighty run-up..." } },
        { move: [3269, 3166], anim: Anim.RUN_UP, speed: [0, 30], dir: "east" },
        { msg: { spam: "You gained enough momentum to swing to the other side!" } },
        { complete: true },
        { move: [3284, 3166], anim: Anim.ROPE_SWING, speed: [0, 60], ticks: 2, dir: "east" },
      ],
    },
    {
      object: ObjectIds.ZIP_LINE,
      index: 4,
      level: 20,
      xp: 48,
      route: [3301, 3163, 3],
      // The leap two ticks after arriving, on the line a tick later, eleven tiles' slide and a
      // step off onto 3315,3163 with the XP.
      steps: [
        { faceDir: "east" },
        { wait: 1 },
        { anim: Anim.LEAP, delay: 10 },
        { wait: 1 },
        { tele: [3303, 3163, 1] },
        { anim: Anim.ZIPLINE_GRIP },
        { sound: ZIPLINE_GRIP_SOUND },
        { sound: ZIPLINE_SLIDE_SOUND, delay: 15 },
        { wait: 1 },
        ...zipSlide(),
        { anim: -1 },
        { walk: [[3315, 3163]], arrive: true },
      ],
    },
    {
      object: ObjectIds.TROPICAL_TREE_27,
      index: 5,
      level: 20,
      xp: 12,
      route: [3318, 3165, 1],
      // The jump onto the tree a tick after arriving, two swings two ticks apart and the landing
      // on the roof, paid the tick after.
      steps: [
        { sound: WALL_JUMP_SOUND, delay: 10 },
        { move: [3318, 3169], anim: Anim.JUMP_SHORT, speed: [35, 49], dir: "north", ticks: 2 },
        { sound: HOLD_SOUND, delay: 35 },
        { move: [3318, 3170], anim: Anim.HANG_SWING, speed: [34, 42], dir: "east", ticks: 2 },
        { sound: HOLD_SOUND, delay: 35 },
        { move: [3317, 3174], anim: Anim.HANG_SWING_QUICK, speed: [34, 52], dir: "north", ticks: 2 },
        { tele: [3317, 3174, 2] },
        { anim: Anim.LAND },
        { sound: LAND_SOUND },
        { wait: 1 },
      ],
    },
    {
      object: ObjectIds.ROOF_TOP_BEAMS,
      index: 6,
      level: 20,
      xp: 6,
      steps: [{ wait: 1 }, { faceDir: "north" }, { anim: Anim.CLIMB_UP, delay: 15 }, { wait: 2 }, { tele: [3316, 3180, 3] }],
    },
    {
      object: ObjectIds.TIGHTROPE_4,
      index: 7,
      level: 20,
      xp: 18,
      route: [3313, 3185, 3],
      render: Anim.BALANCE_WALK,
      // As the first rope. The capture stood a tick on 3303,3186 before the last tile; once, so
      // not played here.
      steps: [
        { faceDir: "north" },
        { wait: 1 },
        { walk: [[3313, 3186]] },
        { sound: TIGHTROPE_SOUND, loops: 6 },
        { walk: [[3302, 3186]], arrive: true },
      ],
    },
    {
      object: ObjectIds.GAP_4,
      index: 8,
      level: 20,
      xp: 36,
      route: [3300, 3192, 3],
      // The jump two ticks after arriving, on the ground a tick later with the lap.
      steps: [
        { faceDir: "north" },
        { wait: 1 },
        { face: [3299, 3194] },
        { anim: Anim.LEAP },
        { sound: JUMP_DOWN_SOUND, delay: 15 },
        { wait: 1 },
        { tele: [3299, 3194, 0] },
      ],
    },
  ],
};
