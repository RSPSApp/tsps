const { Anim } = require("../Constants.Agility");
const { climb } = require("../Steps.Agility");
const { Loc, WyrmAnim, FIRST_PAUSE, LONGJUMP_SOUND, tightrope, hurdles, ledge, ziplineObstacle } = require("./ColossalWyrmSteps.Agility");

/**
 * Colossal Wyrm Agility Course, basic (Wiki): 50 Agility, never failed. The start ladder and the
 * first tightrope (with the edges jumped straight after it) are shared with the advanced course
 * (ColossalWyrmAdvanced.Agility.js), and both end on the same zipline. XP per obstacle: the course page's
 * table since the 2026 rework; edges and the rope's jumps need no click, so they go with the
 * obstacle before them. Termites and blessed bone shards are not given yet.
 */
module.exports = {
  key: "wyrm-basic",
  name: "Colossal Wyrm Agility Course (Basic)",
  helper: 22, // the Agility helper's course (enum 3507: "Colossal Wyrm Agility Course")
  lapXp: 601.6,
  // varlamore_wyrm_agility_basic_progress: the obstacle the lap has reached, 1-6, and 0 with the
  // lap (rsprox 1106).
  progressVarbit: 11292,
  obstacles: [
    {
      object: Loc.START_LADDER,
      index: 1,
      level: 50,
      xp: 37.2,
      route: [1652, 2931, 0],
      steps: climb([1653, 2931, 1]),
    },
    {
      object: Loc.TIGHTROPE,
      index: 2,
      level: 50,
      xp: 74.4, // the tightrope, and the six edges after it (6.2 each)
      route: [1655, 2926, 1],
      render: Anim.BALANCE_WALK,
      steps: [
        ...tightrope([1655, 2921], [1655, 2918]),
        { render: null },
        { move: [1655, 2916, 1], anim: Anim.RUN_UP, delay: 15, speed: [15, 60], ticks: 2 },
        ...hurdles([[1655, 2914, 1], [1653, 2914, 1], [1653, 2912, 1], [1651, 2912, 1], [1651, 2910, 1], [1649, 2910, 1]]),
      ],
    },
    {
      object: Loc.BASIC_TIGHTROPE,
      index: 3,
      level: 50,
      xp: 37.2,
      route: [1647, 2910, 1],
      render: Anim.BALANCE_WALK,
      steps: tightrope([1641, 2910], [1635, 2910]),
    },
    {
      object: Loc.BASIC_ROPE,
      index: 4,
      level: 50,
      xp: 74.4, // the rope, and the edge jumped after it
      route: [1632, 2910, 1],
      steps: () => [
        ...ledge([[[1629, 2912], FIRST_PAUSE]], [1627, 2914]),
        { move: [1627, 2918, 1], anim: Anim.RUN_UP, speed: [10, 60], ticks: 2 },
        { sound: LONGJUMP_SOUND },
        { move: [1627, 2923, 1], anim: WyrmAnim.LONGJUMP, speed: [0, 60], ticks: 2 },
        { move: [1627, 2926, 1], anim: Anim.RUN_UP, speed: [0, 30], ticks: 1 },
        { sound: LONGJUMP_SOUND },
        { move: [1627, 2931, 1], anim: WyrmAnim.LONGJUMP, speed: [0, 60], ticks: 2 },
        { anim: -1 },
      ],
    },
    {
      object: Loc.BASIC_LADDER,
      index: 5,
      level: 50,
      xp: 37.2,
      steps: climb([1625, 2932, 2]),
    },
    ziplineObstacle(6, 50, 341.2),
  ],
};
