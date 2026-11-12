const { Anim } = require("../Constants.Agility");

/** Scripts for the ways onto and off the agility courses (agility-shortcuts.json). */
module.exports = {
  /** Barbarian Outpost: squeeze through the pipe into or out of the course, from `northOfY` or below. */
  barbarianOutpostPipe: ({ northOfY, north, south }) => ({
    route: ({ pos }) => (pos.y >= northOfY ? north : south),
    steps: ({ pos }) => {
      const fromNorth = pos.y >= northOfY;
      return [
        { wait: 1 },
        // In RSProx 1060 and 1061, the squeeze starts with the exact move.
        { move: fromNorth ? south : north, anim: Anim.SQUEEZE_PIPE, delay: 30, speed: [30, 126], ticks: 4, dir: fromNorth ? "south" : "north" },
      ];
    },
  }),
};
