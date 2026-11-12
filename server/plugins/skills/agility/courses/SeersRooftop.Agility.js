const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../Constants.Agility");
const { leap, gapJump, wallScramble, hurt } = require("../Steps.Agility");

/**
 * Seers' Village Rooftop. Steps, sounds, tiles and ticks follow the rsprox captures of the main
 * game, rev 241 and 242 (20261109T090342-d73fc6a, 20261110T020354-d73fc6a,
 * 20261110T221217-d73fc6a and 13 more: about 1,000 laps at Agility 60-70). XP per obstacle is the
 * Wiki's (course and Gap pages agree), and the captured `helper_agility_add_xp` amounts match it,
 * adding up to the 570 lap with no bonus.
 */
const TIGHTROPE_SOUND = 2495;
/** A failure (as captured): the stumble's sound, the thud of the landing and the hurt, 20 cycles in. */
const STUMBLE_SOUND = 2493;
const LAND_SOUND = 2455;
const FALL_LANDING = 1332;

/**
 * The tightrope as captured: onto the rope a tick after starting, two tiles the next tick (sent
 * as a run step), then a tile a tick, the rope creaking on the two-tile step and four tiles on.
 * The XP comes on the last tile, 2710,3480, a step off the rope.
 */
function tightrope() {
  return [
    { wait: 1 },
    { walk: [[2710, 3489]] },
    { sound: TIGHTROPE_SOUND, loops: 3 },
    { walk: [[2710, 3487]], tilesPerTick: 2 },
    { walk: [[2710, 3484]] },
    { sound: TIGHTROPE_SOUND, loops: 2 },
    { walk: [[2710, 3480]], arrive: true },
  ];
}

/**
 * The tightrope failed (97 of 1,026 captured): as far as 2710,3484, a stumble (764, sound 2493)
 * the next tick and the ground below, 2710,3484,0, the tick after, with no message or XP.
 */
function fallOffTightrope() {
  return [
    { wait: 1 },
    { walk: [[2710, 3489]] },
    { sound: TIGHTROPE_SOUND, loops: 3 },
    { walk: [[2710, 3487]], tilesPerTick: 2 },
    { walk: [[2710, 3484]] },
    { anim: Anim.BALANCE_FALL },
    { sound: STUMBLE_SOUND, loops: 10 },
    { wait: 1 },
    { tele: [2710, 3484, 0] },
    { anim: -1 },
    { sound: LAND_SOUND },
    hurt(),
    // Captured: 4 at 36-39 Hitpoints, 5 at 40-53, 6 at 61-79, 7 at 80-89 (97 falls).
    { hit: { percent: 5, plus: 3 } },
  ];
}

/** Gap 1's first jump, onto the lower roof (2719,3495,2), the same whether the second one fails. */
function firstGapJump() {
  return leap([2719, 3495, 2], { face: [2718, 3495], windup: 1, aim: 1 });
}

module.exports = {
  key: "seers",
  name: "Seers' Village Rooftop",
  helper: 15, // the Agility helper's course (enum 3507: "Seers' Village Rooftops")
  lapXp: 570,
  petBase: 35205, // Giant squirrel base chance (Wiki)
  // Kandarin Diary hard: "Complete a lap of the Seers' Village agility course."
  diaryTask: {
    diary: "kandarin",
    task: "complete-a-lap-of-the-seers-village-agility-cour",
  },
  // The Kandarin diary rerolls a miss: 5%, 10% or 15% for its easy, medium or hard tier (Wiki: Mark of Grace).
  marks: {
    level: 60,
    rerolls: [
      { diary: "kandarin", tier: "hard", chance: 0.15 },
      { diary: "kandarin", tier: "medium", chance: 0.1 },
      { diary: "kandarin", tier: "easy", chance: 0.05 },
    ],
    // The five spots, as captured (91 marks): the first roof, both ends of the roof before the
    // tightrope, the tightrope's end and the roof before the edge. The Wiki's map puts three of
    // them a tile off (2727,3498; 2707,3493; 2710,3493).
    tiles: [[2727, 3493, 3], [2706, 3493, 2], [2709, 3493, 2], [2712, 3481, 2], [2698, 3465, 2]],
  },
  obstacles: [
    {
      object: ObjectIds.WALL_15,
      index: 1,
      level: 60,
      xp: 45,
      // Both lines are spam, with the climb and the grab (as captured).
      steps: [
        { wait: 1 },
        { msg: { spam: "You climb up the wall..." } },
        { face: [2729, 3492] },
        { anim: Anim.CLIMB_WALL, delay: 15 },
        { wait: 2 },
        { msg: { spam: "...jump, and grab hold of the sign!" } },
        { tele: [2729, 3488, 1] },
        { anim: Anim.HANG },
        { wait: 2 },
        { anim: -1 },
        { tele: [2729, 3491, 3] },
      ],
    },
    {
      object: ObjectIds.GAP_27,
      index: 2,
      level: 60,
      xp: 20,
      route: [2721, 3494, 3],
      // Two jumps: onto the lower roof, then on to 2713,3494; the XP a tick after the second.
      steps: [...firstGapJump(), ...leap([2713, 3494, 2], { windup: 1, settle: 1 })],
      // Wiki: can fail until 79. 53 of 1,079 captured: the second jump lands on the ground,
      // 2715,3494,0, on one knee. low/high are fitted to the captured rate at 60-70 with the
      // Wiki's 79. Damage as captured: 5 at 36-42 Hitpoints, 6 at 43-56, 7 at 59-70, 8 at 72-85,
      // 9 at 86-89 (53 falls).
      fail: {
        xp: 0,
        low: 182,
        high: 274,
        steps: () => [
          ...firstGapJump(),
          ...leap([2715, 3494, 0], { windup: 1, land: FALL_LANDING }),
          { sound: LAND_SOUND },
          hurt(),
          { hit: { percent: 7, plus: 3 } },
        ],
      },
    },
    {
      object: ObjectIds.TIGHTROPE_9,
      index: 3,
      level: 60,
      xp: 20,
      route: [2710, 3490, 2],
      render: Anim.BALANCE_WALK,
      steps: tightrope,
      // Wiki: can fail until 79. low/high are fitted to the captured rate at 60-70 with the
      // Wiki's 79.
      fail: { xp: 0, low: 114, high: 292, steps: fallOffTightrope },
    },
    {
      object: ObjectIds.GAP_28,
      index: 4,
      level: 60,
      xp: 35,
      // A jump up the wall three tiles south (2583, sound 2468), the grab on the roof above a tick
      // later and the pull up two tiles on, from wherever along it the player stands (as captured:
      // 2710 and 2712).
      steps: ({ pos }) => wallScramble([pos.x, pos.y - 3, 3], [pos.x, pos.y - 5, 3], "south"),
    },
    {
      object: ObjectIds.GAP_29,
      index: 5,
      level: 60,
      xp: 15,
      route: [2702, 3470, 3],
      // The player turns south again as they land (as captured).
      steps: [...leap([2702, 3465, 2], { face: [2702, 3468], windup: 1, aim: 1 }), { face: [2702, 3464] }, { wait: 1 }],
    },
    {
      object: ObjectIds.EDGE_3,
      index: 6,
      level: 60,
      xp: 435,
      route: [2702, 3464, 2],
      steps: gapJump([2704, 3464, 0], { face: [2706, 3464] }),
    },
  ],
};
