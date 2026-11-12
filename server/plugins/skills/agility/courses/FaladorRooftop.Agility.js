const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../Constants.Agility");
const { faceLoc, hurt, JUMP_DOWN_SOUND, WALL_JUMP_SOUND } = require("../Steps.Agility");

/**
 * Falador Rooftop. Steps, sounds, tiles and ticks follow the rsprox captures of the main game,
 * rev 241 and 242 (20261027T185126-57eba26, 20261025T151131-d73fc6a, 20261106T135636-57eba26 and
 * 10 more: about 330 laps at Agility 54-59). XP per obstacle is what the captures'
 * `helper_agility_add_xp` sends, in tenths, adding up to the Wiki's 586 lap with no bonus; the
 * Wiki's course table rounds them (11/22/61/27/26/61/53/30/14/13/13/14/241).
 */
const TIGHTROPE_SOUND = 2495;
const JUMP_SOUND = 2461;
const HOLD_SOUND = 2459;
const LAND_SOUND = 2455;
/** The slide along the third rope (deathslide_first). */
const SLIDE_SOUND = 1934;
const FALL_LANDING = 1332;
/** The roll along the third rope (human_walk_logbalance_loop). */
const ROPE_ROLL = 7134;

/** The jump up to the first hand hold (2583, sound 2468), on 3050,3351 a tick later. */
function handHoldJump() {
  return [
    { wait: 1 },
    { sound: WALL_JUMP_SOUND, delay: 20 },
    { move: [3050, 3351, 3], anim: Anim.JUMP_SHORT, delay: 20, speed: [25, 30], dir: "north" },
  ];
}

/**
 * The hand holds as captured: the jump, then hanging on 3050,3351,2 (1118, sound 2459) a tick
 * later; a tick on, round the corner (drawn to 3050,3352, the player on 3051,3352); then three
 * holds north, two ticks apart, and the drop onto the roof (1120) at 3050,3357, back up on plane
 * 3 two ticks after that with the XP. The holds face west, towards the wall.
 */
function handHolds() {
  const steps = [
    ...handHoldJump(),
    { tele: [3050, 3351, 2] },
    { anim: Anim.HANG },
    { sound: HOLD_SOUND, delay: 35 },
    { wait: 1 },
    { move: [3050, 3352], speed: [13, 22], dir: "west", ticks: 0 },
    { wait: 1 },
    { tele: [3051, 3352, 2] },
  ];
  for (const y of [3353, 3354, 3355]) {
    steps.push({ sound: HOLD_SOUND, delay: 35 }, { move: [3051, y], anim: Anim.HANG, speed: [34, 52], dir: "west", ticks: 2 });
  }
  steps.push(
    { sound: HOLD_SOUND, delay: 35 },
    { move: [3050, 3357], anim: Anim.HANG_DROP, speed: [34, 60], dir: "west", ticks: 2 },
    { tele: [3050, 3357, 3] },
  );
  return steps;
}

/**
 * The hand holds failed (11 of 336 captured): the jump, then on the ground below, 3050,3351,0, a
 * tick later on one knee, with no message or XP. Damage as captured: 7 at 80-81 Hitpoints, 8 at
 * 89; floor(HP x 7%) + 2 fits them and the Wiki's 3-8.
 */
function fallOffHandHolds() {
  return [
    ...handHoldJump(),
    { tele: [3050, 3351, 0] },
    { anim: FALL_LANDING },
    { sound: LAND_SOUND },
    hurt(),
    { hit: { percent: 7, plus: 2 } },
  ];
}

/**
 * A tightrope: onto it a tick after starting, a tile a tick, the creak (2495, `loops`) with the
 * second tile, and the XP with the last, a step off the rope.
 */
function tightrope(object, index, route, path, loops, xp) {
  return {
    object,
    index,
    level: 50,
    xp,
    route,
    render: Anim.BALANCE_WALK,
    steps: [
      { wait: 1 },
      { walk: [path[0]] },
      { sound: TIGHTROPE_SOUND, loops },
      { walk: path.slice(1), arrive: true },
    ],
  };
}

/**
 * A jump (741 for the gaps, 1603 for the ledges, sound 2461) to `dx`/`dy` tiles from the player,
 * landing a tick later with the XP. `dir` is the way they face; the ledges after the third rope
 * are jumped from wherever along them the player stands (as captured).
 */
