const { Anim } = require("./constants");

/** Climbs (wall, net, tree) onto another plane: animate, then land a tick later. */
function climb(destination, animation = Anim.CLIMB_UP, ticks = 1) {
  return [{ anim: animation }, { wait: ticks }, { tele: destination }];
}

/** Leaps across a gap in one tick and lands on `destination`. */
function leap(destination, { face = null, jump = Anim.LEAP, land = Anim.LAND } = {}) {
  return [
    face ? { face } : null,
    { anim: jump, delay: 15 },
    { wait: 1 },
    { tele: destination },
    land != null ? { anim: land } : null,
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

module.exports = { climb, leap, balance, faceLoc };
