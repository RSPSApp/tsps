const { Anim } = require("../constants");
const { hops } = require("./builders");

/** Karamja shortcut scripts (agility-shortcuts.json). */
module.exports = {
  /**
   * Brimhaven Dungeon's two river crossings near the red dragons. Each crossing is a shore,
   * three rocks and the far shore, listed from the side whose first rock is `firstRockX`; the
   * rock the player clicks tells which crossing and which way.
   */
  brimhavenRiver: ({ splitY, north, south }) => {
    const crossing = ({ obj }) => {
      const river = obj.y > splitY ? north : south;
      const forward = obj.x === river.firstRockX;
      const tiles = forward ? river.tiles : [...river.tiles].reverse();
      return { start: [...tiles[0], 0], rocks: tiles.slice(1, -1), shore: tiles[tiles.length - 1] };
    };
    return {
      route: (context) => crossing(context).start,
      steps: (context) => {
        const { rocks, shore } = crossing(context);
        return hops(...rocks, shore);
      },
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
