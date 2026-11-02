const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../Constants.Agility");
const { balance } = require("../Steps.Agility");
const { pipe } = require("../shortcuts/Builders.Agility");

const STEPPING_STONES = 6;

function steppingStones({ pos }) {
  const steps = [];
  for (let hop = 1; hop <= STEPPING_STONES; hop++) {
    steps.push(
      { move: [pos.x - hop, pos.y], anim: Anim.JUMP, speed: [0, 35], dir: "west" },
      { wait: 1 },
    );
  }
  return steps;
}

module.exports = {
  key: "wilderness",
  name: "Wilderness Agility",
  helper: 13, // the Agility helper's course (enum 3507: "Wilderness Agility Course")
  lapXp: 571.4,
  petBase: 34666, // Giant squirrel base chance (Wiki)
  obstacles: [
    {
      object: ObjectIds.OBSTACLE_PIPE_9,
      index: 1,
      level: 52,
      xp: 12.5,
      route: [3004, 3937, 0],
      // rsprox 449-461: crawl to 3940, unseen to 3947, crawl to 3950.
      steps: ({ pos }) => pipe([pos.x, pos.y + 3], [pos.x, pos.y + 13], [pos.x, pos.y + 10]),
    },
    {
      object: ObjectIds.ROPESWING_6,
      index: 2,
      level: 52,
      xp: 20,
      route: [3005, 3953, 0],
      steps: [
        { objAnim: Anim.OBJECT_ROPE_SWING },
        { move: [3005, 3958], anim: Anim.ROPE_SWING, speed: [30, 60], ticks: 2, dir: "north" },
      ],
    },
    {
      object: ObjectIds.STEPPING_STONE_33,
      index: 3,
      level: 52,
      xp: 20,
      route: [3002, 3960, 0],
      start: "You start crossing the stepping stones...",
      steps: steppingStones,
    },
    {
      object: ObjectIds.LOG_BALANCE_23,
      index: 4,
      level: 52,
      xp: 20,
      route: [3002, 3945, 0],
      render: Anim.BALANCE_WALK,
      start: "You walk carefully across the slippery log...",
      end: "...You make it safely to the other side.",
      steps: balance([2994, 3945]),
    },
    {
      object: ObjectIds.ROCKS_105,
      index: 5,
      level: 52,
      xp: 0,
      end: "You reach the top.",
      steps: ({ obj }) => [
        { move: [obj.x, obj.y - 3], anim: Anim.CLIMB_ROCKS, speed: [0, 90], ticks: 3, dir: "south" },
        { anim: -1 },
      ],
    },
  ],
};
