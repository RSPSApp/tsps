const { Anim } = require("../Constants.Agility");

/**
 * Shayzien Agility Course, advanced (Wiki): 45 Agility, a crossbow and a mith grapple. A lap
 * starts on the basic course's ladder, monkeybars and tightrope (`sharesWith`) and goes on at
 * the beams from there. No rsprox capture reaches these obstacles: the tiles follow the cache's
 * platform decking, and the beam swing and the zipline's landing are guesses
 * (docs/agility-courses.md).
 */
const Loc = Object.freeze({
  BEAM_WEST: 42217, // shayzien_agility_up_swing_jump_1
  EDGE_NORTH: 42218, // shayzien_agility_up_jump_platform_1
  EDGE_SOUTH: 42219, // shayzien_agility_up_jump_platform_2
  BEAM_EAST: 42220, // shayzien_agility_up_swing_jump_2
  ZIPLINE: 42221, // shayzien_agility_up_end_jump
});

/** dorgesh_grapple_swing: the cache's grapple swing (Shayzien has none of its own). */
const GRAPPLE_SWING = 6070;
const MITH_GRAPPLE = 9419;
const GRAPPLE = Object.freeze({
  skills: { agility: 45 },
  equipped: [
    { slot: "weapon", name: "crossbow", message: "You need a crossbow equipped to do that." },
    { slot: "ammunition", ids: [MITH_GRAPPLE], message: "You need a mithril grapple tipped bolt with a rope to do that." },
  ],
});

/** Fire the grapple at the beam and swing across to `landing`. */
function swing(dir, landing) {
  return [
    { faceDir: dir },
    { anim: GRAPPLE_SWING },
    { wait: 1 },
    { move: landing, speed: [15, 90], dir, ticks: 3 },
    { anim: -1 },
  ];
}

function jump(landing) {
  return { move: landing, anim: Anim.JUMP, speed: [15, 35], ticks: 1 };
}

module.exports = {
  key: "shayzien-advanced",
  name: "Shayzien Advanced Agility Course",
  helper: 21, // the Agility helper's course (enum 3507: "Shayzien Agility Course")
  lapXp: 507.5,
  petBase: 29738, // Giant squirrel base chance (Wiki)
  sharesWith: { course: "shayzien-basic", through: 3 },
  // Kourend & Kebos easy: "Do a lap of either tier of the Shayzien Agility Course." (Wiki)
  diaryTask: {
    diary: "kourend",
    task: "do-a-lap-of-either-tier-of-the-shayzien-agility",
  },
  // Marks spawn before the courses split, as on the basic course (Wiki, Template:Mark of grace
  // spawns); the tiles are guesses.
  marks: {
    level: 45,
    tiles: [[1553, 3632, 3], [1539, 3633, 2], [1524, 3636, 2]],
  },
  obstacles: [
    {
      object: Loc.BEAM_WEST,
      index: 4,
      level: 45,
      xp: 23,
      route: [1521, 3637, 2],
      requires: [GRAPPLE],
      steps: swing("west", [1511, 3637, 2]),
    },
    {
      object: Loc.EDGE_NORTH,
      index: 5,
      level: 45,
      xp: 18,
      route: [1510, 3635, 2],
      steps: [{ faceDir: "south" }, jump([1510, 3630, 2])],
    },
    {
      object: Loc.EDGE_SOUTH,
      index: 6,
      level: 45,
      xp: 21,
      route: [1510, 3628, 2],
      // Across the two single planks to the platform below the second beam.
      steps: [{ faceDir: "south" }, jump([1510, 3625, 2]), { wait: 1 }, jump([1510, 3622, 2]), { wait: 1 }, jump([1510, 3620, 2])],
    },
    {
      object: Loc.BEAM_EAST,
      index: 7,
      level: 45,
      xp: 23,
      route: [1511, 3619, 2],
      requires: [GRAPPLE],
      steps: swing("east", [1521, 3619, 2]),
    },
    {
      object: Loc.ZIPLINE,
      index: 8,
      level: 45,
      xp: 400,
      route: [1522, 3620, 2],
      steps: [
        { faceDir: "north" },
        { anim: Anim.ZIPLINE_GRIP },
        { wait: 1 },
        { anim: Anim.ZIPLINE_SLIDE },
        { wait: 3 },
        { anim: -1 },
        { tele: [1522, 3626, 0] },
      ],
    },
  ],
};
