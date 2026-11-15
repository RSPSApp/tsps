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
