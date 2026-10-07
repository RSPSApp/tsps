const { ShortcutAnim, hops } = require("./builders");

/** Wilderness shortcut scripts (agility-shortcuts.json). */
module.exports = {
  /** Wilderness God Wars Dungeon: shimmy around the jutting wall, from `northOfY` or below it. */
  gwdJuttingWall: ({ northOfY, south, north }) => ({
    steps: ({ pos }) => [{
      move: pos.y >= northOfY ? south : north,
      anim: pos.y >= northOfY ? ShortcutAnim.JUTTING_WALL_LEFT : ShortcutAnim.JUTTING_WALL_RIGHT,
      speed: [0, 120],
      ticks: 4,
    }],
  }),

  /**
   * Revenant Caves pillars: jump two tiles onto the pillar and two beyond it. A pillar facing 0
   * is crossed north-south, otherwise east-west.
   */
  revenantPillar: () => ({
    route: ({ pos, obj }) => {
      if (obj.face === 0) {
        return [obj.x, obj.y + (pos.y > obj.y ? 2 : -2), obj.z];
      }
      return [obj.x + (pos.x < obj.x ? -2 : 2), obj.y, obj.z];
    },
    steps: ({ pos, obj }) => {
      const vertical = obj.face === 0;
      const [dx, dy] = vertical ? [0, pos.y > obj.y ? -2 : 2] : [pos.x <= obj.x ? 2 : -2, 0];
      return hops([pos.x + dx, pos.y + dy], [pos.x + dx * 2, pos.y + dy * 2]);
    },
  }),
};
