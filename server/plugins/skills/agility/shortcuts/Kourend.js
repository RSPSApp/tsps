const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../constants");
const { ShortcutAnim, between, climbOver, hops, pipe, crawlDown, crawlUp } = require("./builders");

/** Catacombs of Kourend cracks, keyed by the crack's tile. */
const CATACOMB_CRACKS = [
  { at: [1706, 10077, 0], exit: [1716, 10056, 0], level: 34 },
  { at: [1716, 10057, 0], exit: [1706, 10078, 0], level: 34 },
  { at: [1648, 10008, 0], exit: [1646, 10000, 0], level: 17 },
  { at: [1646, 10001, 0], exit: [1648, 10009, 0], level: 17 },
];

module.exports = [
  ...CATACOMB_CRACKS.map(({ at, exit, level }) => ({
    object: ObjectIds.CRACK_10,
    at,
    level,
    xp: 0,
    steps: [{ anim: ShortcutAnim.SQUEEZE_WINDOW }, { wait: 1 }, { anim: ShortcutAnim.SQUEEZE_WINDOW_OUT }, { tele: exit }],
  })),
  {
    object: ObjectIds.STONE_4,
    level: 28,
    xp: 0,
    steps: ({ obj }) => hops([obj.x, obj.y]),
  },
  {
    // Arceuus dark altar: the boulder on the path from the south.
    object: ObjectIds.BOULDER_22,
    level: 49,
    xp: 0,
    route: ({ pos, obj }) => (pos.y > obj.y ? [obj.x, obj.y, obj.z] : [1776, 3880, 0]),
    steps: ({ pos, obj }) => (pos.y > obj.y
      ? [climbOver([1776, 3882], ShortcutAnim.CLIMB_OVER, 2), { msg: "You climb over the rocks." }, { walk: [[1776, 3880]] }]
      : [{ walk: [[1776, 3882]] }, climbOver([1776, 3884], ShortcutAnim.CLIMB_OVER, 2), { msg: "You climb over the rocks." }]),
  },
  {
    object: ObjectIds.ROCKS_115,
    level: 52,
    xp: 0,
    steps: ({ obj }) => crawlUp([obj.x, obj.y], [1773, 3849], [1774, 3849]),
  },
  {
    object: ObjectIds.ROCKS_114,
    level: 52,
    xp: 0,
    steps: crawlDown([1775, 3849], [1769, 3849], "east"),
  },
  {
    // Dark altar: the long crawl down the west cliff.
    object: ObjectIds.ROCKS_112,
    at: [1743, 3854, 0],
    level: 73,
    xp: 0,
    steps: crawlDown([1741, 3854], [1752, 3854], "west"),
  },
  {
    object: [ObjectIds.ROCKS_112, ObjectIds.ROCKS_113],
    at: [1761, 3872, 0],
    level: 69,
    xp: 0,
    steps: [{ move: [1761, 3874], anim: ShortcutAnim.CLIMB_OVER, speed: [15, 60], ticks: 2 }],
  },
  {
    object: [ObjectIds.ROCKS_112, ObjectIds.ROCKS_113],
    at: [1761, 3873, 0],
    level: 69,
    xp: 0,
    steps: [{ move: [1761, 3871], anim: ShortcutAnim.CLIMB_OVER, speed: [15, 60], ticks: 2 }],
  },
  {
    object: ObjectIds.ROCKS_113,
    at: [1751, 3854, 0],
    level: 69,
    xp: 0,
    precondition: () => "You can't use that from here!",
    steps: [],
  },
  between({
    object: ObjectIds.STEPPING_STONE_35,
    level: 45,
    ends: [[1720, 3551, 0], [1724, 3551, 0]],
    cross: (from, to, { obj }) => hops([obj.x, obj.y], to),
  }),
  {
    object: ObjectIds.ROCKS_52,
    level: 69,
    xp: 0,
    end: "You climb over the rocks.",
    steps: ({ pos, obj }) => [climbOver([obj.x, obj.y + (pos.y > obj.y ? -1 : 1)])],
  },
  between({
    object: ObjectIds.STEPPING_STONE_37,
    level: 40,
    ends: [[1603, 3571, 0], [1607, 3571, 0]],
    cross: (from, to, { obj }) => hops([obj.x, obj.y], to),
  }),
  between({
    object: ObjectIds.STEPPING_STONE_36,
    level: 40,
    ends: [[1610, 3570, 0], [1614, 3570, 0]],
    cross: (from, to, { obj }) => hops([obj.x, obj.y], to),
  }),
  {
    // Mount Karuulm: the lower rocks up to the slayer dungeon entrance.
    object: ObjectIds.ROCKS_49,
    level: 29,
    xp: 0,
    steps: ({ obj }) => [
      { move: obj.y <= 3778 ? [1324, 3785] : [1324, 3777], anim: Anim.CLIMB_ROCKS, speed: [0, 180], ticks: 5 },
      { anim: -1 },
    ],
  },
  {
    object: ObjectIds.ROCKS_48,
    level: 62,
    xp: 0,
    steps: ({ obj }) => (obj.y <= 3788
      ? [
        { move: [1324, 3790], anim: Anim.CLIMB_ROCKS, speed: [0, 60] },
        { walk: [[1324, 3791]] },
        { move: [1324, 3795], anim: Anim.CLIMB_ROCKS, speed: [0, 90], ticks: 2 },
        { anim: -1 },
      ]
      : [
        { move: [1324, 3791], anim: Anim.CLIMB_ROCKS, speed: [0, 90], ticks: 2 },
        { walk: [[1324, 3790]] },
        { move: [1324, 3787], anim: Anim.CLIMB_ROCKS, speed: [0, 60] },
        { anim: -1 },
      ]),
  },
  {
    // Stronghold Slayer Cave: the tunnel beside the entrance, at the player's row.
    object: [ObjectIds.TUNNEL_44, ObjectIds.TUNNEL_45],
    level: 72,
    xp: 0,
    steps: ({ pos }) => {
      const west = pos.x <= 2429;
      return pipe([2432, pos.y], [west ? 2435 : 2429, pos.y]);
    },
  },
];
