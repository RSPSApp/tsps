const { Anim } = require("../Constants.Agility");
const { climb, balance } = require("../Steps.Agility");

/**
 * Shayzien Agility Course, basic (Wiki). The ladder, monkeybars and first tightrope are shared
 * with the advanced course (ShayzienAdvanced.Agility.js continues from obstacle 3). Levels and XP: the
 * Wiki since the 2024 rebalance (no obstacle fails). The first three obstacles follow rsprox
 * capture 1632; the rest follow the cache's platform decking (`shayzien_agility_decking01`),
 * with the end of the gap's jump a guess (docs/agility-courses.md).
 */
const Loc = Object.freeze({
  START_LADDER: 42209, // shayzien_agility_both_start_ladder
  MONKEYBARS: 42211, // shayzien_agility_both_rope_climb
  TIGHTROPE: 42212, // shayzien_agility_both_rope_walk
  BAR: 42213, // shayzien_agility_low_bar_climb
  TIGHTROPE_UP: 42214, // shayzien_agility_low_rope_walk_1
  TIGHTROPE_ACROSS: 42215, // shayzien_agility_low_rope_walk_2
  GAP: 42216, // shayzien_agility_low_end_jump
});

const ROPE_SOUND = 2495;
/** shayzien_agility_low_progress: the lap's progress, 1 after the ladder (rsprox 1632). */
const LOW_PROGRESS_VARBIT = 12334;

/**
 * Monkeybars: on two ticks after arriving, cross to `end`, off the tick after the last bar, and
 * drop to `landing` a tick later (rsprox 1632).
 */
function monkeybars(end, landing) {
  return [
    { wait: 2 },
    { anim: Anim.MONKEY_BARS_JUMP },
    { sound: 2474 },
    { sound: 2470, loops: 9 },
    { render: Anim.MONKEY_BARS_CROSS },
    { walk: [end] },
    { render: null },
    { anim: Anim.MONKEY_BARS_DROP },
    { sound: 2473 },
    { wait: 1 },
    { tele: landing },
  ];
}

module.exports = {
  key: "shayzien-basic",
  name: "Shayzien Basic Agility Course",
  helper: 21, // the Agility helper's course (enum 3507: "Shayzien Agility Course")
  lapXp: 153.5,
  progressVarbit: LOW_PROGRESS_VARBIT,
  petBase: 31804, // Giant squirrel base chance (Wiki)
  // Kourend & Kebos easy: "Do a lap of either tier of the Shayzien Agility Course." (Wiki)
  diaryTask: {
    diary: "kourend",
    task: "do-a-lap-of-either-tier-of-the-shayzien-agility",
  },
  // Marks spawn before the basic and advanced courses split (Wiki, Template:Mark of grace
  // spawns); the tiles on that stretch are guesses.
  marks: {
    level: 1,
    tiles: [[1553, 3632, 3], [1539, 3633, 2], [1524, 3636, 2]],
  },
  obstacles: [
    {
      object: Loc.START_LADDER,
      index: 1,
      level: 1,
      xp: 5.5,
      route: [1554, 3630, 0],
      steps: [{ faceDir: "north" }, { wait: 1 }, ...climb([1554, 3632, 3])],
    },
    {
      object: Loc.MONKEYBARS,
      index: 2,
      level: 1,
      xp: 8,
      route: [1553, 3633, 3],
      steps: monkeybars([1541, 3633], [1541, 3633, 2]),
    },
    {
      object: Loc.TIGHTROPE,
      index: 3,
      level: 1,
      xp: 9,
      route: [1537, 3633, 2],
      render: Anim.BALANCE_WALK,
      // A tile a tick from the tick after arriving; the XP comes the tick after the last tile.
      steps: [
        { wait: 1 },
        ...balance([1536, 3633]),
        { sound: ROPE_SOUND, loops: 3 },
        ...balance([1533, 3633]),
        { sound: ROPE_SOUND, loops: 4 },
        ...balance([1528, 3633]),
      ],
    },
    {
      object: Loc.BAR,
      index: 4,
      level: 1,
      xp: 7,
      route: [1523, 3639, 2],
      // Up onto the bars above the platform's edge, then along them to the next platform.
      steps: [
        { faceDir: "north" },
        { anim: Anim.MONKEY_BARS_JUMP },
        { sound: 2474 },
        { wait: 1 },
        { tele: [1523, 3640, 3] },
        { render: Anim.MONKEY_BARS_CROSS },
        { walk: [[1523, 3643]] },
        { render: null },
        { anim: Anim.MONKEY_BARS_DROP },
        { sound: 2473 },
      ],
    },
    {
      object: Loc.TIGHTROPE_UP,
      index: 5,
      level: 1,
      xp: 9,
      route: [1524, 3644, 3],
      render: Anim.BALANCE_WALK,
      steps: [{ sound: ROPE_SOUND, loops: 3 }, ...balance([1537, 3644]), { tele: [1538, 3644, 2] }],
    },
    {
      object: Loc.TIGHTROPE_ACROSS,
      index: 6,
      level: 1,
      xp: 9,
      route: [1540, 3644, 2],
      render: Anim.BALANCE_WALK,
      steps: [{ sound: ROPE_SOUND, loops: 3 }, ...balance([1552, 3644])],
    },
    {
      object: Loc.GAP,
      index: 7,
      level: 1,
      xp: 106,
      route: [1554, 3642, 2],
      steps: [{ faceDir: "south" }, { anim: Anim.LEAP, delay: 15 }, { wait: 1 }, { tele: [1554, 3639, 0] }, { anim: Anim.LAND }],
    },
  ],
};
