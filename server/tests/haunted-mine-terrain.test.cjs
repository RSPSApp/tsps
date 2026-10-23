// From server/: node --test tests/haunted-mine-terrain.test.cjs (after yarn build).
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const path = require('node:path');

const REGION = 10821;
const TILE = { x: 2725, y: 4453 };

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  require('../dist/game/collision/RegionManager').RegionManager.init();
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  RegionManager.loadMapFiles(TILE.x, TILE.y);
});

function clipping(x = TILE.x, y = TILE.y, z = 0) {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  return RegionManager.getClipping(x, y, z, null);
}

function blocked(x, y) {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  return RegionManager.blocked({ getX: () => x, getY: () => y, getZ: () => 0 }, null);
}

function loadHauntedMine() {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  require('../plugins/quests/quests/HauntedMine.Quest')(
    PluginManager.createApi('HauntedMineTerrainTest')
  );
}

function routeSteps(from, to) {
  const { PathFinder } = require('../dist/game/model/movement/path/PathFinder');
  const { Location } = require('../dist/game/model/Location');
  const queue = { points: [], reset() { return queue; }, setRoute() { return queue; }, setPathX() { return queue; },
    setPathY() { return queue; }, addCheckpoint(tile) { queue.points.push([tile.getX(), tile.getY()]); return queue; },
    syncDestinationFlagToRoute() { return queue; } };
  const entity = { isPlayer: () => false, getAsPlayer: () => ({ getUsername: () => '' }),
    getLocation: () => new Location(from.x, from.y, 0), getSize: () => 1, getPrivateArea: () => null, getMovementQueue: () => queue };
  return PathFinder.calculateRoute(entity, 0, to.x, to.y, 0, 0, 0, 0, false);
}

test('raw cache blocks the flooded crossing at 2725,4453 plane 0', () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  assert.equal(RegionManager.getRegionid(REGION)?.isLoaded(), true, 'region 10821 is loaded');
  assert.notEqual(clipping() & RegionManager.BLOCKED_TILE, 0, 'cache 241 sets BLOCKED_TILE');
  assert.equal(blocked(TILE.x, TILE.y), true, 'captured crossing starts clipped');
});

test('Haunted Mine clears only that clipping on region load without a map replacement', () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { MapRegionReplacementManager } = require('../dist/game/collision/MapRegionReplacementManager');

  loadHauntedMine();
  assert.equal(MapRegionReplacementManager.getReplacementMapData(REGION), null, 'quest registers no region replacement');
  assert.ok(!MapRegionReplacementManager.getRegionIds().includes(REGION), 'region 10821 is not in the replacement list');
  assert.notEqual(clipping() & RegionManager.BLOCKED_TILE, 0, 'the fix waits for the region-loaded hook');

  assert.equal(RegionManager.reloadRegion(REGION), true);
  assert.equal(clipping() & RegionManager.BLOCKED_TILE, 0, 'region load clears the BLOCKED_TILE bit');
  assert.equal(blocked(TILE.x, TILE.y), false, 'captured crossing is walkable');
  assert.equal(blocked(2724, 4453), true, 'west neighbour stays clipped');
  assert.equal(blocked(2726, 4453), true, 'east neighbour stays clipped');
  assert.ok(routeSteps({ x: 2725, y: 4456 }, { x: 2744, y: 4436 }) > 0, 'lift landing -> east-stairs approach');
  assert.equal(MapRegionReplacementManager.getReplacementMapData(REGION), null, 'no replacement after the hook runs');
});

test('the clipping fix is re-applied after a later region reload', () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  assert.equal(RegionManager.reloadRegion(REGION), true);
  assert.equal(clipping() & RegionManager.BLOCKED_TILE, 0, 'reload rebuilds clipping and the hook clears the tile again');
  assert.equal(blocked(TILE.x, TILE.y), false);
});
