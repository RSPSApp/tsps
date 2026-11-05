const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../Constants.Agility");
const { climb, balance } = require("../Steps.Agility");
const { pipe } = require("../shortcuts/Builders.Agility");

/**
 * Obstacle pipes: crawl north through the pipe from the tile south of it, in the two captured
 * squeezes (see `pipe` in Builders.Agility), and climb out on the far side.
 */
function obstaclePipe({ pos }) {
  const { x, y } = pos;
  return [...pipe([x, y + 3], [x, y + 6]), { tele: [x, y + 7, 0] }];
}

/**
 * Gnome Stronghold Agility Course. Obstacle XP and the 110.5 lap are the Wiki's since the 8 May 2024
 * rebalance (the course page's table: a 50 XP completion bonus). Nothing on it fails (Wiki). OSRS
 * has no advanced section here (that is RuneScape's); the rev-241 cache has none of its locs.
 */
module.exports = {
  key: "gnome",
  name: "Gnome Stronghold Agility",
  helper: 1, // the Agility helper's course (enum 3507: "Gnome Stronghold Course")
  lapXp: 110.5,
  petBase: 35609, // Giant squirrel base chance (Wiki)
  diaryTask: {
    diary: "western",
    task: "complete-a-lap-of-the-gnome-agility-course",
  },
  obstacles: [
    {
      object: ObjectIds.LOG_BALANCE_21,
      index: 1,
      level: 1,
      xp: 10,
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
      xp: 10,
      route: ({ obj }) => [obj.x, obj.y + 1, obj.z],
      start: "You climb the netting...",
      steps: ({ pos }) => climb([pos.x, 3423, 1]),
    },
    {
      object: ObjectIds.TREE_BRANCH_2,
      index: 3,
      level: 1,
      xp: 6.5,
      start: "You climb the tree...",
      end: "...to the platform above.",
      steps: climb([2473, 3420, 2]),
    },
    {
      // The rope's first tile and the tiles after it (Wiki: ids 23557 and 23558, all Walk-on).
      object: [ObjectIds.BALANCING_ROPE_3, ObjectIds.BALANCING_ROPE_4],
      index: 4,
      level: 1,
      xp: 10,
      route: [2477, 3420, 2],
      render: Anim.BALANCE_WALK,
      start: "You carefully cross the tightrope.",
      steps: balance([2483, 3420]),
    },
    {
      // The three branches down (Wiki: ids 23560 and 23561; the cache places 23561 at 2487,3418 and 2487,3420).
      object: [ObjectIds.TREE_BRANCH_3, ObjectIds.TREE_BRANCH_4],
      index: 5,
      level: 1,
      xp: 6.5,
      start: "You climb down the tree...",
      end: "You land on the ground.",
      steps: climb([2487, 3420, 0], Anim.CLIMB_DOWN),
    },
    {
      object: ObjectIds.OBSTACLE_NET_5,
      index: 6,
      level: 1,
      xp: 10,
      route: ({ obj }) => [obj.x, obj.y - 1, obj.z],
      start: "You climb the netting...",
      steps: ({ pos }) => climb([pos.x, 3427, 0]),
    },
    {
      // 7.5 on the course page's table, which adds up to its 110.5 lap; the pipe's own page says 10.
      object: ObjectIds.OBSTACLE_PIPE_10,
      index: 7,
      level: 1,
      xp: 7.5,
      route: [2484, 3430, 0],
      start: "You pull yourself through the pipes...",
      steps: obstaclePipe,
    },
    {
      object: ObjectIds.OBSTACLE_PIPE_11,
      index: 7,
      level: 1,
      xp: 7.5,
      route: [2487, 3430, 0],
      start: "You pull yourself through the pipes...",
      steps: obstaclePipe,
    },
  ],
};
