const { ShortcutAnim, climbOver, pipe } = require("./builders");

/** Kourend shortcut scripts (agility-shortcuts.json). */
module.exports = {
  /** Arceuus dark altar: the boulder on the path, walked to and climbed from either side. */
  arceuusBoulder: ({ south, top, north }) => ({
    route: ({ pos, obj }) => (pos.y > obj.y ? [obj.x, obj.y, obj.z] : [...south, 0]),
    steps: ({ pos, obj }) => (pos.y > obj.y
      ? [climbOver(top, ShortcutAnim.CLIMB_OVER, 2), { msg: "You climb over the rocks." }, { walk: [south] }]
      : [{ walk: [top] }, climbOver(north, ShortcutAnim.CLIMB_OVER, 2), { msg: "You climb over the rocks." }]),
  }),

  /** Stronghold Slayer Cave: the tunnel beside the entrance, crawled along the player's row. */
  strongholdSlayerTunnel: ({ middleX, westOfX, westExitX, eastExitX }) => ({
    steps: ({ pos }) => {
      const west = pos.x <= westOfX;
      return pipe([middleX, pos.y], [west ? westExitX : eastExitX, pos.y]);
    },
  }),
};
