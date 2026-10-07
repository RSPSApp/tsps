const { Anim } = require("../constants");
const { ShortcutAnim, climbOver } = require("./builders");

function tileDistance(a, x, y) {
  return Math.max(Math.abs(a[0] - x), Math.abs(a[1] - y));
}

/** Fremennik shortcut scripts (agility-shortcuts.json). */
module.exports = {
  /** Rellekka's broken fence is only climbed into the town, from the west of `westOfX`. */
  rellekkaFence: ({ westOfX }) => ({
    precondition: ({ pos }) => (pos.x >= westOfX ? "You can't climb the fence from this side." : null),
  }),

  /** Rellekka: the broken bridge to the Fremennik Slayer Dungeon side, from `eastEnd` or the west. */
  rellekkaBrokenBridge: ({ eastEnd }) => ({
    route: ({ obj }) => [obj.x, obj.y, obj.z],
    steps: ({ pos }) => {
      const fromEast = pos.x === eastEnd[0] && pos.y === eastEnd[1];
      const dx = fromEast ? -1 : 1;
      return [
        fromEast ? null : { anim: Anim.LEDGE_TURN, delay: 10 },
        { wait: 1 },
        { render: fromEast ? Anim.LEDGE_WALK_BACK : Anim.LEDGE_WALK },
        { walk: [[pos.x + dx * 2, pos.y]] },
        { render: null },
        fromEast ? { anim: ShortcutAnim.LEDGE_FINISH } : null,
        { walk: [[pos.x + dx * 3, pos.y]] },
      ];
    },
  }),

  /** Neitiznot: the rope bridges, `length` tiles to the far side. */
  neitiznotRopeBridge: ({ length }) => ({
    steps: ({ pos, obj }) => [{ walk: [[pos.x, pos.y + (pos.y > obj.y ? -length : length)]] }],
  }),

  /**
   * Lighthouse basalt rocks: each take-off tile jumps to its pair across the water, the pair
   * whose landing is nearest the clicked rock. The beach and shore are where the jumps end.
   */
  basaltRocks: ({ jumps, beach, shore }) => {
    const pairs = jumps.flatMap(([a, b]) => [[a, b], [b, a]]);
    const jumpFor = ({ obj, pos }) => [...pairs].sort((left, right) =>
      tileDistance(left[1], obj.x, obj.y) + tileDistance(left[0], pos.x, pos.y) * 0.1
      - (tileDistance(right[1], obj.x, obj.y) + tileDistance(right[0], pos.x, pos.y) * 0.1))[0];
    return {
      precondition: ({ obj, pos }) => {
        if (obj.id === beach.object && pos.y <= beach.y) return "You're already at the beach.";
        if (obj.id === shore.object && pos.y >= shore.y) return "You're already at the shore.";
        return null;
      },
      route: (context) => [...jumpFor(context)[0], 0],
      steps: (context) => [{ move: jumpFor(context)[1], anim: Anim.FAIL_JUMP, speed: [15, 35] }],
    };
  },

  /** Fremennik Slayer Dungeon: leap the strange floor to the pyrefiends, at either crack. */
  fremennikStrangeFloor: ({ westCrack, west, east }) => {
    const isWest = (obj) => obj.x === westCrack[0] && obj.y === westCrack[1];
    return {
      route: ({ pos, obj }) => {
        const crack = isWest(obj) ? west : east;
        return pos.x < obj.x ? crack.westStart : crack.eastStart;
      },
      steps: ({ pos, obj }) => {
        const crack = isWest(obj) ? west : east;
        const finish = pos.x < obj.x ? crack.eastLanding : crack.westLanding;
        return [
          { face: [obj.x, obj.y] },
          { move: [obj.x, obj.y], anim: Anim.RUN_UP, speed: [0, 60] },
          { anim: Anim.JUMP_HURDLE },
          { wait: 1 },
          { move: finish, speed: [0, 15] },
        ];
      },
    };
  },

  /** Trollheim: a rock climbed three tiles east or west, depending on which side the player is. */
  trollheimRocks: ({ eastOfX, eastStep }) => ({
    steps: ({ pos }) => {
      const step = pos.x >= eastOfX ? eastStep : -eastStep;
      return [{ move: [pos.x + step, pos.y], anim: Anim.CLIMB_ROCKS, speed: [0, 60] }, { anim: -1 }];
    },
  }),

  /** Low rocks on the paths to Trollheim, stepped over along y near `alongY`, otherwise along x. */
  trollheimRockStep: ({ alongY }) => ({
    steps: ({ pos, obj }) => {
      const vertical = alongY.some(([x, y]) => Math.max(Math.abs(obj.x - x), Math.abs(obj.y - y)) <= 3);
      const destination = vertical
        ? [obj.x, obj.y + (pos.y > obj.y ? -1 : 1)]
        : [obj.x + (pos.x > obj.x ? -1 : 1), obj.y];
      return [climbOver(destination)];
    },
  }),

  /** Trollheim handholds: up the cliff from below `topY`, or two tiles across along it. */
  trollheimHandholds: ({ topY, top, landing }) => ({
    route: ({ obj }) => (obj.y >= topY ? top : [obj.x, obj.y, obj.z]),
    steps: ({ pos, obj }) => [climbOver(obj.y >= topY ? landing : [obj.x, obj.y + (pos.y > obj.y ? -2 : 2)])],
  }),

  /** Mountain Camp: climb over the rockslide to the row on the far side. */
  rockslide: ({ northY, southY }) => ({
    steps: ({ pos, obj }) => [climbOver([pos.x, pos.y < obj.y ? northY : southY])],
  }),
};
