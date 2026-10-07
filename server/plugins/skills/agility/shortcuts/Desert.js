const { Anim } = require("../constants");

/** Desert shortcut scripts (agility-shortcuts.json). */
module.exports = {
  /** Agility Pyramid: the climbing rocks on its west side, four tiles to the other side. */
  pyramidClimbingRocks: () => ({
    steps: ({ pos, obj }) => [
      { move: [pos.x + (pos.x <= obj.x ? 4 : -4), pos.y], anim: Anim.CLIMB_ROCKS, speed: [0, 120], ticks: 3 },
      { anim: -1 },
    ],
  }),
};
