const { Anim } = require("../constants");

/** Scripts for the ways onto and off the agility courses (agility-shortcuts.json). */
module.exports = {
  /** Barbarian Outpost: squeeze through the pipe into or out of the course, from `northOfY` or below. */
  barbarianOutpostPipe: ({ northOfY, north, south }) => ({
    route: ({ pos }) => (pos.y >= northOfY ? north : south),
    steps: ({ pos, obj }) => {
      const fromNorth = pos.y >= northOfY;
      return [
        { wait: 1 },
        { move: [obj.x, fromNorth ? obj.y - 1 : obj.y + 2], anim: Anim.SQUEEZE_PIPE, speed: [0, 100], dir: fromNorth ? "south" : "north" },
        { tele: fromNorth ? south : north },
      ];
    },
  }),
};
