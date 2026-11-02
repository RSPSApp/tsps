const { Anim } = require("../Constants.Agility");

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
  CLIMB_LOOP: 4435,
  LEDGE_SIDESTEP_LEFT: 2757,
  LEDGE_SIDESTEP_RIGHT: 7142,
  // From rsprox captures; the comments are the cache's gamevals.
  CRUMBLED_WALL: 840, // human_walk_crumbledwall
  CLIMB_TRELLIS: 12091, // human_climb_trellis
  WALK_BACKWARDS: 820, // human_walk_b
  LONG_CRAWL: 2796, // human_longcrawl
  SHORT_JUMP: 12196, // human_yama_shortjump01
  STEPPING_STONE_JUMP: 769, // human_steppingstonejump
  GRAPPLE_CLIMB: 1779, // xbows_human_fire_and_climb_grapple_fast
  GRAPPLE_CLIMB_GRAPHIC: 3575, // xbows_fire_and_climbed_grapple_spot_anim_fast
  SWIM_CAVEWALL: 7702, // human_swim_cavewall
  SWIM_SHIPWALL: 7704, // human_swim_shipwall
  SWIM_HOLE_ENTER: 7705, // human_swim_hole_enter
  SWIM_HOLE_LEAVE: 7706, // human_swim_hole_leave
});

const PIPE_SOUND = 2489;

function distance(a, b) {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}

/**
 * [from, to]: the end nearer the player first. When both are as many tiles away (a player off to
 * one side), the straight-line distance decides, so they aren't sent round to the far side.
 */
function ordered(pos, ends) {
  const here = [pos.x, pos.y];
  const [a, b] = [distance(here, ends[0]), distance(here, ends[1])];
  if (a !== b) return a < b ? ends : [ends[1], ends[0]];
  const straight = (end) => (end[0] - here[0]) ** 2 + (end[1] - here[1]) ** 2;
  return straight(ends[0]) <= straight(ends[1]) ? ends : [ends[1], ends[0]];
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

/**
 * Squeezes through a pipe in two crawls, via its middle tile, as captured (rsprox: the Edgeville,
 * Taverley and Yanille dungeon pipes): each half moves from cycle 30 to 126 and lands 4 ticks
 * later with the pipe's sound; the second half starts a tick after the first lands. The crawl
 * replays with each half, so the squeeze pose (no weapon in hand) lasts the whole way. A long pipe
 * passes `resume`, the tile its second half starts from: the player is moved there unseen a tick
 * after the first half lands, and crawls on the tick after (rsprox 449-461, the Wilderness course).
 */
function pipe(middle, to, resume = null) {
  const half = (tile) => ({ move: tile, anim: Anim.SQUEEZE_PIPE, delay: 30, speed: [30, 126], ticks: 4 });
  const skip = resume ? [{ tele: resume }, { wait: 1 }] : [];
  return [half(middle), { sound: PIPE_SOUND }, { wait: 1 }, ...skip, half(to), { sound: PIPE_SOUND }];
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

/** Runs up to `near` and hurdles the fence onto `far`. */
function hurdle(near, far) {
  return [
    { face: near },
    { move: near, anim: Anim.RUN_UP, speed: [0, 60] },
    { anim: Anim.JUMP_HURDLE },
    { wait: 1 },
    { move: far, speed: [0, 15] },
  ];
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
  hurdle,
};
