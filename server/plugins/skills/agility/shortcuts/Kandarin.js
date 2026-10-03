const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../constants");
const { ShortcutAnim, between, stile, climbOver, hops, pipe, tunnel, ropeSwing, crawlDown, crawlUp } = require("./builders");

/** Loose railings the player squeezes through between the railing tile and `other`. */
function looseRailing(object, other, level = 1) {
  return {
    object,
    level,
    xp: 0,
    steps: ({ pos, obj }) => {
      const onRailing = pos.x === obj.x && pos.y === obj.y;
      return [{ move: onRailing ? other : [obj.x, obj.y], anim: ShortcutAnim.SQUEEZE_RAILING, speed: [0, 60], ticks: 2 }];
    },
  };
}

/** Walks a log between `ends` with the balancing walk. */
function logBalance(object, ends, level, xp = 0) {
  return between({
    object,
    level,
    xp,
    ends,
    render: Anim.BALANCE_WALK,
    cross: (from, to) => [{ walk: [to] }],
  });
}

/** Swinging monkey bars that run north-south, entered from the tile east of the object. */
function monkeyBars(object, level, xp, southY, northY) {
  return {
    object,
    level,
    xp,
    route: ({ obj }) => [obj.x + 1, obj.y, obj.z],
    steps: ({ obj }) => [
      { anim: Anim.MONKEY_BARS_JUMP },
      { render: Anim.MONKEY_BARS_CROSS },
      { walk: [[obj.x + 1, obj.y === southY ? northY : southY]] },
      { render: null },
      { anim: Anim.MONKEY_BARS_DROP },
    ],
  };
}

