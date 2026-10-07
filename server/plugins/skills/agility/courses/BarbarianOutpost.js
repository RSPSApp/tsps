const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../constants");
const { climb, balance } = require("../steps");

/** The three crumbling walls share an id; each is its own lap step. */
function crumblingWall(x, index) {
  return {
    object: ObjectIds.CRUMBLING_WALL_2,
    at: [x, 3553, 0],
    index,
    level: 35,
    xp: 13.7,
    route: [x - 1, 3553, 0],
    start: "You climb the low wall...",
    precondition: ({ pos }) => (pos.x >= x ? "You can't climb over the wall from here." : null),
    steps: [{ move: [x + 1, 3553], anim: Anim.CLIMB_LOW_WALL, delay: 15, speed: [0, 60], ticks: 2, dir: "east" }],
  };
}

module.exports = {
  key: "barbarian",
  name: "Barbarian Outpost",
  lapXp: 153.2,
  petBase: 44376, // Giant squirrel base chance (Wiki)
  obstacles: [
    {
      object: ObjectIds.ROPESWING_5,
      index: 1,
      level: 35,
      xp: 22,
      route: [2551, 3554, 0],
      steps: [
        { objAnim: Anim.OBJECT_ROPE_SWING },
        { move: [2551, 3549], anim: Anim.ROPE_SWING, speed: [30, 60], ticks: 2, dir: "south" },
      ],
    },
    {
      object: ObjectIds.LOG_BALANCE_20,
      index: 2,
      level: 35,
      xp: 13.7,
      route: [2551, 3546, 0],
      render: Anim.BALANCE_WALK,
      start: "You walk carefully across the slippery log...",
      end: "...You make it safely to the other side.",
      steps: balance([2541, 3546]),
    },
    {
      object: ObjectIds.OBSTACLE_NET_2,
      index: 3,
      level: 35,
      xp: 8.2,
      route: ({ pos }) => (pos.y <= 3545 ? [2539, 3545, 0] : [2539, 3546, 0]),
      start: "You climb the obstacle net...",
      end: "...to the platform above.",
      steps: ({ pos }) => climb(pos.y <= 3545 ? [2537, 3545, 1] : [2537, 3546, 1]),
    },
    {
      object: ObjectIds.BALANCING_LEDGE_6,
      index: 4,
      level: 35,
      xp: 22,
      route: [2536, 3547, 1],
      render: Anim.LEDGE_WALK,
      start: "You put your foot on the ledge and try to edge across...",
      end: "You skillfully edge across the gap.",
      steps: balance([2532, 3547]),
    },
    crumblingWall(2536, 5),
    crumblingWall(2539, 6),
    crumblingWall(2542, 7),
  ],
};
