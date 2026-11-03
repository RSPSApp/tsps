/**
 * Ape Atoll Agility Course (Wiki): 48 Agility that a boost can't make up, Monkey Madness I
 * started, and the player a small or medium ninja monkey or Kruk (Greegrees.plugin.js answers
 * "greegree:form"). A lap is the stepping stone, the tropical tree, the monkeybars, the skull
 * slope, the rope and the second tropical tree, whose vines slide back towards the start:
 * 580 XP. From 75 Agility (boosts count) nothing fails; the stepping stone and the second tree
 * never fail (15 May 2024). A fall drops the player at the course entrance by the signpost,
 * except the rope, which drops a monkey by the first tree.
 *
 * As a human every obstacle fails, each with its own line (the obstacles' Wiki pages); as any
 * other monkey it refuses ("Only the stealthiest and most agile monkey can use this!"). No capture
 * exists: the movement, timings, fail damage and landing tiles are guesses from the cache's
 * placements and the monkey animations' lengths (docs/agility-courses.md).
 */
const Loc = Object.freeze({
  STEPPING_STONE: 15412, // 100_ilm_stepping_stone
  TROPICAL_TREE: 15414, // 100_ilm_climbable_tree
  MONKEYBARS: 15417, // 100_ilm_monkeybars_start
  SKULL_SLOPE: 1747, // 100_ilm_cliff_climb_1
  ROPE: 15487, // 100_ilm_rope_swing
  VINE_TREE: 16062, // 100_ilm_agility_tree_base
});

/** Ninja monkey seqs (cache gamevals 100_ilm_*); lengths in client cycles. */
const Seq = Object.freeze({
  STEPPING_STONE_JUMP: 3480, // 36
  MONKEYBAR_JUMP_UP: 3482, // 49
  MONKEYBAR_MOVE: 3483, // 44
  MONKEYBAR_JUMP_DOWN: 3484, // 45
  CLIMB_SLOPE: 3485, // looping
  SLOPE_FAIL_SLIDE_BACK: 3486, // 45
  CLIMB_TREE: 3487, // 94
  VINE_SWING: 3488, // 67
  CLIMB_TREE_FAIL: 3492, // 148
  FALLING: 3493, // 24
  DOWN_VINE: 3494, // 54
  HUMAN_STUMBLE_BACK: 846, // human_stumble_back
});

const LEVEL = 48;
const NEVER_FAIL_LEVEL = 75;
const FALL_DAMAGE = [1, 3];
/** The course entrance by the signpost (16104 at 2758,2746). */
const ENTRANCE = [2757, 2745, 0];
const STONE_START = [2755, 2742, 0];
const FIRST_TREE_FOOT = [2753, 2742, 0];

const AGILE_FORMS = new Set(["small-ninja-monkey", "medium-ninja-monkey", "kruk"]);
const NOT_MONKEY_ENOUGH = "...you're not monkey enough to try this!";
/** A human's slip off each obstacle (Wiki: the obstacles' pages). */
const HumanSlip = Object.freeze({
  STEPPING_STONE: `The rock is covered in slime and you slip into the water... ${NOT_MONKEY_ENOUGH}`,
  TROPICAL_TREE: `You reach for the tree trunk and lose your footing... ${NOT_MONKEY_ENOUGH}`,
  MONKEYBARS: `Your hands slip from the rung... ${NOT_MONKEY_ENOUGH}`,
  SKULL_SLOPE: `The hand holds are too small to hold onto... ${NOT_MONKEY_ENOUGH}`,
  ROPE: `You lose your grip on the vine! ${NOT_MONKEY_ENOUGH}`,
  VINE_TREE: "You jump up to seize the vine... ...and lose your grip!",
});
const WRONG_MONKEY = "Only the stealthiest and most agile monkey can use this!";
const BOOST_REFUSAL = "Your Agility boost won't help you here.";
const PET_REFUSAL = "Your little friend can't make it over the obstacle...";

function monkeyForm({ api, player }) {
  const request = { player, form: null };
  api.emitCustomEvent("greegree:form", request);
  return request.form;
}

/** A monkey of the wrong kind is turned away; a human tries, and slips (forceFail). */
function agileMonkeyOnly(context) {
  const { player, core } = context;
  if (player.getSkillManager().getMaxLevel(core.Skill.AGILITY) < LEVEL) return BOOST_REFUSAL;
  const form = monkeyForm(context);
  return form && !AGILE_FORMS.has(form) ? WRONG_MONKEY : null;
}

function hasPet({ api, player }) {
  const request = { player, pet: null };
  api.emitCustomEvent("pets:current", request);
  return request.pet != null;
}

/** The human's slip: a stumble and a knock, and on the rope a drop back to the stepping stone. */
function humanSlip(message, landing = null) {
  return (context) => (monkeyForm(context) ? null : {
    steps: [
      { msg: message },
      { anim: Seq.HUMAN_STUMBLE_BACK },
      { wait: 1 },
      ...(landing ? [{ tele: landing }] : []),
      { hit: FALL_DAMAGE },
    ],
  });
}

/** A monkey's fall below 75 Agility. */
function monkeyFall(anim, ticks, landing = ENTRANCE) {
  return {
    neverFailLevel: NEVER_FAIL_LEVEL,
    steps: [
      { anim },
      { wait: ticks },
      { tele: landing },
      { anim: -1 },
      { hit: FALL_DAMAGE },
    ],
  };
}

