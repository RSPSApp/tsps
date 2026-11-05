const { Anim } = require("./Constants.Agility");

/** The thud of a jump down onto a lower roof (rsprox captures: every rooftop gap). */
const JUMP_DOWN_SOUND = 2462;
/** The scrape of a jump up a wall to grab its ledge (rsprox captures). */
const WALL_JUMP_SOUND = 2468;

/** Climbs (wall, net, tree) onto another plane: animate, then land a tick later. */
function climb(destination, animation = Anim.CLIMB_UP, ticks = 1) {
  return [{ anim: animation }, { wait: ticks }, { tele: destination }];
}

/**
 * Leaps across a gap in one tick and lands on `destination`. `windup` ticks pass before the face
 * and `aim` ticks between the face and the jump; `settle` ticks pass after the landing before the
 * obstacle ends. A rooftop gap in the captures is `windup: 1, aim: 1, settle: 1`: the player turns
 * the tick after arriving, jumps (2586, sound 2462, both 15 cycles in) a tick later, lands (2588)
 * on the next and gets the XP a tick after that.
 */
function leap(destination, { face = null, jump = Anim.LEAP, land = Anim.LAND, windup = 0, aim = 0, settle = 0 } = {}) {
  return [
    windup > 0 ? { wait: windup } : null,
    face ? { face } : null,
    aim > 0 ? { wait: aim } : null,
    { anim: jump, delay: 15 },
    { sound: JUMP_DOWN_SOUND, delay: 15 },
    { wait: 1 },
    { tele: destination },
    land != null ? { anim: land } : null,
    settle > 0 ? { wait: settle } : null,
  ];
}

/** A rooftop gap as captured: see `leap`. A few give the XP two ticks after landing (`settle: 2`). */
function gapJump(destination, { face = null, land = Anim.LAND, settle = 1 } = {}) {
  return leap(destination, { face, land, windup: 1, aim: 1, settle });
}

/**
 * A jump up a wall that grabs its ledge, then a pull up onto it (rsprox captures: Varrock's,
 * Draynor's and Canifis' wall gaps). The tick after arriving: the jump (2583, 20 cycles in) to
 * `grab` with sound 2468; the grab (2585) a tick later; the pull up to `top` the tick after that,
 * landing a tick later, when the obstacle ends.
 */
function wallScramble(grab, top, dir) {
  return [
    { wait: 1 },
    // The sound goes with the jump (rsprox 90, 1723, 3154); after the move it would land with the grab.
    { sound: WALL_JUMP_SOUND, delay: 20 },
    { move: grab, anim: Anim.JUMP_SHORT, delay: 20, speed: [25, 30], dir },
    { anim: Anim.GRAB_LEDGE },
    { wait: 1 },
    { move: top, speed: [17, 26], dir },
  ];
}

/** Shapes 0-9 are walls and wall decorations, which sit on an edge of their tile. */
const LAST_WALL_SHAPE = 9;
/** The tile across a wall's edge, by its rotation: 0 west, 1 north, 2 east, 3 south. */
const WALL_FACING = [[-1, 0], [0, 1], [1, 0], [0, -1]];

/**
 * Faces a loc: its tile, or for a wall or wall decoration (climbed from the tile it sits on,
 * like Ardougne's wooden beams) across the edge it's on.
 */
function faceLoc(obj) {
  if (obj.type == null || obj.type > LAST_WALL_SHAPE) return { face: [obj.x, obj.y] };
  const [dx, dy] = WALL_FACING[obj.face & 3];
  return { face: [obj.x + dx, obj.y + dy] };
}

/** Walks a tightrope/log/plank path; pair with `render: Anim.BALANCE_WALK`. */
function balance(...path) {
  return [{ walk: path }];
}

module.exports = { climb, leap, gapJump, wallScramble, balance, faceLoc, JUMP_DOWN_SOUND, WALL_JUMP_SOUND };
