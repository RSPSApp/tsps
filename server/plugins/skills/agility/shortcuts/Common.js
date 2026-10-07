const { Anim } = require("../constants");
const { ShortcutAnim, climbOver } = require("./builders");

/**
 * Scripts several regions share. Each takes its entry's `params` and returns the parts of the
 * obstacle the data can't say: `route`, `precondition`, `steps`.
 */
module.exports = {
  /** Swinging monkey bars that run north-south, entered from the tile east of the loc. */
  monkeyBars: ({ south, north }) => ({
    route: ({ obj }) => [obj.x + 1, obj.y, obj.z],
    steps: ({ obj }) => [
      { anim: Anim.MONKEY_BARS_JUMP },
      { render: Anim.MONKEY_BARS_CROSS },
      { walk: [[obj.x + 1, obj.y === south ? north : south]] },
      { render: null },
      { anim: Anim.MONKEY_BARS_DROP },
    ],
  }),

  /** A loose railing squeezed through between the railing tile and `other`. */
  looseRailing: ({ other }) => ({
    steps: ({ pos, obj }) => {
      const onRailing = pos.x === obj.x && pos.y === obj.y;
      return [{ move: onRailing ? other : [obj.x, obj.y], anim: ShortcutAnim.SQUEEZE_RAILING, speed: [0, 60], ticks: 2 }];
    },
  }),

  /** Climbs over the loc to the tile beyond it, north or south of the player. */
  climbOverLoc: () => ({
    steps: ({ pos, obj }) => [climbOver([obj.x, obj.y + (pos.y > obj.y ? -1 : 1)])],
  }),
};
