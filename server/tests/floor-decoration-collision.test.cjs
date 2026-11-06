// Run after `yarn build`: node --test tests/floor-decoration-collision.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const { GameObject } = require('../dist/game/entity/impl/object/GameObject');
const { NPC } = require('../dist/game/entity/impl/npc/NPC');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { Location } = require('../dist/game/model/Location');
const { PrivateArea } = require('../dist/game/model/areas/impl/PrivateArea');
const { RsmodRouteFinding } = require('../dist/game/model/movement/path/RsmodRouteFinding');
const VENT = 11851;
const KET = 2173;
const tile = new Location(2378, 5156, 0);
const directions = [[-1,1,'NorthWest',0], [0,1,'North',1], [1,1,'NorthEast',2], [-1,0,'West',3], [1,0,'East',4], [-1,-1,'SouthWest',5], [0,-1,'South',6], [1,-1,'SouthEast',7]];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  RegionManager.init();
});

test('cache sulphur vent blocks actual Ket and player steps while ranged fire crosses it', () => {
  RegionManager.loadMapFiles(tile.getX(), tile.getY());
  const vent = MapObjects.get(VENT, tile, null);
  assert.equal(vent.getType(), 22);
  assert.equal(vent.getDefinition().clipType, 1);
  assert.equal(RegionManager.getClipping(2378, 5156, 0, null), 0x40000);
  for (const actor of [new NPC(KET, tile.transform(0, 1)), new Player(null)]) {
    actor.setLocation(tile.transform(0, 1));
    assert.equal(actor.getSize(), 1);
    const queue = actor.getMovementQueue();
    const canWalk = queue.canWalkTo(tile);
    queue.addCheckpoint(tile);
    queue.process();
    console.log('movement-proof', JSON.stringify({actor:actor.isNpc()?'Ket':'player',canWalk,x:actor.getLocation().getX(),y:actor.getLocation().getY()}));
    assert.equal(canWalk, false, 'must not step onto vent');
    assert.ok(!actor.getLocation().equals(tile), 'queued movement must recheck floor decorations');
  }
  assert.equal(RegionManager.canProjectileMove(2378,5157,2378,5155,0,1,1,null), true);
});

test('all eight step directions and blocked helpers respect floor decorations', () => {
  const area = new (class extends PrivateArea {})();
  area.setClip(tile, 0x40000);
  assert.equal(RegionManager.blocked(tile, area), true);
  for (const [dx,dy,name,direction] of directions) {
    const from = tile.transform(-dx,-dy);
    assert.equal(RegionManager['blocked'+name](from,area), true, name);
    assert.equal(RegionManager.canMoveIsBlocked(from,direction,area), false, name);
    assert.equal(RegionManager.canMovestart(from,tile,1,1,area), false, name);
  }
  area.destroy();
});

test('large NPC edges, diagonal corners, planes and dynamic removal retain their boundaries', () => {
  const area = new (class extends PrivateArea {})();
  const from = new Location(100,100,0);
  const vent = new GameObject(VENT, from.transform(2,1),22,0,area);
  RegionManager.addObjectClipping(vent);
  assert.equal(RegionManager.canMovestart(from,from.transform(1,0),2,2,area),false,'2x2 footprint meets vent');
  assert.equal(RegionManager.canMovestart(from,from.transform(1,0),1,1,area),true,'1x1 footprint clears vent');
  assert.equal(RegionManager.canMovestart(new Location(100,100,1),new Location(101,100,1),2,2,area),true,'other plane');
  RegionManager.removeObjectClipping(vent);
  assert.equal(RegionManager.canMovestart(from,from.transform(1,0),2,2,area),true,'removed decoration');
  area.setClip(from.transform(1,0),0x40000);
  assert.equal(RegionManager.canMovestart(from,from.transform(1,1),1,1,area),false,'diagonal cannot cut the blocked corner');
  area.setClip(from.transform(1,0),0x20000);
  assert.equal(RegionManager.canMovestart(from,from.transform(1,0),1,1,area),true,'projectile-only flag does not block walking');
  area.destroy();
});

test('route planning and authoritative steps agree about a floor-decoration destination', () => {
  const area = new (class extends PrivateArea {})();
  area.setClip(tile,0x40000);
  const route = new RsmodRouteFinding().findRoute({level:0,srcX:2378,srcY:5157,srcSize:1,destX:2378,destY:5156,moveNear:false,privateArea:area});
  assert.equal(route.success,false);
  assert.equal(RegionManager.canMovestart(tile.transform(0,1),tile,1,1,area),route.success);
  area.destroy();
});
