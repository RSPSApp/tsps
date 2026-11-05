const { ShortcutAnim, hops } = require("./Builders.Agility");

/**
 * The Wilderness Agility Course entrance: the south door and the north gate pair are balance
 * gates. rsprox 449/450 show each opening as a two-tick loc swap: an inviswall on the threshold,
 * the open leaf on the tile behind it, then the closed loc back. The player edges along the ridge
 * itself, one tile a tick, between the start and end lines.
 */
const RIDGE = Object.freeze({
  door: 23555, // balancegate52a
  gateLeft: 23552, // balancegate52b_left
  gateRight: 23554, // balancegate52b_right
  invisWall: 38848,
  prisonDoorOpen: 1548, // inactiveprisondoor, the door's model
  gateOpenLeft: 1573, // inacmetalgateopenl
  gateOpenRight: 1574, // inacmetalgateopenr
  doorTile: [2998, 3917, 0],
  doorOpenTile: [2998, 3916, 0],
  gateLeftTile: [2998, 3931, 0],
  gateRightTile: [2997, 3931, 0],
  gateOpenLeftTile: [2998, 3930, 0],
  gateOpenRightTile: [2997, 3930, 0],
  start: "You go through the gate and try to edge over the ridge...",
  endIn: "You skillfully balance across the ridge...",
  endOut: "You skillfully balance along the ridge...",
  closeTicks: 2,
});

function ridgeLocation(core, [x, y, z]) {
  return new core.Location(x, y, z);
}

/** The placed loc, or null when this world has not loaded it (unit tests without a map). */
function ridgeObject(core, context, id, tile) {
  const area = context.player.getPrivateArea?.() ?? null;
  const location = ridgeLocation(core, tile);
  const found = core.MapObjects?.get?.(id, location, area)
    ?? area?.resolveObject?.(id, location);
  if (found) return found;
  const clicked = context.object;
  const at = clicked?.getLocation?.();
  return clicked?.getId?.() === id && at && at.getX() === tile[0] && at.getY() === tile[1] && at.getZ() === tile[2]
    ? clicked
    : null;
}

/**
 * Swaps the closed locs for their open pair, then puts the closed locs back two ticks later.
 * Every closed loc is found before anything changes, so a missing loc leaves the map untouched.
 */
function ridgeSwap(context, closedTiles, openTiles) {
  const core = context.core;
  const area = context.player.getPrivateArea?.() ?? null;
  const closed = closedTiles.map(([id, tile]) => ridgeObject(core, context, id, tile));
  if (closed.some((object) => object == null)) return false;
  const opened = openTiles.map(([id, tile, face]) =>
    new core.GameObject(id, ridgeLocation(core, tile), 0, face, area));
  for (const object of closed) core.ObjectManager.deregister(object, true);
  for (const object of opened) core.ObjectManager.register(object, true);
  const task = new core.Task(RIDGE.closeTicks, { task: "wilderness:ridge-gate" });
  task.execute = () => {
    task.stop();
    for (const object of opened) core.ObjectManager.deregister(object, true);
    for (const object of closed) core.ObjectManager.register(object, true);
  };
  core.TaskManager.submit(task);
  return true;
}

function openRidgeDoor(context) {
  return ridgeSwap(context,
    [[RIDGE.door, RIDGE.doorTile]],
    [
      [RIDGE.invisWall, RIDGE.doorTile, 3],
      [RIDGE.prisonDoorOpen, RIDGE.doorOpenTile, 0],
    ]);
}

function openRidgeGates(context) {
  return ridgeSwap(context,
    [
      [RIDGE.gateLeft, RIDGE.gateLeftTile],
      [RIDGE.gateRight, RIDGE.gateRightTile],
    ],
    [
      [RIDGE.invisWall, RIDGE.gateLeftTile, 3],
      [RIDGE.invisWall, RIDGE.gateRightTile, 3],
      [RIDGE.gateOpenLeft, RIDGE.gateOpenLeftTile, 2],
      [RIDGE.gateOpenRight, RIDGE.gateOpenRightTile, 0],
    ]);
}

/** Wilderness shortcut scripts (agility-shortcuts.json). */
module.exports = {
  /** Into the course: open the south door, then edge north along the ridge. */
  wildernessRidgeIn: () => ({
    end: { spam: RIDGE.endIn },
    steps: [
      { msg: { spam: RIDGE.start } },
      { run: openRidgeDoor },
      { walk: [[RIDGE.gateLeftTile[0], RIDGE.gateLeftTile[1]]] },
    ],
  }),

  /** Out of the course: open the north gates, edge south, then the south door behind the player. */
  wildernessRidgeOut: () => ({
    end: { spam: RIDGE.endOut },
    steps: [
      { msg: { spam: RIDGE.start } },
      { run: openRidgeGates },
      { walk: [[2998, 3918]] },
      { run: openRidgeDoor },
      { walk: [[RIDGE.doorOpenTile[0], RIDGE.doorOpenTile[1]]] },
    ],
  }),

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

  _test: { RIDGE, openRidgeDoor, openRidgeGates, ridgeSwap },
};
