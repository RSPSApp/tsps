const { Anim } = require("../Constants.Agility");
const { climb } = require("../Steps.Agility");
const { Loc, WyrmAnim, FIRST_PAUSE, SECOND_PAUSE, tightrope, hurdles, ledge, ziplineObstacle } = require("./ColossalWyrmSteps.Agility");

/**
 * Colossal Wyrm Agility Course, advanced (Wiki): 62 Agility, never failed. A lap starts on the
 * basic course's ladder and first tightrope (`sharesWith`), climbs the advanced ladder and ends on
 * the shared zipline. XP: the course page's table since the 2026 rework. Termites and blessed bone
 * shards are not given yet.
 */
module.exports = {
  key: "wyrm-advanced",
  name: "Colossal Wyrm Agility Course (Advanced)",
  helper: 22, // the Agility helper's course (enum 3507: "Colossal Wyrm Agility Course")
  lapXp: 1053.6,
  // The shared ladder and tightrope set both courses' progress varbits (`progress`, rsprox 1106).
  sharesWith: { course: "wyrm-basic", through: 2, progress: true },
  // varlamore_wyrm_agility_advanced_progress: the obstacle the lap has reached, 1-6, and 0 with
  // the lap (rsprox 1106).
  progressVarbit: 11293,
  obstacles: [
    {
      object: Loc.ADVANCED_LADDER,
      index: 3,
      level: 62,
      xp: 70,
      route: [1649, 2910, 1],
      steps: climb([1648, 2908, 2]),
    },
    {
      object: Loc.ADVANCED_EDGE,
      index: 4,
      level: 62,
      xp: 70,
      route: [1647, 2907, 2],
      // A step back, a step's run-up, then three long hurdles west, two ticks apart.
      steps: [
        { move: [1648, 2907, 2], anim: WyrmAnim.WALK_BACKWARDS, speed: [0, 30], dir: "west", ticks: 1 },
        { move: [1647, 2907, 2], anim: Anim.RUN_UP, speed: [0, 30], dir: "west", ticks: 1 },
        ...hurdles([[1643, 2907, 2]], { gap: 2, speed: [8, 50], delay: 0 }),
        ...hurdles([[1639, 2907, 2], [1635, 2907, 2]], { gap: 2, speed: [0, 50], delay: 0 }),
      ],
    },
    {
      object: Loc.ADVANCED_TIGHTROPE,
      index: 5,
      level: 62,
      xp: 140, // the tightrope, and the rope crossed straight after it
      route: [1634, 2908, 2],
      steps: () => [
        { render: Anim.BALANCE_WALK },
        ...tightrope([1629, 2912], [1625, 2916]),
        { render: null },
        { move: [1624, 2918, 2], anim: Anim.RUN_UP, delay: 15, speed: [15, 60], ticks: 2 },
        ...ledge([[[1624, 2923], FIRST_PAUSE], [[1624, 2927], SECOND_PAUSE]], [1624, 2931]),
      ],
    },
    ziplineObstacle(6, 62, 662),
  ],
};
