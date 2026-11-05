const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../Constants.Agility");
const { pipe } = require("../shortcuts/Builders.Agility");

/**
 * Wilderness Agility Course. Steps, sounds, lines and ticks follow rsprox 449 and 450 (rev 233,
 * main game; 452, 455, 458 and 461 agree), tiles from the same captures and the cache; levels,
 * XP, success rates and fall damage are the Wiki's. Every obstacle line is spam (type 105).
 * Only the stepping stones' fall was captured (449); the ropeswing's and the log's falls into the
 * dungeon below are guesses (see `fall`).
 */
const ROPE_SWING_SOUND = 2494;
const STONE_JUMP_SOUND = 2461;
const LOG_SOUND = 2470;
const CLIMB_SOUND = 2454;
/** The stepping stones' fall (449): sound 2493 with the slip, 2412 with the landing. */
const LAVA_FALL_SOUND = 2493;
const LAVA_LANDING_SOUND = 2412;

const STEPPING_STONES = 6;
/** Wiki: the stepping stones are only failed on the third stone. */
const STONE_FAIL_HOP = 3;
/** Where the stepping stones' fall lands, north of the stones (449). */
const LAVA_LANDING = [3002, 3963, 0];

/**
 * Where the falls land in the dungeon below, beside its spikes (`wildy_agility_spikes`, under the
 * ropeswing at 3004-3005,10355-10356 and either side of the log's line at y 10345). Guesses: no
 * capture has a fall from the ropeswing or the log.
 */
const ROPE_PIT = [3005, 10357, 0];
const LOG_PIT = [3000, 10345, 0];

/** Wiki: falls take a fraction of the player's current hitpoints, plus one. */
function fallDamage(player, fraction) {
  return Math.floor(player.getHitpoints() * fraction) + 1;
}

/**
 * A fall into the dungeon (Wiki: the ropeswing and the log; 3/20 of current hitpoints + 1). The
 * slip (764) and its timing follow the stepping stones' captured fall; the rest is a guess.
 */
function fall(message, landing, player) {
  return [
    { anim: Anim.BALANCE_FALL },
    { msg: { spam: message } },
    { wait: 2 },
    { tele: landing },
    { hit: fallDamage(player, 3 / 20) },
  ];
}

/**
 * Six jumps west a tile at a time, two ticks apart (741 and sound 2461, cycles 15-30), from two
 * ticks after arriving; the line with the first jump and the XP the tick after the last (449, 450).
 */
function steppingStones(hops) {
  return ({ pos }) => {
    const steps = [{ wait: 2 }, { msg: { spam: "You carefully start crossing the stepping stones..." } }];
    for (let hop = 1; hop <= hops; hop++) {
      if (hop > 1) steps.push({ wait: 1 });
      steps.push(
        { sound: STONE_JUMP_SOUND },
        { move: [pos.x - hop, pos.y], anim: Anim.JUMP, speed: [15, 30], dir: "west" },
      );
    }
    return steps;
  };
}

/** The swing (751, 20 cycles in, cycles 45-70) two ticks after arriving, as the rope animates (449, 450). */
function ropeSwing(landing) {
  return [
    { wait: 1 },
    { faceDir: "north" },
    { wait: 1 },
    { objAnim: Anim.OBJECT_ROPE_SWING },
    { move: landing, anim: Anim.ROPE_SWING, delay: 20, speed: [45, 70], ticks: 1, dir: "north" },
  ];
}

