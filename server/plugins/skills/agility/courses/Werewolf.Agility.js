const { Anim } = require("../Constants.Agility");

/**
 * Werewolf Agility Course (Wiki): 60 Agility, under the trapdoor east of Canifis (the trapdoor,
 * the stick throw and the trainers' lines are WerewolfAgility.plugin.js). A lap is the five
 * stepping stones, three rows of hurdles, a pipe, the skull slope and the deathslide, then the
 * stick handed to the Agility Trainer at the bottom: 730 XP with the stick's 380.
 * The stones, hurdles and deathslide follow rsprox captures 1849 and 1858 (rev 227, a Leagues
 * world), as does the pipe; the skull slope's movement, the deathslide's failure and the stick's landing
 * are guesses (docs/agility-courses.md).
 */
const Loc = Object.freeze({
  STEPPING_STONE: 11643, // werewolf_steping_stone
  HURDLE_MID: 11638, // werewolf_hurdle_mid
  HURDLE_END: 11639, // werewolf_hurdle_end
  HURDLE_END_MIRROR: 11640, // werewolf_hurdle_end_mirror
  PIPE: 11657, // waa_pipe
  SKULL_SLOPE: 11641, // werewolf_skull_climb_1
  ZIP_LINE: 11644, // werewolf_slide_center
  ZIP_LINE_SIDE: 11645, // werewolf_slide_side
  ZIP_LINE_SIDE_MIRROR: 11646, // werewolf_slide_side_mirror
});
const STICK_TRAINER = 5927; // werewolf_trainer_stick
const STICK = 4179; // waa_stick
const JUMP_STONES = 1604; // human_jump_stones
const PIPE_SOUND = 2489;

/** The five stones, in order, each jumped onto from the tile before it. */
const STONES = [[3538, 9875], [3538, 9877], [3540, 9877], [3540, 9879], [3540, 9881]];
const STONE_START = [3538, 9873];
const HURDLE_ROWS = [9893, 9896, 9899];
const PIPE_XS = [3538, 3541, 3544];

function stone(index) {
  const [x, y] = STONES[index];
  const from = index === 0 ? STONE_START : STONES[index - 1];
  return {
    object: Loc.STEPPING_STONE,
    at: [x, y, 0],
    index: index + 1,
    level: 60,
    xp: 10,
    route: [from[0], from[1], 0],
    steps: [
      { sound: 2461, delay: 5 },
      { move: [x, y, 0], anim: JUMP_STONES, speed: [12, 34], ticks: 1 },
    ],
  };
}

/** Each row's three hurdles share the row's index; the player jumps two tiles north. */
function hurdles(row, index) {
  return [[Loc.HURDLE_END_MIRROR, 3537], [Loc.HURDLE_MID, 3539], [Loc.HURDLE_END, 3542]].map(([object, x]) => ({
    object,
    at: [x, row, 0],
    index,
    level: 60,
    xp: 20,
    steps: ({ pos }) => [
      { sound: 1936 },
      { move: [pos.x, row + 1, 0], anim: Anim.JUMP_HURDLE, speed: [8, 50], dir: "north", ticks: 2 },
    ],
  }));
}

/** A pipe: crawled north from the tile south of it to the far side. */
function pipe(x) {
  return {
    object: Loc.PIPE,
    at: [x, 9905, 0],
    index: 9,
    level: 60,
    xp: 15,
    route: [x, 9904, 0],
    // rsprox 1849: the crawl replays with each half, so the squeeze pose lasts the whole way.
    steps: [
      { move: [x, 9907, 0], anim: Anim.SQUEEZE_PIPE, delay: 20, speed: [24, 120], dir: "north", ticks: 4 },
      { sound: PIPE_SOUND, delay: 7 },
      { move: [x, 9910, 0], anim: Anim.SQUEEZE_PIPE, speed: [0, 80], dir: "north", ticks: 3 },
      { sound: PIPE_SOUND, delay: 10 },
    ],
  };
}

/** The deathslide, by the teeth, five tiles a tick to the bottom (rsprox 1849). */
function deathslide() {
  const slide = [];
  for (let y = 9905; y >= 9875; y -= 5) {
    slide.push({ move: [3528, y, 0], speed: [0, 30], dir: "south", ticks: 1 });
  }
  return [
    { faceDir: "south" },
    { anim: Anim.ZIPLINE_GRIP },
    { sound: 1933 },
    { msg: "You bravely cling on to the death slide by your teeth..." },
    { wait: 2 },
    { anim: Anim.ZIPLINE_SLIDE },
    { sound: 1934, delay: 15 },
    ...slide,
    { sound: 1935 },
    { move: [3528, 9873, 0], speed: [0, 15], dir: "south", ticks: 1 },
    { anim: -1 },
  ];
}

/** No helmet on the deathslide: it can't be gripped with the teeth (Wiki, Agility Trainer). */
function helmetOff({ player, core }) {
  const head = player.getEquipment().getItems()[core.Equipment.HEAD_SLOT];
  if (head && head.getId() > 0) {
    return "You need to take your headgear off before you try the Deathslide, otherwise you won't be able to get a good enough grip with your teeth.";
  }
  return null;
}

function deathslideEntry(object) {
  return {
    object,
    index: 11,
    level: 60,
    xp: 200,
    route: [3528, 9910, 0],
    precondition: helmetOff,
    steps: deathslide,
    end: "... and land safely on your feet.",
    // The Wiki gives no formula (Agility, Strength and weight all count; never failed from 80
    // Agility and Strength under 2 kg); this fails on Agility alone, partway down onto the spikes.
    fail: {
      baseChance: 70,
      neverFailLevel: 80,
      xp: 160,
      steps: [
        { anim: Anim.ZIPLINE_GRIP },
        { sound: 1933 },
        { msg: "You bravely cling on to the death slide by your teeth..." },
        { wait: 2 },
        { anim: Anim.ZIPLINE_SLIDE },
        { move: [3528, 9895, 0], speed: [0, 90], dir: "south", ticks: 3 },
        { anim: Anim.FREE_FALL },
        { wait: 1 },
        { tele: [3528, 9893, 0] },
        { hit: [10, 30] },
      ],
    },
  };
}

module.exports = {
  key: "werewolf",
  name: "Werewolf Agility",
  helper: 14, // the Agility helper's course (enum 3507: "Werewolf Agility Course")
  lapXp: 730,
  petBase: 32597, // Giant squirrel base chance (Wiki)
  obstacles: [
    ...STONES.map((_, index) => stone(index)),
    ...HURDLE_ROWS.flatMap((row, i) => hurdles(row, 6 + i)),
    ...PIPE_XS.map(pipe),
    {
      object: Loc.SKULL_SLOPE,
      index: 10,
      level: 60,
      xp: 25,
      steps: ({ pos }) => [
        { sound: 2454, loops: 4, delay: 10 },
        { move: [3530, pos.y, 0], anim: Anim.CLIMB_ROCKS, speed: [0, 90], dir: "west", ticks: 3 },
        { anim: -1 },
      ],
    },
    deathslideEntry(Loc.ZIP_LINE),
    deathslideEntry(Loc.ZIP_LINE_SIDE),
    deathslideEntry(Loc.ZIP_LINE_SIDE_MIRROR),
    {
      npc: STICK_TRAINER,
      index: 12,
      level: 60,
      xp: 380,
      takes: STICK,
      // Without one, the trainer's own reminder (Wiki transcript, Agility Trainer).
      precondition: ({ player }) => (player.getInventory().getAmount(STICK) > 0 ? null : "Remember - no stick, no agility bonus!"),
      end: "You give the stick to the werewolf.",
    },
  ],
};
