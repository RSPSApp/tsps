// Run after `yarn build`: node --test tests/noclip-movement.test.cjs
// Owner noclip (#5630): a flagged player's own step through a blocked edge is allowed and its route reaches the destination;
// an unflagged player is refused at the same edge, and so is the flagged player's neighbour. The blocked edge is found at
// run time in the loaded region (RegionManager.canMovestart false), so no coordinates are assumed.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { Location } = require('../dist/game/model/Location');
const { PathFinder } = require('../dist/game/model/movement/path/PathFinder');

const core = PluginManager.getCoreApi();
const ORIGIN = { x: 3222, y: 3218 };
let index = 17000;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core.ObjectDefinition.init();
  RegionManager.init();
  RegionManager.loadMapFiles(ORIGIN.x, ORIGIN.y);
});

function player(flagged) {
  const p = new Player(new PlayerSession({ kind: 'test', isOpen: () => true, send: () => true }))
    .setUsername(`noclip${index}`).setIndex(index++);
  p.setRegistered(true);
  p.setNeedsPlacement(false);
  if (flagged) p.setAttribute('admin:noclip', true);
  return p;
}

/** A tile with a blocked step east into its neighbour, found in the loaded region. */
function blockedEastEdge() {
  for (let x = ORIGIN.x - 6; x <= ORIGIN.x + 6; x++) {
    for (let y = ORIGIN.y - 6; y <= ORIGIN.y + 6; y++) {
      const from = new Location(x, y, 0);
      const to = new Location(x + 1, y, 0);
      if (!RegionManager.canMovestart(from, to, 1, 1, null)) return { from, to };
    }
  }
  return null;
}

test('the region has a blocked east step to test against', () => {
  assert.ok(blockedEastEdge(), 'a blocked step is found in the loaded region');
});

test('a flagged player may step through the blocked edge; the same step is refused for an unflagged player', () => {
  const edge = blockedEastEdge();
  const flagged = player(true);
  const plain = player(false);
  flagged.setLocation(edge.from);
  plain.setLocation(edge.from);
  assert.equal(flagged.getMovementQueue().canWalkTo(edge.to, edge.from), true, 'flagged: the step is allowed');
  assert.equal(plain.getMovementQueue().canWalkTo(edge.to, edge.from), false, 'unflagged: the step is refused');
});

test('a flagged player\'s route reaches a destination across the blocked edge', () => {
  const edge = blockedEastEdge();
  const flagged = player(true);
  flagged.setLocation(edge.from);
  const destination = new Location(edge.to.getX() + 1, edge.to.getY(), 0);
  PathFinder.calculateWalkRoute(flagged, destination.getX(), destination.getY());
  const queue = flagged.getMovementQueue();
  assert.ok(queue.points.length > 0, 'a route is queued');
  // The straight route crosses the blocked edge first: its first step is the tile across the edge.
  const first = queue.points.peekFirst().position;
  assert.equal(first.getX(), edge.to.getX(), 'the first step crosses the blocked edge');
  assert.equal(first.getY(), edge.to.getY(), 'the first step crosses the blocked edge');
  const last = queue.points.peekLast().position;
  assert.equal(last.getX(), destination.getX(), 'the route ends at the destination');
  assert.equal(last.getY(), destination.getY(), 'the route ends at the destination');
});

test('another player on the same tile, unflagged, gets no noclip route across the edge', () => {
  const edge = blockedEastEdge();
  const plain = player(false);
  plain.setLocation(edge.from);
  assert.equal(plain.getMovementQueue().canWalkTo(edge.to, edge.from), false);
});

test('end to end: the flagged player walks across the blocked edge to the destination; an unflagged one never steps across it', () => {
  const edge = blockedEastEdge();
  const destination = new Location(edge.to.getX() + 1, edge.to.getY(), 0);
  const key = (x, y) => `${x},${y}`;
  // Queue the route, then drive the movement queue the way the movement-stopping and abyss tests do; record each tick's tile.
  const walk = (p) => {
    PathFinder.calculateWalkRoute(p, destination.getX(), destination.getY());
    const trail = [key(p.getLocation().getX(), p.getLocation().getY())];
    for (let i = 0; i < 12; i++) {
      core.TaskManager.processWalkTo(p.getIndex());
      p.getMovementQueue().process();
      core.TaskManager.process();
      trail.push(key(p.getLocation().getX(), p.getLocation().getY()));
    }
    return trail;
  };
  const flagged = player(true);
  flagged.setLocation(edge.from);
  const flaggedTrail = walk(flagged);
  // A walk tick can cover two tiles (the trail samples per tick), so the crossing shows as a tick that ends past the far tile.
  // Straight across: after the first tick the flagged player is already past the far tile (a walk around the wall is not).
  assert.ok(Number(flaggedTrail[1].split(',')[0]) > edge.to.getX(), `the flagged walk is past the far tile after its first tick: ${flaggedTrail.join(' ')}`);
  assert.equal(flaggedTrail[flaggedTrail.length - 1], key(destination.getX(), destination.getY()), 'and ends at the destination');

  const plain = player(false);
  plain.setLocation(edge.from);
  const plainTrail = walk(plain);
  for (let i = 1; i < plainTrail.length; i++) {
    assert.ok(!(plainTrail[i - 1] === key(edge.from.getX(), edge.from.getY()) && plainTrail[i] === key(edge.to.getX(), edge.to.getY())),
      `the unflagged walk never steps from the near tile onto the far tile: ${plainTrail.join(' ')}`);
  }
});

/** A flagged player walks to a destination: queue the route, then drive the movement queue until it is done (or 120 ticks). */
function walkTo(p, destX, destY) {
  PathFinder.calculateWalkRoute(p, destX, destY);
  for (let i = 0; i < 120; i++) {
    core.TaskManager.processWalkTo(p.getIndex());
    p.getMovementQueue().process();
    core.TaskManager.process();
    if (p.getLocation().getX() === destX && p.getLocation().getY() === destY) break;
  }
  return p.getLocation();
}

test('a noclip click 40 tiles away walks all 40 tiles (one checkpoint per click, not a 25-tile cap)', () => {
  const p = player(true);
  p.setLocation(new Location(ORIGIN.x, ORIGIN.y, 0));
  const end = walkTo(p, ORIGIN.x, ORIGIN.y + 40);
  assert.equal(end.getX(), ORIGIN.x, 'x unchanged');
  assert.equal(end.getY(), ORIGIN.y + 40, 'walked the full 40 tiles');
});

test('a noclip click along a long diagonal reaches its end', () => {
  const p = player(true);
  p.setLocation(new Location(ORIGIN.x, ORIGIN.y, 0));
  const end = walkTo(p, ORIGIN.x + 30, ORIGIN.y + 30);
  assert.equal(end.getX(), ORIGIN.x + 30);
  assert.equal(end.getY(), ORIGIN.y + 30);
});

test('a noclip click on an L-shaped distance (40 east, 20 south) reaches its end', () => {
  const p = player(true);
  p.setLocation(new Location(ORIGIN.x, ORIGIN.y, 0));
  const end = walkTo(p, ORIGIN.x + 40, ORIGIN.y - 20);
  assert.equal(end.getX(), ORIGIN.x + 40);
  assert.equal(end.getY(), ORIGIN.y - 20);
});