module.exports = {
  key: "wilderness",
  name: "Wilderness Agility",
  helper: 13, // the Agility helper's course (enum 3507: "Wilderness Agility Course")
  lapXp: 571.4,
  petBase: 34666, // Giant squirrel base chance (Wiki)
  // No marks of grace on this course (Wiki: Wilderness Agility Course).
  diaryTask: {
    diary: "wilderness",
    task: "complete-a-lap-of-the-wilderness-agility-course",
  },
  obstacles: [
    {
      object: ObjectIds.OBSTACLE_PIPE_9,
      index: 1,
      level: 49, // Wiki: 49 for the pipe (52 only to go through the entrance gate)
      xp: 12.5,
      route: [3004, 3937, 0],
      // rsprox 449-461: crawl to 3940, unseen to 3947, crawl to 3950.
      steps: ({ pos }) => pipe([pos.x, pos.y + 3], [pos.x, pos.y + 13], [pos.x, pos.y + 10]),
    },
    {
      object: ObjectIds.ROPESWING_6,
      index: 2,
      level: 1, // Wiki: the obstacles after the pipe have no level of their own
      xp: 20,
      route: [3005, 3953, 0],
      end: { spam: "You skillfully swing across." },
      steps: [...ropeSwing([3005, 3958]), { sound: ROPE_SWING_SOUND }],
      // Wiki: 200-250 out of 256 (78%-98% from level 1 to 99, Mod Ash), failable at any level.
      fail: {
        low: 200,
        high: 250,
        steps: ({ player }) => [
          ...ropeSwing([3005, 3956]),
          ...fall("You slip and fall into the pit below.", ROPE_PIT, player),
        ],
      },
    },
    {
      object: ObjectIds.STEPPING_STONE_33,
      index: 3,
      level: 1,
      xp: 20,
      route: [3002, 3960, 0],
      end: { spam: "...You safely cross to the other side." },
      steps: steppingStones(STEPPING_STONES),
      // Wiki: 180-250 out of 256 (71%-98%); only the third stone fails, for a fifth of current
      // hitpoints + 1. Captured (449): the slip two ticks after the third jump, facing north,
      // and the landing north of the stones two ticks later.
      fail: {
        low: 180,
        high: 250,
        steps: (context) => [
          ...steppingStones(STONE_FAIL_HOP)(context),
          { wait: 1 },
          { anim: Anim.BALANCE_FALL },
          { faceDir: "north" },
          { msg: { spam: "...You lose your footing and fall into the lava." } },
          { sound: LAVA_FALL_SOUND, loops: 10 },
          { wait: 2 },
          { tele: LAVA_LANDING },
          { hit: fallDamage(context.player, 4 / 20) },
          { sound: LAVA_LANDING_SOUND },
        ],
      },
    },
    {
      object: ObjectIds.LOG_BALANCE_23,
      index: 4,
      level: 1,
      xp: 20,
      route: [3002, 3945, 0],
      render: Anim.BALANCE_WALK,
      // A tile a tick from the tick after arriving, the log's creak on the first, fifth and last
      // tiles; the line on the last tile and the XP the tick after (449, 450).
      steps: [
        { wait: 1 },
        { msg: { spam: "You walk carefully across the slippery log..." } },
        { sound: LOG_SOUND, loops: 3 },
        { walk: [[2998, 3945]] },
        { sound: LOG_SOUND, loops: 2 },
        { walk: [[2995, 3945]] },
        { sound: LOG_SOUND, loops: 2 },
        { walk: [[2994, 3945]], arrive: true },
        { msg: { spam: "You skillfully edge across the gap." } },
        { wait: 1 },
      ],
      // Wiki: 200-250 out of 256 (78%-98%), and only at the start of the log.
      fail: {
        low: 200,
        high: 250,
        render: Anim.BALANCE_WALK,
        steps: ({ player }) => [
          { wait: 1 },
          { msg: { spam: "You walk carefully across the slippery log..." } },
          { sound: LOG_SOUND, loops: 3 },
          { walk: [[3000, 3945]] },
          ...fall("You slip and fall onto the spikes below.", LOG_PIT, player),
        ],
      },
    },
    {
      object: ObjectIds.ROCKS_105,
      index: 5,
      level: 1,
      xp: 0, // Wiki: the rocks' 498.9 is the lap bonus, paid only after a full lap
      route: ({ obj }) => [obj.x, obj.y + 1, 0],
      end: { spam: "You reach the top." },
      // Turned south the tick after arriving; then climbed a tile a tick (render 737, sound 2454)
      // to the top, three tiles past the rocks, with the lap the tick after (449, 450).
      steps: ({ obj }) => [
        { wait: 1 },
        { faceDir: "south" },
        { wait: 1 },
        { render: Anim.CLIMB_WALL },
        { sound: CLIMB_SOUND, loops: 7 },
        { walk: [[obj.x, obj.y - 3]] },
      ],
    },
  ],
};
