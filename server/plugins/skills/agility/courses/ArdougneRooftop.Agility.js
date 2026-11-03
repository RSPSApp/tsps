const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../Constants.Agility");
const { faceLoc, JUMP_DOWN_SOUND } = require("../Steps.Agility");

/**
 * Ardougne Rooftop. Steps, tiles, sounds and ticks follow rsprox capture 787 (a Grid Master world,
 * rev 234, 19 laps, no failures; no main-game recording). XP is the Wiki's; the capture's
 * `helper_agility_add_xp` values are the same obstacle XP times one multiplier (18.75), the last
 * gap's included (625).
 */
const TIGHTROPE_SOUND = 2495;
const SIDESTEP_SOUND = 2451;
const SPOT_JUMP_SOUND = 2461;

/** A jump off a roof `jump`, landing on `destination` a tick later. */
function hop(destination, jump = Anim.LEAP) {
  return [
    { anim: jump, delay: 15 },
    { sound: JUMP_DOWN_SOUND, delay: 15 },
    { wait: 1 },
    { tele: destination },
    { anim: Anim.LAND },
  ];
}

module.exports = {
  key: "ardougne",
  name: "Ardougne Rooftop",
  helper: 20, // the Agility helper's course (enum 3507: "Ardougne Rooftops")
  lapXp: 889,
  petBase: 34440, // Giant squirrel base chance (Wiki)
  // Ardougne Diary elite: "Complete a lap of Ardougne's rooftop agility course."
  diaryTask: {
    diary: "ardougne",
    task: "complete-a-lap-of-ardougne-s-rooftop-agility-cou",
  },
  // 2/3 a lap; the elite diary rerolls a miss at 25%, and half its cooldowns are 2 minutes
  // (Wiki: Mark of Grace). One tile (Wiki; every mark in capture 787 spawned there).
  marks: {
    level: 90,
    chance: 2 / 3,
    rerolls: [{ diary: "ardougne", tier: "elite", chance: 0.25 }],
    shortCooldown: [{ diary: "ardougne", tier: "elite", chance: 0.5 }],
    tiles: [[2657, 3318, 3]],
  },
  obstacles: [
    {
      object: ObjectIds.WOODEN_BEAMS,
      index: 1,
      level: 90,
      xp: 43,
      // The climb a tick after arriving, a plane a tick, on the roof the fourth tick; XP the tick after.
      steps: (context) => [
        faceLoc(context.obj),
        { wait: 1 },
        { anim: Anim.CLIMB_WALL, delay: 15 },
        { wait: 1 },
        { tele: [2673, 3298, 1] },
        { anim: Anim.CLIMB_WALL },
        { wait: 1 },
        { tele: [2673, 3298, 2] },
        { anim: Anim.CLIMB_WALL },
        { wait: 1 },
        { tele: [2671, 3299, 3] },
        { anim: Anim.LAND },
        { wait: 1 },
      ],
    },
    {
      object: ObjectIds.GAP_34,
      index: 2,
      level: 90,
      xp: 65,
      // Three jumps two ticks apart, the first two ticks after arriving; XP the tick after the last.
      steps: (context) => [
        faceLoc(context.obj),
        { wait: 1 },
        { face: [2667, 3311] },
        { wait: 1 },
        ...hop([2667, 3311, 1]),
        { face: [2665, 3315] },
        { wait: 1 },
        ...hop([2665, 3315, 1]),
        { wait: 1 },
        ...hop([2665, 3318, 3], Anim.JUMP_SHORT),
        { wait: 1 },
      ],
    },
    {
      object: ObjectIds.PLANK_12,
      index: 3,
      level: 90,
      xp: 50,
      route: [2662, 3318, 3],
      // Onto the plank two ticks after arriving, a tile a tick to 2656,3318; XP the tick after.
      steps: [
        { faceDir: "west" },
        { wait: 2 },
        { render: Anim.BALANCE_WALK },
        { sound: TIGHTROPE_SOUND, loops: 4 },
        { walk: [[2656, 3318]], arrive: true },
        { render: null },
        { wait: 1 },
      ],
    },
    {
      object: ObjectIds.GAP_35,
      index: 4,
      level: 90,
      xp: 21,
      route: [2654, 3318, 3],
      steps: (context) => [
        faceLoc(context.obj),
        { wait: 1 },
        { face: [2653, 3314] },
        ...hop([2653, 3314, 3]),
        { wait: 1 },
      ],
    },
    {
      object: ObjectIds.GAP_36,
      index: 5,
      level: 90,
      xp: 28,
      route: [2653, 3310, 3],
      steps: (context) => [
        faceLoc(context.obj),
        { wait: 1 },
        { face: [2651, 3309] },
        { wait: 1 },
        ...hop([2651, 3309, 3], Anim.JUMP_ACROSS),
        { wait: 1 },
      ],
    },
    {
      object: ObjectIds.STEEP_ROOF,
      index: 6,
      level: 90,
      xp: 57,
      route: [2653, 3300, 3],
      precondition: ({ pos }) => (pos.x === 2654 && pos.y === 3299 ? "You can't go back from here." : null),
      // Side-steps along the roof from the tick after arriving to 2656,3297, off it two ticks later.
      steps: [
        { faceDir: "east" },
        { wait: 1 },
        { anim: Anim.LEDGE_TURN },
        { render: Anim.LEDGE_WALK },
        { walk: [[2654, 3299]] },
        { sound: SIDESTEP_SOUND, loops: 3 },
        { walk: [[2656, 3297]] },
        { wait: 1 },
        { render: null },
        { anim: Anim.LEDGE_TURN_BACK },
      ],
    },
    {
      object: ObjectIds.GAP_37,
      index: 7,
      level: 90,
      xp: 625,
      // Down onto the roof below, three tiles east, a jump to 2663,3297, three tiles, a jump to
      // 2667,3297 and off the edge to the ground; the lap the tick after landing.
      steps: [
        { faceDir: "east" },
        ...hop([2658, 3298, 1]),
        { wait: 2 },
        { walk: [[2661, 3298]] },
        { wait: 2 },
        { sound: SPOT_JUMP_SOUND },
        { move: [2663, 3297], anim: Anim.JUMP, speed: [15, 30], dir: "east" },
        { walk: [[2666, 3297]] },
        { wait: 2 },
        { sound: SPOT_JUMP_SOUND },
        { move: [2667, 3297], anim: Anim.JUMP, speed: [15, 30], dir: "east" },
        { anim: Anim.LEAP },
        { sound: JUMP_DOWN_SOUND },
        { wait: 1 },
        { tele: [2668, 3297, 0] },
        { anim: Anim.LAND },
        { wait: 1 },
      ],
    },
  ],
};
