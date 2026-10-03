const { ObjectIds, ItemIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Equipment } = require("../../../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { Anim } = require("../constants");
const { ShortcutAnim, between, climbOver, jump, pipe, tunnel, crevice } = require("./builders");

const GRAPPLE_WALLS = [ObjectIds.WALL_59, ObjectIds.WALL_61, ObjectIds.WALL_62];
const JUMP_DOWN_WALLS = [ObjectIds.WALL_60, ObjectIds.WALL_63, ObjectIds.WALL_64];

/** Grapple points on the Falador and Yanille walls, and the walkway each one reaches. */
const GRAPPLES = [
  { at: [3033, 3390, 0], route: [3033, 3390, 0], walkway: [3033, 3389, 1], level: 11 },
  { at: [3032, 3389, 0], route: [3032, 3388, 0], walkway: [3032, 3389, 1], level: 11 },
  { at: [2556, 3075, 0], route: [2556, 3075, 0], walkway: [2556, 3074, 1], level: 39 },
  { at: [2556, 3072, 0], route: [2556, 3072, 0], walkway: [2556, 3073, 1], level: 39 },
];

/** Jumping back down from the walkways. */
const WALL_DROPS = [
  { at: [3033, 3390, 1], landing: [3033, 3390, 0] },
  { at: [3032, 3388, 1], landing: [3032, 3388, 0] },
  { at: [2556, 3075, 1], landing: [2556, 3075, 0] },
  { at: [2556, 3072, 1], landing: [2556, 3072, 0] },
];

function grappleReady({ player }) {
  const items = player.getEquipment().getItems();
  const weapon = items[Equipment.WEAPON_SLOT];
  if (!weapon?.getDefinition?.()?.getName?.()?.toLowerCase?.().includes("crossbow")) {
    return "You need a crossbow equipped to do that.";
  }
  if (items[Equipment.AMMUNITION_SLOT]?.getId?.() !== ItemIds.MITH_GRAPPLE_2) {
    return "You need a mithril grapple tipped bolt with a rope to do that.";
  }
  return null;
}

/** Taverley Dungeon's floor spikes: run up, leap over, and land on the far side. */
function spikeJump(from, to, { obj }, trap) {
  const east = to[0] > from[0];
  const runTo = [obj.x + (east ? -1 : 1), obj.y];
  const steps = [
    { face: [obj.x, obj.y] },
    { move: runTo, anim: Anim.RUN_UP, speed: [0, 60] },
    { anim: Anim.JUMP_HURDLE },
    { wait: 1 },
  ];
  if (trap) {
    steps.push({ hit: [1, 4] }, { msg: "You trigger the trap as you jump over it." }, { objAnim: ShortcutAnim.SPIKE_TRAP });
  }
  steps.push({ move: [east ? 2880 : 2878, 9813], speed: [0, 20] });
  return steps;
}

module.exports = [
  between({
    object: ObjectIds.CRUMBLING_WALL_3,
    level: 5,
    ends: [[2934, 3355, 0], [2936, 3355, 0]],
    cross: (from, to) => [climbOver(to, Anim.CLIMB_LOW_WALL_PYRAMID, 2)],
  }),
  between({
    object: [ObjectIds.UNDERWALL_TUNNEL, ObjectIds.UNDERWALL_TUNNEL_2],
    level: 26,
    ends: [[2948, 3309, 0], [2948, 3313, 0]],
    cross: (from, to) => tunnel(to, 150),
  }),
  between({
    object: ObjectIds.CREVICE_18,
    level: 42,
    ends: [[3028, 9806, 0], [3035, 9806, 0]],
    end: "You climb your way through the narrow crevice.",
    cross: (from, to) => (to[0] > from[0]
      ? crevice([3029, 9806], [3034, 9806], to)
      : crevice([3034, 9806], [3029, 9806], to)),
  }),
  ...GRAPPLES.map(({ at, route, walkway, level }) => ({
    object: GRAPPLE_WALLS,
    at,
    level,
    xp: 0,
    route,
    precondition: grappleReady,
    steps: [
      { face: [at[0], at[1]] },
      { anim: ShortcutAnim.FIRE_GRAPPLE },
      { gfx: ShortcutAnim.GRAPPLE_GRAPHIC },
      { wait: 11 },
      { anim: -1 },
      { wait: 1 },
      { tele: walkway },
    ],
  })),
  ...WALL_DROPS.map(({ at, landing }) => ({
    object: JUMP_DOWN_WALLS,
    at,
    level: 1,
    xp: 0,
    steps: [{ anim: Anim.LEAP }, { wait: 1 }, { anim: Anim.LAND }, { tele: landing }],
  })),
  {
    // Taverley's tight gap in the wall between Falador and Burthorpe.
    object: ObjectIds.TIGHT_GAP,
    level: 1,
    xp: 0,
    steps: ({ obj }) => (obj.x === 2928 && obj.y === 3521
      ? [
        { anim: Anim.LEDGE_STEP_OFF },
        { render: Anim.LEDGE_WALK_BACK },
        { walk: [[2928, 3521], [2927, 3522], [2926, 3522]] },
        { render: null },
        { anim: ShortcutAnim.LEDGE_FINISH },
      ]
      : [
        { anim: Anim.LEDGE_TURN },
        { render: Anim.LEDGE_WALK },
        { walk: [[2927, 3522], [2928, 3521], [2928, 3520]] },
        { render: null },
        { anim: Anim.LEDGE_TURN_BACK },
      ]),
  },
  {
    // Taverley Dungeon: the rock up to (and down from) the blue dragon ledge.
    object: [ObjectIds.ROCKS, ObjectIds.ROCKS_67],
    level: 70,
    xp: 0,
    steps: ({ pos, obj }) => (pos.z === 0
      ? [jump([obj.x, obj.y]), { anim: Anim.JUMP_SHORT }, { wait: 1 }, { anim: Anim.LAND }, { tele: [2888, 9823, 1] }]
      : [{ anim: Anim.LEAP }, { wait: 1 }, { anim: Anim.LAND }, { tele: [2887, 9823, 0] }, { wait: 1 }, jump([2886, 9823])]),
  },
  between({
    object: ObjectIds.OBSTACLE_PIPE_5,
    level: 70,
    xp: 10,
    ends: [[2886, 9799, 0], [2892, 9799, 0]],
    cross: (from, to) => pipe([2889, 9799], to),
  }),
  {
    // Taverley Dungeon loose railing: squeeze between the railing tile and the tile east of it.
    object: ObjectIds.LOOSE_RAILING_4,
    level: 30,
    xp: 0,
    steps: ({ pos, obj }) => {
      const onRailing = pos.x === obj.x && pos.y === obj.y;
      return [{ move: onRailing ? [2936, 9810] : [obj.x, obj.y], anim: ShortcutAnim.SQUEEZE_RAILING, speed: [0, 60], ticks: 2 }];
    },
  },
  between({
    object: ObjectIds.STRANGE_FLOOR,
    level: 80,
    xp: 12.5,
    ends: [[2876, 9813, 0], [2882, 9813, 0]],
    end: "You make the jump easily.",
    cross: (from, to, context) => spikeJump(from, to, context, false),
    fail: {
      baseChance: 50,
      neverFailLevel: 95,
      xp: 0,
      steps: (context) => {
        const [from, to] = [[context.pos.x, context.pos.y], context.pos.x < context.obj.x ? [2882, 9813] : [2876, 9813]];
        return spikeJump(from, to, context, true);
      },
    },
  }),
  between({
    object: [ObjectIds.CREVICE_7, ObjectIds.CREVICE_8],
    level: 67,
    ends: [[2898, 9902, 0], [2915, 9894, 0]],
    end: "You climb your way through the narrow crevice.",
    cross: (from, to) => (to[0] > from[0]
      ? crevice([2899, 9901], [2914, 9895], to, 11)
      : crevice([2914, 9895], [2899, 9901], to, 11)),
  }),
  between({
    object: ObjectIds.DARK_TUNNEL_2,
    level: 54,
    ends: [[3759, 5670, 0], [3765, 5671, 0]],
    end: "You climb your way through the dark tunnel.",
    cross: (from, to) => [{ anim: ShortcutAnim.DARK_TUNNEL }, { wait: 1 }, { tele: to }],
  }),
];
