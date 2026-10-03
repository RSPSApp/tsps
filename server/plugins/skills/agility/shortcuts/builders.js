const { Anim } = require("../constants");

/** Shortcut animations not used by the courses. */
const ShortcutAnim = Object.freeze({
  CLIMB_OVER: 839,
  SQUEEZE_WINDOW: 746,
  SQUEEZE_WINDOW_OUT: 748,
  SQUEEZE_RAILING: 1237,
  CRAWL_DOWN_ROCKS: 1148,
  CRAWL_UP_ROCKS: 737,
  DUCK: 2589,
  INVISIBLE: 2590,
  EMERGE: 2591,
  CREVICE_IN: 2594,
  CREVICE_OUT: 2595,
  DARK_TUNNEL: 844,
  JUTTING_WALL_LEFT: 3276,
  JUTTING_WALL_RIGHT: 3277,
  FIRE_GRAPPLE: 4455,
  GRAPPLE_GRAPHIC: 760,
  SPIKE_TRAP: 1111,
  LEDGE_FINISH: 758,
  FALL_INTO_WATER_LEFT: 2581,
  FALL_INTO_WATER_RIGHT: 2582,
  SWIM: 772,
});

function distance(a, b) {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}

/** [from, to]: the end nearer the player first. */
function ordered(pos, ends) {
  const here = [pos.x, pos.y];
  return distance(here, ends[0]) <= distance(here, ends[1]) ? ends : [ends[1], ends[0]];
}

/**
 * A two-way shortcut between `ends` (tiles, or a function of the context returning
 * them). The player walks to the nearer end and `cross(from, to, context)` returns
 * the steps to the other.
 */
function between({ ends, cross, ...entry }) {
  const endsOf = (context) => (typeof ends === "function" ? ends(context) : ends);
  return {
    xp: 0,
    ...entry,
    route: (context) => ordered(context.pos, endsOf(context))[0],
    steps: (context) => {
      const [from, to] = ordered(context.pos, endsOf(context));
      return cross(from, to, context);
    },
  };
}

/** A two-tile stile/fence along `axis`: the player's side is `before`, the far side `after`. */
function stile({ axis = "x", before = -1, after = 2, anim = ShortcutAnim.CLIMB_OVER, end = "You climb over the stile.", ...entry }) {
  return between({
    ...entry,
    end,
    ends: ({ obj }) => (axis === "x"
      ? [[obj.x + before, obj.y, obj.z], [obj.x + after, obj.y, obj.z]]
      : [[obj.x, obj.y + before, obj.z], [obj.x, obj.y + after, obj.z]]),
    cross: (from, to) => [climbOver(to, anim)],
  });
}

function climbOver(to, anim = ShortcutAnim.CLIMB_OVER, ticks = 1) {
  return { move: to, anim, speed: [0, 60], ticks };
}

function jump(to, anim = Anim.JUMP) {
  return { move: to, anim, speed: [15, 35] };
}

/** Jumps across each tile in turn (stepping stones), a tick apart. */
function hops(...tiles) {
  const steps = [];
  tiles.forEach((tile, index) => {
    if (index > 0) steps.push({ wait: 1 });
    steps.push(jump(tile));
  });
  return steps;
}

/** Squeezes through a pipe in two crawls, via its middle tile. */
function pipe(middle, to) {
  return [
    { anim: Anim.SQUEEZE_PIPE },
    { wait: 1 },
    { move: middle, speed: [0, 90], ticks: 2 },
    { wait: 2 },
    { anim: Anim.SQUEEZE_PIPE },
    { move: to, speed: [0, 90], ticks: 2 },
  ];
}

/** Ducks under a wall: vanish into the tunnel and emerge at `to`. */
function tunnel(to, cycles = 180) {
  const ticks = Math.round(cycles / 30);
  return [
    { move: to, anim: ShortcutAnim.DUCK, speed: [0, cycles], ticks: 0 },
    { wait: 1 },
    { anim: ShortcutAnim.INVISIBLE },
    { wait: ticks - 2 },
    { anim: ShortcutAnim.EMERGE },
    { wait: 1 },
    { tele: to },
  ];
}

/** Crawls into a crevice at `entry`, through to `far`, and out onto `exit`. */
function crevice(entry, far, exit, crawlTicks = 5) {
  return [
    { move: entry, anim: ShortcutAnim.CREVICE_IN, speed: [0, 30] },
    { move: far, anim: ShortcutAnim.INVISIBLE, speed: [0, crawlTicks * 30], ticks: crawlTicks },
    { move: exit, anim: ShortcutAnim.CREVICE_OUT, speed: [0, 60] },
  ];
}

/** Crawls backwards down a rock face to `bottom`, still facing `face` (direction `dir`). */
function crawlDown(face, bottom, dir) {
  return [
    { face },
    { wait: 1 },
    { move: bottom, anim: ShortcutAnim.CRAWL_DOWN_ROCKS, speed: [0, 120], ticks: 4, dir },
  ];
}

/** Climbs up a rock face along `path` with the climbing walk animation. */
function crawlUp(...path) {
  return [{ render: ShortcutAnim.CRAWL_UP_ROCKS }, { walk: path }, { render: null }];
}

/** Rope swings: the rope animates while the player swings to `to`. */
function ropeSwing(to) {
  return [
    { objAnim: Anim.OBJECT_ROPE_SWING },
    { move: to, anim: Anim.ROPE_SWING, speed: [30, 60], ticks: 2 },
  ];
}

module.exports = {
  ShortcutAnim,
  between,
  stile,
  climbOver,
  jump,
  hops,
  pipe,
  tunnel,
  crevice,
  crawlDown,
  crawlUp,
  ropeSwing,
};
