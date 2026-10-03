const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../constants");
const { ShortcutAnim, between, climbOver, crevice, crawlDown, crawlUp } = require("./builders");

module.exports = [
  between({
    object: ObjectIds.BIG_WINDOW,
    level: 70,
    ends: ({ obj }) => [[obj.x, obj.y, obj.z], [obj.x, obj.y + 1, obj.z]],
    cross: (from, to) => [
      { move: to, anim: ShortcutAnim.SQUEEZE_WINDOW, speed: [0, 60] },
      { anim: ShortcutAnim.SQUEEZE_WINDOW_OUT },
    ],
  }),
  between({
    object: ObjectIds.BROKEN_WALL_8,
    level: 70,
    ends: [[3295, 3157, 0], [3295, 3158, 0]],
    end: "You climb over the wall.",
    cross: (from, to) => [climbOver(to)],
  }),
  {
    // Al Kharid mine: climb up the rocks, or crawl back down them.
    object: ObjectIds.ROCKS_82,
    level: 38,
    xp: 0,
    steps: crawlUp([3305, 3315], [3306, 3315]),
  },
  {
    object: ObjectIds.ROCKS_81,
    level: 38,
    xp: 0,
    steps: crawlDown([3306, 3315], [3302, 3315], "east"),
  },
  between({
    object: ObjectIds.CREVICE_16,
    level: 86,
    ends: [[3500, 9510, 2], [3506, 9505, 2]],
    end: "You climb your way through the narrow crevice.",
    cross: (from, to) => (to[0] > from[0]
      ? crevice([3501, 9510], [3506, 9506], to)
      : crevice([3506, 9506], [3501, 9510], to)),
  }),
  {
    // Agility Pyramid: the climbing rocks on its west side.
    object: [ObjectIds.CLIMBING_ROCKS_4, ObjectIds.CLIMBING_ROCKS_5],
    level: 30,
    xp: 0,
    steps: ({ pos, obj }) => [
      { move: [pos.x + (pos.x <= obj.x ? 4 : -4), pos.y], anim: Anim.CLIMB_ROCKS, speed: [0, 120], ticks: 3 },
      { anim: -1 },
    ],
  },
];
