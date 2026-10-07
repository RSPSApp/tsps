const { Anim } = require("../constants");
const { ShortcutAnim, between } = require("./builders");

/**
 * Wyrmscraig shortcut scripts (agility-shortcuts.json), as captured (docs/wyrmscraig.md): the
 * basalt stepping stones jump two tiles at a time, a jump every 2 ticks; the rocks to Ardeaglais
 * are climbed in one 2-tick move, facing the cliff (west) both ways.
 */
const JUMP_SOUND = 2461;
const CLIMB_SOUND = 2454;

/** One jump: animation and sound 15 cycles in, the move from cycle 30 to 45, the next 2 ticks later. */
function basaltJump(to) {
  return [
    { sound: JUMP_SOUND, delay: 15 },
    { move: to, anim: Anim.JUMP, delay: 15, speed: [30, 45], ticks: 2 },
  ];
}

module.exports = {
  /** Basalt stepping stones: two tiles a jump from one end of `path` to the other, whichever stone is clicked. */
  wyrmscraigStones: ({ path }) => {
    const { route, steps } = between({
      ends: [path[0], path[path.length - 1]],
      cross: (from) => {
        const tiles = from[1] === path[0][1] ? path.slice(1) : [...path].reverse().slice(1);
        return tiles.flatMap(basaltJump);
      },
    });
    return { route, steps };
  },

  /** The rocks below Ardeaglais: up with the climbing loop, down with the rock climb, both facing west. */
  wyrmscraigCliff: ({ ends }) => {
    const { route, steps } = between({
      ends,
      cross: (from, to) => [
        { sound: CLIMB_SOUND, loops: 3, delay: 5 },
        { move: to, anim: to[0] < from[0] ? ShortcutAnim.CLIMB_LOOP : Anim.CLIMB_ROCKS, speed: [0, 60], ticks: 2, dir: "west" },
      ],
    });
    return { route, steps };
  },
};
