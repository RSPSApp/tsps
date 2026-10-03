const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../constants");
const { climb } = require("../steps");

/** Ways onto and off the agility courses that are not part of a lap. */
module.exports = [
  {
    // Wilderness course: the door balances north along the ledge to the course.
    object: ObjectIds.DOOR_463,
    level: 52,
    xp: 0,
    route: [2998, 3916, 0],
    render: Anim.BALANCE_WALK,
    steps: [{ walk: [[2998, 3931]] }],
  },
  {
    // Wilderness course: the gate walks back south to the door.
    object: [ObjectIds.GATE_165, ObjectIds.GATE_166],
    level: 1,
    xp: 0,
    route: [2998, 3931, 0],
    render: Anim.BALANCE_WALK,
    steps: [{ walk: [[2998, 3916]] }],
  },
  {
    // Barbarian Outpost: squeeze through the pipe into or out of the course.
    object: ObjectIds.OBSTACLE_PIPE_7,
    level: 35,
    xp: 0,
    route: ({ pos }) => (pos.y >= 3560 ? [2552, 3561, 0] : [2552, 3558, 0]),
    steps: ({ pos, obj }) => {
      const north = pos.y >= 3560;
      return [
        { wait: 1 },
        { move: [obj.x, north ? obj.y - 1 : obj.y + 2], anim: Anim.SQUEEZE_PIPE, speed: [0, 100], dir: north ? "south" : "north" },
        { tele: north ? [2552, 3558, 0] : [2552, 3561, 0] },
      ];
    },
  },
  {
    // Barbarian Outpost: the ladder down from the balancing ledge platform.
    object: [ObjectIds.LADDER_194, ObjectIds.LADDER_422],
    at: [2532, 3545, 1],
    level: 1,
    xp: 0,
    steps: climb([2532, 3546, 0], Anim.CLIMB_DOWN),
  },
];
