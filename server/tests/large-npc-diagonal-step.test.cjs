// Run after `yarn build`: node --test tests/large-npc-diagonal-step.test.cjs
// A diagonal step of an actor larger than 1x1 checks only the tiles it steps into, as OSRS's route finder
// (RsmodRouteFinding) does. RegionManager.canMove also checked beside every tile of the old footprint, refusing
// steps the route finder had planned: 3,187 of 14,156 diagonal steps size-2+ NPCs made in 400 rsprox.net
// recordings, and a teased spined larupia stood stuck by the Feldip rocks at 2541,2906.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
const { NPC } = require('../dist/game/entity/impl/npc/NPC');
const { Location } = require('../dist/game/model/Location');
const { PathFinder } = require('../dist/game/model/movement/path/PathFinder');

const LARUPIA = () => CacheDefinitions.getNpcId('hunting_jaguar');

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  ObjectDefinition.init();
  RegionManager.init();
  for (const [x, y] of [[2541, 2906], [1507, 3450], [3234, 3166], [3297, 2717]]) RegionManager.loadMapFiles(x, y);
});

test('a 2x2 NPC steps diagonally past a corner whose old-footprint neighbour is blocked (Feldip rocks)', () => {
  // 2540,2906 (west of the larupia's south-west tile) is a rock; the step north-west enters 2540-2541 x 2907-2908.
  assert.ok(RegionManager.getClipping(2540, 2906, 0, null) & 0x100, 'the rock beside its south-west tile');
  assert.equal(RegionManager.canMove(2541, 2906, 2540, 2907, 0, 2, 2, null), true);
  // Straight steps are still blocked there: west into the rock, north into 2542,2908.
  assert.equal(RegionManager.canMove(2541, 2906, 2540, 2906, 0, 2, 2, null), false);
  assert.equal(RegionManager.canMove(2541, 2906, 2541, 2907, 0, 2, 2, null), false);
});

test('a 2x2 NPC still may not step diagonally into a blocked tile', () => {
  // South-west from 2541,2906 enters 2540,2905, also rock.
  assert.ok(RegionManager.getClipping(2540, 2905, 0, null) & 0x100);
  assert.equal(RegionManager.canMove(2541, 2906, 2540, 2905, 0, 2, 2, null), false);
});

test('1x1 actors keep the corner rule: no diagonal past a blocked side', () => {
  assert.equal(RegionManager.canMove(2541, 2906, 2540, 2907, 0, 1, 1, null), false);
});

test('a larupia follows the route finder round the Feldip rocks instead of stopping at 2541,2906', () => {
  const npc = new NPC(LARUPIA(), new Location(2541, 2906, 0));
  assert.equal(npc.getSize(), 2);
  PathFinder.calculateWalkRoute(npc, 2534, 2914);
  const queue = npc.getMovementQueue();
  queue.process();
  assert.deepEqual([npc.getLocation().getX(), npc.getLocation().getY()], [2540, 2907], 'its first step is the planned north-west one');
  for (let i = 0; i < 3; i++) queue.process();
  assert.equal(queue.isStepBlocked(), false);
});

test('captured diagonal steps of large NPCs are allowed (rsprox.net recordings 00013, 01432, 01434)', () => {
  for (const [name, from, to] of [
    ['brownbear', [1507, 3450], [1506, 3449]],
    ['giantrat1_3', [3234, 3166], [3235, 3165]],
    ['desert_wolf2', [3297, 2717], [3298, 2716]],
  ]) {
    const size = CacheDefinitions.getNpc(CacheDefinitions.getNpcId(name)).size;
    assert.ok(size >= 2, name);
    assert.equal(RegionManager.canMove(from[0], from[1], to[0], to[1], 0, size, size, null), true, `${name} ${from} -> ${to}`);
  }
});