function jump(object, index, dx, dy, dir, xp, { anim = Anim.JUMP_HURDLE, route = null } = {}) {
  return {
    object,
    index,
    level: 50,
    xp,
    ...(route ? { route } : {}),
    steps: ({ pos }) => [
      { wait: 1 },
      { sound: JUMP_SOUND },
      { move: [pos.x + dx, pos.y + dy, 3], anim, speed: [15, 30], dir },
    ],
  };
}

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
    // The Wiki's spawn map (Template:Mark of grace spawns), every one captured (108 marks).
    tiles: [[3045, 3345, 3], [3049, 3357, 3], [3019, 3345, 3], [3013, 3345, 3], [3015, 3333, 3]],
  },
  obstacles: [
    {
      object: ObjectIds.ROUGH_WALL_4,
      index: 1,
      level: 50,
      xp: 10.7,
      route: [3036, 3341, 0],
      // Facing the wall, the climb (828) a tick after starting; on the roof two ticks later.
      steps: (context) => [
        { wait: 1 },
        faceLoc(context.obj),
        { anim: Anim.CLIMB_UP, delay: 15 },
        { wait: 2 },
        { tele: [3036, 3342, 3] },
      ],
    },
    tightrope(ObjectIds.TIGHTROPE_6, 2, [3039, 3343, 3], [[3040, 3343], [3047, 3343], [3047, 3344]], 5, 22.7),
    {
      object: ObjectIds.HAND_HOLDS_4,
      index: 3,
      level: 50,
      xp: 60.3,
      route: [3050, 3349, 3],
      keepAnimation: true,
      steps: handHolds,
      // Wiki: can fail until 66. low/high are fitted to the captured rate at 54-59 with the
      // Wiki's 66.
      fail: { xp: 0, low: 198, high: 284, steps: fallOffHandHolds },
    },
    jump(ObjectIds.GAP_15, 4, 0, 3, "north", 26.8, { anim: Anim.JUMP, route: [3048, 3358, 3] }),
    jump(ObjectIds.GAP_16, 5, -4, 0, "west", 26.8, { anim: Anim.JUMP, route: [3045, 3361, 3] }),
    // The diagonal rope: west, then south-west to 3028,3356 and south off it (as captured).
    tightrope(ObjectIds.TIGHTROPE_7, 6, [3035, 3361, 3], [[3034, 3361], [3033, 3361], [3028, 3356], [3028, 3354]], 4, 60.3),
    {
      object: ObjectIds.TIGHTROPE_8,
      index: 7,
      level: 50,
      xp: 53.6,
      route: [3027, 3353, 3],
      // Onto the rope a tick after starting, rolled along it to 3021,3353 (7134, sound 1934) over
      // three ticks, then a step off with a thud (2455) and the XP.
      steps: [
        { wait: 1 },
        { walk: [[3026, 3353]] },
        { sound: SLIDE_SOUND, delay: 5 },
        { move: [3021, 3353], anim: ROPE_ROLL, speed: [0, 89], dir: "west", ticks: 3 },
        { anim: -1 },
        { sound: LAND_SOUND },
        { walk: [[3020, 3353]], arrive: true },
      ],
    },
    jump(ObjectIds.GAP_26, 8, 0, -4, "south", 30, { route: [3018, 3353, 3] }),
    jump(ObjectIds.LEDGE_7, 9, -2, 0, "west", 13.4),
    jump(ObjectIds.LEDGE_13, 10, 0, -2, "south", 13.4, { route: [3013, 3344, 3] }),
    // Ours: the ledge beside it (14922, at 3012,3334) is never taken in the captures, which all
    // jump 14923; this keeps the older guess of a hop two tiles south.
    jump(ObjectIds.LEDGE_14, 11, 0, -2, "south", 13.4),
    jump(ObjectIds.LEDGE_15, 11, 2, -1, "east", 13.4, { route: [3013, 3335, 3] }),
    jump(ObjectIds.LEDGE_16, 12, 2, 0, "east", 13.4),
    {
      object: ObjectIds.EDGE_2,
      index: 13,
      level: 50,
      xp: 241.2,
      keepAnimation: true,
      // A hurdle three tiles east, the jump down (2586, sound 2462) the tick it lands, and on the
      // ground two tiles on a tick later, with the XP and the lap; the obstacle ends the tick after.
      steps: ({ pos }) => [
        { wait: 1 },
        { sound: JUMP_SOUND },
        { move: [pos.x + 3, pos.y, 3], anim: Anim.JUMP_HURDLE, speed: [15, 30], dir: "east" },
        { anim: Anim.LEAP, delay: 15 },
        { sound: JUMP_DOWN_SOUND, delay: 15 },
        { wait: 1 },
        { tele: [pos.x + 5, pos.y, 0] },
        { anim: Anim.LAND },
        { complete: true },
        { wait: 1 },
      ],
    },
  ],
};
