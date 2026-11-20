const { Anim } = require("../Constants.Agility");
const { hops, between, ordered, ShortcutAnim } = require("./Builders.Agility");

/** The lava stepping stones' jump, and their fall's slip and landing (rsprox 1000195, 1000433). */
const LAVA_STONE_SOUND = 2461;
const LAVA_FALL_SOUND = 2493;
const LAVA_LANDING_SOUND = 2412;

/** Tiles across a channel, from one end to the other. */
function channelLength(from, to) {
  return Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
}

/** Karamja shortcut scripts (agility-shortcuts.json). */
module.exports = {
  /**
   * Brimhaven Dungeon's two river crossings near the red dragons. Each crossing is a shore,
   * three rocks and the far shore, listed from the side whose first rock is `firstRockX`; the
   * rock the player clicks tells which crossing and which way.
   */
  brimhavenRiver: ({ splitY, north, south, islandLevel = 56, awayLevel = 1 }) => {
    const crossing = ({ obj }) => {
      const river = obj.y > splitY ? north : south;
      const forward = obj.x === river.firstRockX;
      const tiles = forward ? river.tiles : [...river.tiles].reverse();
      return { river, forward, start: [...tiles[0], 0], rocks: tiles.slice(1, -1), shore: tiles[tiles.length - 1] };
    };
    return {
      level: (context) => {
        const { river, forward } = crossing(context);
        // Both stretches lead to the dragon island on the north crossing's reverse route and
        // the south crossing's forward route; their return directions are always available.
        return (river === north ? !forward : forward) ? islandLevel : awayLevel;
      },
      route: (context) => crossing(context).start,
      steps: (context) => {
        const { rocks, shore } = crossing(context);
        return hops(...rocks, shore);
      },
    };
  },

  /**
   * The Strong Tree's grapple across the two channels between Musa Point (north) and the
   * Harpie bug swarms (south). The tree sits on the island between them, so the player
   * grapples to the island, walks across it, then grapples again. The pair is chosen by
   * which side of the tree the player is on. `barehanded` (Wiki: 78 Agility, no grapple) climbs across each
   * channel instead, as the other barehanded river crossings do.
   */
  karamjaStrongTree: ({ islandY, north, south, barehanded = false }) => between({
    ends: (context) => (context.pos.y >= islandY ? north : south),
    cross: (from, to, context) => barehanded ? [
      { move: to, anim: Anim.CLIMB_ROCKS, speed: [0, 30 * channelLength(from, to)], ticks: channelLength(from, to) },
      { anim: -1 },
    ] : [
      { face: [context.obj.x, context.obj.y] },
      { anim: ShortcutAnim.FIRE_GRAPPLE },
      { gfx: ShortcutAnim.GRAPPLE_GRAPHIC },
      { wait: 6 },
      { anim: -1 },
      { tele: to },
    ],
  }),

  /**
   * Brimhaven Dungeon's lava stepping stones, west of the entrance (Wiki: 12 Agility from the
   * north, none from the south; 7.5 XP). rsprox captures (rev 227: local 1000195, 1000283,
   * 1000433, 90, 91, 552): two ticks after the player reaches the stones, the start line with the
   * first jump, then one jump a stone two ticks apart (human_spot_jump, cycles 15-30, synth 2461
   * each); the end line and the XP the tick after the last. Only the north-to-south way and one
   * fall (1000433, tick 17786) were captured: two ticks after the third jump the slip and its line
   * (synth 2493, ten loops), facing north, and two ticks later the player lands on the north bank
   * at `landing`, hit, with synth 2412.
   * Ours: the fall's chance and damage (the Wiki says only that it is "quite rare" and "a low
   * amount of damage"): the chance is the Wilderness course stones', and a tenth of the current
   * hitpoints gives the captured 7 at 77. The way back from the south has no capture; it mirrors
   * this one and doesn't fail.
   */
  brimhavenLavaStones: ({ ends, via, landing = null, failHop = 3 }) => {
    const path = (context) => {
      const forward = ordered(context.pos, ends)[0] === ends[0];
      return forward ? [...via, ends[1]] : [...via].reverse().concat([ends[0]]);
    };
    const jumps = (tiles) => [
      { wait: 2 },
      { msg: { spam: "You carefully start crossing the stepping stones..." } },
      ...tiles.flatMap((tile, index) => [
        ...(index > 0 ? [{ wait: 1 }] : []),
        { sound: LAVA_STONE_SOUND },
        { move: tile, anim: Anim.JUMP, speed: [15, 30] },
      ]),
    ];
    return {
      route: (context) => ordered(context.pos, ends)[0],
      steps: (context) => jumps(path(context)),
      end: { spam: "...You safely cross to the other side." },
      // The chance is the entry's `fail` (low/high); only an entry with a `landing` falls.
      ...(landing ? { fail: {
        steps: (context) => [
          ...jumps(path(context).slice(0, failHop)),
          { wait: 1 },
          { anim: Anim.BALANCE_FALL },
          { faceDir: "north" },
          { msg: { spam: "...You lose your footing and fall into the lava." } },
          { sound: LAVA_FALL_SOUND, loops: 10 },
          { wait: 2 },
          { tele: landing },
          { hit: { percent: 10 } },
          { sound: LAVA_LANDING_SOUND },
        ],
      } } : {}),
    };
  },

  /** Karamja: the vines between the north and south of the island. */
  karamjaVines: ({ splitY, north, south }) => ({
    steps: ({ obj }) => [
      { move: obj.y <= splitY ? north : south, anim: Anim.CLIMB_ROCKS, speed: [0, 180], ticks: 5 },
      { anim: -1 },
    ],
  }),
};
