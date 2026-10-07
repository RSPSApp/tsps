const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../constants");
const { leap } = require("../steps");

function gap(object, index, route, landing, xp, land = null) {
  return {
    object,
    index,
    level: 40,
    xp,
    route,
    steps: leap(landing, { land }),
  };
}

module.exports = {
  key: "canifis",
  name: "Canifis Rooftop",
  lapXp: 240,
  petBase: 36842, // Giant squirrel base chance (Wiki)
  marks: {
    level: 40,
    tiles: [[3499, 3505, 2], [3488, 3500, 2], [3476, 3494, 3], [3478, 3483, 2], [3497, 3471, 3], [3514, 3478, 2]],
  },
  obstacles: [
    {
      object: ObjectIds.TALL_TREE_2,
      index: 1,
      level: 40,
      xp: 10,
      route: [3507, 3488, 0],
      steps: [
        { walk: [[3507, 3489]] },
        { face: [3508, 3489] },
        { anim: Anim.CLIMB_TREE },
        { wait: 4 },
        { anim: -1 },
        { tele: [3506, 3492, 2] },
      ],
    },
    gap(ObjectIds.GAP_9, 2, [3505, 3497, 2], [3502, 3504, 2], 8),
    gap(ObjectIds.GAP_10, 3, [3498, 3504, 2], [3492, 3504, 2], 8),
    {
      object: ObjectIds.GAP_13,
      index: 4,
      level: 40,
      xp: 10,
      route: [3487, 3499, 2],
      steps: [
        { face: [3479, 3499] },
        { anim: Anim.JUMP_SHORT },
        { wait: 1 },
        { tele: [3482, 3499, 3] },
        { anim: Anim.GRAB_LEDGE },
        { wait: 1 },
        { move: [3479, 3499], speed: [0, 45], dir: "west" },
      ],
    },
    gap(ObjectIds.GAP_11, 5, [3478, 3493, 3], [3478, 3486, 2], 8),
    {
      object: ObjectIds.POLE_VAULT,
      index: 6,
      level: 40,
      xp: 10,
      route: [3478, 3484, 2],
      steps: ({ obj }) => [
        { move: [obj.x, obj.y], anim: Anim.RUN_UP, speed: [0, 60], dir: "east" },
        { anim: Anim.POLE_VAULT },
        { wait: 1 },
        { move: [3487, 3476], speed: [0, 90], ticks: 3, dir: "east" },
        { tele: [3489, 3476, 3] },
        { anim: Anim.LAND },
      ],
    },
    gap(ObjectIds.GAP_12, 7, [3502, 3476, 3], [3510, 3476, 2], 8),
    gap(ObjectIds.GAP_14, 8, [3510, 3482, 2], [3510, 3485, 0], 175, Anim.LAND),
  ],
};