module.exports = [
  stile({ object: ObjectIds.STILE, level: 1 }),
  {
    // East Ardougne log balance over the River: 16546 heads east, 16548 west.
    object: [ObjectIds.LOG_BALANCE_15, ObjectIds.LOG_BALANCE_17],
    level: 33,
    xp: 4,
    render: Anim.BALANCE_WALK,
    start: "You attempt to walk across the slippery log.",
    end: "You make it across the log without any problems.",
    steps: ({ obj }) => [{ walk: [[obj.id === ObjectIds.LOG_BALANCE_17 ? 2598 : 2602, 3336]] }],
    fail: {
      baseChance: 50,
      neverFailLevel: 63,
      xp: 2,
      render: Anim.BALANCE_WALK,
      end: "You finally come to the shore.",
      steps: ({ obj }) => [
        { walk: [[2600, 3336]] },
        { render: null },
        { anim: Anim.BALANCE_STAND },
        { wait: 1 },
        { msg: "You lose your footing and fall into the river." },
        { anim: obj.id === ObjectIds.LOG_BALANCE_17 ? ShortcutAnim.FALL_INTO_WATER_LEFT : ShortcutAnim.FALL_INTO_WATER_RIGHT },
        { wait: 1 },
        { tele: [2600, 3334, 0] },
        { render: ShortcutAnim.SWIM },
        { msg: "You feel like you're drowning." },
        { walk: [[2600, 3331], [2603, 3330]] },
        { render: null },
        { hit: [1, 4] },
      ],
    },
  },
  logBalance(ObjectIds.LOG_BALANCE_22, [[2598, 3477, 0], [2603, 3477, 0]], 20),
  logBalance([ObjectIds.LOG_BALANCE_12, ObjectIds.LOG_BALANCE_13, ObjectIds.LOG_BALANCE_14], [[2722, 3592, 0], [2722, 3596, 0]], 48),
  looseRailing(ObjectIds.LOOSE_RAILING, [2661, 3500]),
  looseRailing(ObjectIds.LOOSE_RAILING_2, [2515, 3160]),
  looseRailing(ObjectIds.LOOSE_RAILING_3, [2523, 3375]),
  {
    // Tree Gnome Stronghold: climb the rocks north-east of the Grand Tree either way.
    object: [ObjectIds.ROCKS_78, ObjectIds.ROCKS_79],
    level: 37,
    xp: 0,
    route: ({ obj }) => (obj.id === ObjectIds.ROCKS_78 ? [2486, 3515, 0] : [2489, 3521, 0]),
    steps: ({ obj }) => {
      const up = obj.id === ObjectIds.ROCKS_78;
      return [
        { move: [2489, 3516], anim: Anim.CLIMB_ROCKS, speed: [0, (up ? 3 : 5) * 30], ticks: up ? 2 : 4 },
        { move: up ? [2489, 3521] : [2486, 3515], anim: Anim.CLIMB_ROCKS, speed: [0, (up ? 5 : 3) * 30], ticks: up ? 4 : 2 },
        { anim: -1 },
      ];
    },
  },
  between({
    object: [ObjectIds.CASTLE_WALL, ObjectIds.HOLE_20],
    level: 16,
    ends: [[2575, 3107, 0], [2575, 3112, 0]],
    cross: (from, to) => tunnel(to),
  }),
  between({
    object: ObjectIds.BALANCING_LEDGE_7,
    level: 40,
    xp: 22,
    ends: [[2580, 9512, 0], [2580, 9520, 0]],
    start: "You put your foot on the ledge and try to edge across...",
    end: "You skillfully edge across the gap.",
    cross: (from, to) => {
      const fromNorth = from[1] > to[1];
      return [
        { anim: fromNorth ? Anim.LEDGE_STEP_OFF : Anim.LEDGE_TURN, delay: 15 },
        { wait: 1 },
        { render: fromNorth ? Anim.LEDGE_WALK_BACK : Anim.LEDGE_WALK },
        { walk: [to] },
      ];
    },
  }),
  monkeyBars(ObjectIds.MONKEYBARS_6, 57, 20, 9489, 9494),
  between({
    object: ObjectIds.OBSTACLE_PIPE_12,
    level: 49,
    xp: 8,
    ends: [[2572, 9506, 0], [2578, 9506, 0]],
    cross: (from, to) => pipe([2575, 9506], to),
  }),
  {
    // Yanille Agility dungeon: climb up the pile of rubble (and back down).
    object: ObjectIds.PILE_OF_RUBBLE,
    level: 67,
    xp: 5.5,
    start: "You climb up the pile of rubble...",
    steps: [{ anim: Anim.CLIMB_UP }, { wait: 1 }, { tele: [2615, 9506, 0] }],
  },
  {
    object: ObjectIds.PILE_OF_RUBBLE_2,
    level: 1,
    xp: 0,
    start: "You climb down the pile of rubble...",
    steps: [{ tele: [2616, 9571, 0] }],
  },
  {
    // Ogre Enclave exit: swing north over the chasm.
    object: ObjectIds.ROPESWING_9,
    level: 10,
    xp: 0,
    route: [2511, 3092, 0],
    steps: ropeSwing([2511, 3096]),
  },
  between({
    object: ObjectIds.ROCKS_95,
    level: 25,
    ends: [[2324, 3497, 0], [2322, 3502, 0]],
    cross: (from, to) => [{ move: to, anim: Anim.CLIMB_ROCKS, speed: [0, 180], ticks: 5 }, { anim: -1 }],
  }),
  {
    // Castle Wars: stepping stones over the river, one stone per click.
    object: ObjectIds.STEPPING_STONE,
    level: 1,
    xp: 0,
    steps: ({ obj }) => hops([obj.x, obj.y]),
  },
  between({
    object: ObjectIds.STEPPING_STONE_4,
    level: 76,
    ends: [[2154, 3072, 0], [2160, 3072, 0]],
    cross: (from, to, { obj }) => hops([obj.x, obj.y], to),
  }),
  {
    // Feldip Hills: climb up, or crawl back down, the rocks by the hunter area.
    object: ObjectIds.ROCKS_36,
    level: 30,
    xp: 0,
    steps: crawlUp([2485, 2898]),
  },
  {
    object: ObjectIds.ROCKS_37,
    level: 30,
    xp: 0,
    steps: crawlDown([2483, 2898], [2489, 2898], "west"),
  },
  between({
    object: ObjectIds.ROCKS_35,
    level: 30,
    xp: 1,
    ends: [[2546, 2871, 0], [2546, 2873, 0]],
    end: "You climb over the rocks.",
    cross: (from, to) => [climbOver(to, ShortcutAnim.CLIMB_OVER, 2)],
  }),
  between({
    object: ObjectIds.PILLAR_19,
    level: 15,
    ends: [[1981, 8994, 1], [1981, 8999, 1]],
    cross: (from, to, { obj }) => hops([obj.x, obj.y], to),
  }),
];