function obstacle({ humanMessage, humanLanding, ...entry }) {
  return {
    level: LEVEL,
    precondition: agileMonkeyOnly,
    forceFail: humanSlip(humanMessage, humanLanding),
    ...entry,
  };
}

/** Swinging west along the bars over 2752..2748, then dropping to the foot of the skull slope. */
function monkeybars() {
  const bars = [2752, 2751, 2750, 2749, 2748].map((x) => (
    { move: [x, 2741, 2], anim: Seq.MONKEYBAR_MOVE, speed: [0, 30], dir: "west", ticks: 1 }
  ));
  return [
    { faceDir: "west" },
    { anim: Seq.MONKEYBAR_JUMP_UP },
    { wait: 1 },
    ...bars,
    { move: [2747, 2741, 2], anim: Seq.MONKEYBAR_JUMP_DOWN, speed: [0, 30], dir: "west", ticks: 1 },
    { tele: [2747, 2741, 0] },
    { anim: -1 },
  ];
}

module.exports = {
  key: "ape-atoll",
  name: "Ape Atoll Agility",
  helper: 11, // the Agility helper's course (enum 3507: "Ape Atoll Agility Course")
  lapXp: 580,
  petBase: 37720, // Giant squirrel base chance (Wiki)
  // A lap is the Western Provinces diary's hard task (Wiki: Ape Atoll Agility Course).
  diaryTask: {
    diary: "western",
    task: "complete-a-lap-of-the-ape-atoll-agility-course",
  },
  // 5-6 marks an hour at 95 laps an hour (Wiki). The Wiki gives no roll chance; with the 3-minute
  // cooldown, 2/25 a lap makes 60 / (3 + (60 / 95) / (2 / 25)) = 5.5 an hour.
  marks: {
    level: LEVEL,
    chance: 2 / 25,
    tiles: [[2744, 2738, 0], [2748, 2733, 0], [2760, 2748, 0]],
  },
  obstacles: [
    obstacle({
      object: Loc.STEPPING_STONE,
      index: 1,
      humanMessage: HumanSlip.STEPPING_STONE,
      xp: 40,
      route: STONE_START,
      steps: [
        { faceDir: "west" },
        { move: [2754, 2742, 0], anim: Seq.STEPPING_STONE_JUMP, speed: [12, 34], dir: "west", ticks: 1 },
        { move: FIRST_TREE_FOOT, anim: Seq.STEPPING_STONE_JUMP, speed: [12, 34], dir: "west", ticks: 1 },
      ],
    }),
    obstacle({
      object: Loc.TROPICAL_TREE,
      index: 2,
      humanMessage: HumanSlip.TROPICAL_TREE,
      xp: 40,
      route: FIRST_TREE_FOOT,
      steps: [
        { face: [2753, 2741] },
        { anim: Seq.CLIMB_TREE },
        { wait: 3 },
        { tele: [2753, 2741, 2] },
        { anim: -1 },
      ],
      fail: monkeyFall(Seq.CLIMB_TREE_FAIL, 4),
    }),
    obstacle({
      object: Loc.MONKEYBARS,
      index: 3,
      humanMessage: HumanSlip.MONKEYBARS,
      xp: 40,
      route: [2753, 2741, 2],
      humanLanding: ENTRANCE,
      steps: monkeybars(),
      fail: monkeyFall(Seq.FALLING, 1),
    }),
    obstacle({
      object: Loc.SKULL_SLOPE,
      index: 4,
      humanMessage: HumanSlip.SKULL_SLOPE,
      xp: 60,
      route: [2747, 2741, 0],
      steps: [
        { faceDir: "west" },
        { render: Seq.CLIMB_SLOPE },
        { walk: [[2746, 2741], [2745, 2741], [2744, 2741], [2743, 2741], [2742, 2741]] },
        { render: null },
      ],
      fail: monkeyFall(Seq.SLOPE_FAIL_SLIDE_BACK, 2),
    }),
    obstacle({
      object: Loc.ROPE,
      index: 5,
      xp: 100,
      route: [2751, 2731, 0],
      precondition: (context) => agileMonkeyOnly(context) ?? (hasPet(context) ? PET_REFUSAL : null),
      forceFail: humanSlip(HumanSlip.ROPE, STONE_START),
      steps: [
        { faceDir: "east" },
        { move: [2756, 2731, 0], anim: Seq.VINE_SWING, speed: [15, 60], dir: "east", ticks: 2 },
        { anim: -1 },
      ],
      fail: monkeyFall(Seq.FALLING, 1, FIRST_TREE_FOOT),
    }),
    obstacle({
      object: Loc.VINE_TREE,
      index: 6,
      humanMessage: HumanSlip.VINE_TREE,
      xp: 0,
      route: [2757, 2733, 0],
      humanLanding: ENTRANCE,
      // Up the tree, then down its vines (16066 on plane 1) to their end at 2770,2747.
      steps: [
        { face: [2757, 2734] },
        { anim: Seq.CLIMB_TREE },
        { wait: 3 },
        { tele: [2758, 2735, 1] },
        { move: [2770, 2747, 1], anim: Seq.DOWN_VINE, speed: [0, 90], dir: "north", ticks: 3 },
        { tele: [2770, 2747, 0] },
        { anim: -1 },
      ],
    }),
  ],
};
