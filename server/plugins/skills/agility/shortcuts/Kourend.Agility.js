const { ShortcutAnim, climbOver, pipe } = require("./Builders.Agility");

/** Kourend shortcut scripts (agility-shortcuts.json). */
module.exports = {
  /** Arceuus Library railings: step to the outer side, then drop one tile inside to floor 0. */
  arceuusLibraryRailing: () => {
    const normal = {
      0: [0, -1],
      1: [-1, 0],
      2: [0, 1],
      3: [1, 0],
    };
    const delta = (obj) => normal[obj.face] ?? [0, 0];
    return {
      route: ({ obj }) => {
        const [dx, dy] = delta(obj);
        return [obj.x - dx, obj.y - dy, obj.z];
      },
      steps: ({ obj }) => {
        const [dx, dy] = delta(obj);
        return [{ move: [obj.x + dx, obj.y + dy, 0] }];
      },
    };
  },

  /** Arceuus dark altar: the boulder on the path, walked to and climbed from either side. */
  arceuusBoulder: ({ south, top, north }) => ({
    route: ({ pos, obj }) => (pos.y > obj.y ? [obj.x, obj.y, obj.z] : [...south, 0]),
    steps: ({ pos, obj }) => (pos.y > obj.y
      ? [climbOver(top, ShortcutAnim.CLIMB_OVER, 2), { msg: "You climb over the rocks." }, { walk: [south] }]
      : [{ walk: [top] }, climbOver(north, ShortcutAnim.CLIMB_OVER, 2), { msg: "You climb over the rocks." }]),
  }),

  /**
   * Karuulm Slayer Dungeon: the rocks into the Alchemical Hydra's lair, a loc two tiles wide that
   * is crossed north-south on the player's own column (rsprox local 1000143 and 1521 on the west
   * column, local 1000473 on the east one), from the tile beside it to the tile past it.
   */
  karuulmHydraRocks: () => {
    const column = ({ pos, obj }) => Math.min(Math.max(pos.x, obj.x), obj.x + (obj.sizeX ?? 1) - 1);
    const ends = (context) => {
      const { obj } = context;
      const x = column(context);
      const south = [x, obj.y - 1, obj.z];
      const north = [x, obj.y + (obj.sizeY ?? 1), obj.z];
      return context.pos.y > obj.y ? [north, south] : [south, north];
    };
    return {
      route: (context) => ends(context)[0],
      steps: (context) => [climbOver(ends(context)[1], ShortcutAnim.CLIMB_OVER, 2), { anim: -1 }],
    };
  },

  /** Stronghold Slayer Cave: the tunnel beside the entrance, crawled along the player's row. */
  strongholdSlayerTunnel: ({ middleX, westOfX, westExitX, eastExitX }) => ({
    steps: ({ pos }) => {
      const west = pos.x <= westOfX;
      return pipe([middleX, pos.y], [west ? westExitX : eastExitX, pos.y]);
    },
  }),
};
