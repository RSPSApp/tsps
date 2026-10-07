const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../constants");
const { climb, balance } = require("../steps");

/** Obstacle pipes: crawl north through the pipe from the tile south of it. */
function pipe({ pos }) {
  const { x, y } = pos;
  return [
    { anim: Anim.SQUEEZE_PIPE },
    { wait: 1 },
    { move: [x, y + 3], speed: [0, 90], ticks: 3, dir: "north" },
    { wait: 1 },
    { move: [x, y + 6], speed: [0, 90], ticks: 3, dir: "north" },
    { anim: Anim.SQUEEZE_PIPE },
    { wait: 2 },
    { tele: [x, y + 7, 0] },
  ];
}

module.exports = {
  key: "gnome",
  name: "Gnome Stronghold Agility",
  lapXp: 110.5,
  petBase: 35609, // Giant squirrel base chance (Wiki)
  obstacles: [
    {
      object: ObjectIds.LOG_BALANCE_21,
      index: 1,
      level: 1,
      xp: 7.5,
      route: [2474, 3436, 0],
      render: Anim.BALANCE_WALK,
      start: "You walk carefully across the slippery log...",
      end: "...You make it safely to the other side.",
      steps: balance([2474, 3429]),
    },
    {
      object: ObjectIds.OBSTACLE_NET_4,
      index: 2,
      level: 1,
      xp: 7.5,
      route: ({ obj }) => [obj.x, obj.y + 1, obj.z],
      start: "You climb the netting...",
      steps: ({ pos }) => climb([pos.x, 3423, 1]),
    },
    {
      object: ObjectIds.TREE_BRANCH_2,
      index: 3,
      level: 1,
      xp: 5,
      start: "You climb the tree...",
      end: "...to the platform above.",
      steps: climb([2473, 3420, 2]),
    },
    {
      object: ObjectIds.BALANCING_ROPE_3,
      index: 4,
      level: 1,
      xp: 7.5,
      route: [2477, 3420, 2],
      render: Anim.BALANCE_WALK,
      start: "You carefully cross the tightrope.",
      steps: balance([2483, 3420]),
    },
    {
      object: ObjectIds.TREE_BRANCH_3,
      index: 5,
      level: 1,
      xp: 5,
      start: "You climb down the tree...",
      end: "You land on the ground.",
      steps: climb([2487, 3420, 0], Anim.CLIMB_DOWN),
    },
    {
      object: ObjectIds.OBSTACLE_NET_5,
      index: 6,
      level: 1,
      xp: 7.5,
      route: ({ obj }) => [obj.x, obj.y - 1, obj.z],
      start: "You climb the netting...",
      steps: ({ pos }) => climb([pos.x, 3427, 0]),
    },
    {
      object: ObjectIds.OBSTACLE_PIPE_10,
      index: 7,
      level: 1,
      xp: 7.5,
      route: [2484, 3430, 0],
      start: "You pull yourself through the pipes...",
      steps: pipe,
    },
    {
      object: ObjectIds.OBSTACLE_PIPE_11,
      index: 7,
      level: 1,
      xp: 7.5,
      route: [2487, 3430, 0],
      start: "You pull yourself through the pipes...",
      steps: pipe,
    },
  ],
};
