const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../Constants.Agility");
const { climb, faceLoc } = require("../Steps.Agility");

/** Hand holds climbed after the first hold, all on the wall's west face. */
const HAND_HOLDS = [[3051, 3352], [3051, 3353], [3051, 3354], [3051, 3355]];

function handHolds() {
  const steps = [
    { anim: Anim.JUMP_SHORT },
    { wait: 1 },
    { tele: [3050, 3351, 2] },
    { anim: Anim.HANG },
  ];
  for (const hold of HAND_HOLDS) {
    steps.push({ wait: 1 }, { move: hold, speed: [10, 20], dir: "west" }, { anim: Anim.HANG });
  }
  steps.push({ wait: 1 }, { move: [3050, 3357, 3], anim: Anim.HANG_DROP, speed: [15, 35], dir: "west" }, { anim: -1 });
  return steps;
}

/** Tightropes start on the rope's own tile, then balance to the far roof. */
function tightrope(object, index, route, finish, xp) {
  return {
    object,
    index,
    level: 50,
    xp,
    route,
    render: Anim.BALANCE_WALK,
    steps: ({ obj }) => [{ walk: [[obj.x, obj.y], finish] }],
  };
}

/** Ledges and the gap after the third rope: a hurdle jump `dx`/`dy` tiles along the roof. */
function ledge(object, index, dx, dy, xp) {
  const dir = dx < 0 ? "west" : dx > 0 ? "east" : "south";
  return {
    object,
    index,
    level: 50,
    xp,
    steps: ({ pos }) => [
      { face: [pos.x + dx, pos.y + dy] },
      { move: [pos.x + dx, pos.y + dy, 3], anim: Anim.JUMP_HURDLE, speed: [0, 45], ticks: 2, dir },
    ],
  };
}

/**
 * Falador Rooftop. No rsprox capture exists (searched every obstacle loc id, the lap count line);
 * the movement is a guess from the cache's locs. XP per obstacle is the Wiki course page's since
 * the 8 May 2024 rebalance, adding up to the 586 lap with no bonus.
 */
module.exports = {
  key: "falador",
  name: "Falador Rooftop",
  helper: 12, // the Agility helper's course (enum 3507: "Falador Rooftops")
  lapXp: 586,
  petBase: 26806, // Giant squirrel base chance (Wiki)
  // Falador Diary hard: "Complete a lap of the Falador rooftop agility course."
  diaryTask: {
    diary: "falador",
    task: "complete-a-lap-of-the-falador-rooftop-agility-co",
  },
  marks: {
    level: 50,
    // The Wiki's spawn map (Template:Mark of grace spawns); every roof of the course is plane 3.
    tiles: [[3045, 3345, 3], [3049, 3357, 3], [3019, 3345, 3], [3013, 3345, 3], [3015, 3333, 3]],
  },
  obstacles: [
    {
      object: ObjectIds.ROUGH_WALL_4,
      index: 1,
      level: 50,
      xp: 11,
      route: [3036, 3341, 0],
      steps: (context) => [faceLoc(context.obj), ...climb([3036, 3342, 3])],
    },
    tightrope(ObjectIds.TIGHTROPE_6, 2, [3039, 3343, 3], [3047, 3343], 22),
    {
      object: ObjectIds.HAND_HOLDS_4,
      index: 3,
      level: 50,
      xp: 61,
      steps: handHolds,
    },
    {
      object: ObjectIds.GAP_15,
      index: 4,
      level: 50,
      xp: 27,
      route: [3048, 3358, 3],
      steps: [{ move: [3048, 3361], anim: Anim.JUMP, speed: [15, 35], dir: "north" }],
    },
    {
      object: ObjectIds.GAP_16,
      index: 5,
      level: 50,
      xp: 26,
      route: [3045, 3361, 3],
      steps: [{ move: [3041, 3361], anim: Anim.JUMP, speed: [15, 35], dir: "west" }],
    },
    tightrope(ObjectIds.TIGHTROPE_7, 6, [3035, 3362, 3], [3027, 3354], 61),
    tightrope(ObjectIds.TIGHTROPE_8, 7, [3027, 3353, 3], [3020, 3353], 53),
    ledge(ObjectIds.GAP_26, 8, 0, -4, 30),
    ledge(ObjectIds.LEDGE_7, 9, -2, 0, 14),
    ledge(ObjectIds.LEDGE_13, 10, 0, -2, 13),
    ledge(ObjectIds.LEDGE_14, 11, 0, -2, 13),
    ledge(ObjectIds.LEDGE_15, 11, 0, -2, 13),
    ledge(ObjectIds.LEDGE_16, 12, 2, 0, 14),
    {
      object: ObjectIds.EDGE_2,
      index: 13,
      level: 50,
      xp: 241,
      steps: ({ pos }) => [
        { face: [pos.x + 5, pos.y] },
        { move: [pos.x + 3, pos.y, 3], anim: Anim.JUMP_HURDLE, speed: [0, 45], ticks: 2, dir: "east" },
        { anim: Anim.JUMP_SHORT },
        { wait: 1 },
        { tele: [pos.x + 5, pos.y, 0] },
        { anim: Anim.LAND },
      ],
    },
  ],
};
